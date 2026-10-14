import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { streamAi, type AiEvent } from '../db/store';
import { findIndicator } from './contextActions';
import './AiAssistant.css';

export type AiRequest =
  | { id: number; kind: 'question'; text: string }
  | { id: number; kind: 'indicator'; indicator: string };

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** O que foi enviado à IA, quando difere do que aparece (ex.: análise de indicador). */
  prompt?: string;
  status?: string;
  error?: string;
  meta?: string;
  pending?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  model: string | null;
  request: AiRequest | null;
}

const STORAGE_KEY = 'guardlist-ai-chat';
const SUGGESTIONS = [
  'Quais clientes estão atrasados ou vencem esta semana?',
  'Quais IPs aparecem em mais clientes?',
  'O que está parado para revisão?',
  'Resuma as últimas importações.'
];

let nextId = Date.now();

// ---------- Markdown simples e seguro (sem HTML cru) ----------

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(<strong key={`${keyBase}-${i++}`}>{token.slice(2, -2)}</strong>);
    } else {
      const code = token.slice(1, -1);
      const indicator = findIndicator(code);
      out.push(
        <code key={`${keyBase}-${i++}`} className={indicator ? 'ai-ind' : undefined} data-indicator={indicator?.value} title={indicator ? 'Botão direito: ações deste indicador' : undefined}>
          {code}
        </code>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const AiMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p-${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={`l-${blocks.length}`}>{list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>)}</Tag>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^#{1,4}\s+(.*)$/.exec(line) || /^\*\*([^*]+)\*\*:?$/.exec(line.trim());
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<h4 key={`h-${blocks.length}`}>{inline(heading[1], `h${blocks.length}`)}</h4>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="ai-md">{blocks}</div>;
};

// ---------- Painel ----------

/**
 * Assistente de IA em painel lateral. Não é uma janela modal: dá para continuar usando o app,
 * inclusive o botão direito nos IPs citados na resposta.
 */
export const AiAssistant: React.FC<Props> = ({ open, onClose, model, request }) => {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') as Message[];
      return saved.filter((m) => !m.pending);
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handled = useRef<number | null>(null);
  const busy = messages.some((m) => m.pending);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter((m) => !m.pending).slice(-30)));
    } catch {
      // Preferência opcional.
    }
  }, [messages]);

  // Rola para o fim enquanto a resposta chega (se a pessoa já estava no fim).
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Cronômetro enquanto a IA não começou a escrever: num servidor lento, mostra que está trabalhando.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const update = (id: number, change: (m: Message) => Message) => setMessages((prev) => prev.map((m) => (m.id === id ? change(m) : m)));

  const run = useCallback(
    async (userText: string, prompt: string | undefined, call: (onEvent: (e: AiEvent) => void, signal: AbortSignal) => Promise<void>) => {
      const userMsg: Message = { id: ++nextId, role: 'user', content: userText, prompt };
      const answer: Message = { id: ++nextId, role: 'assistant', content: '', pending: true, status: 'Enviando…' };
      setMessages((prev) => [...prev, userMsg, answer]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await call((event) => {
          if (event.type === 'status') update(answer.id, (m) => ({ ...m, status: event.text }));
          else if (event.type === 'text') update(answer.id, (m) => ({ ...m, content: m.content + event.text, status: undefined }));
          else if (event.type === 'error') update(answer.id, (m) => ({ ...m, error: event.error }));
          else if (event.type === 'done') update(answer.id, (m) => ({ ...m, meta: `${event.model} · ${(event.ms / 1000).toFixed(1)} s` }));
        }, controller.signal);
      } catch (err) {
        const aborted = controller.signal.aborted;
        update(answer.id, (m) => ({ ...m, error: aborted ? (m.content ? undefined : 'Resposta interrompida.') : err instanceof Error ? err.message : 'Falha.' }));
      } finally {
        update(answer.id, (m) => ({ ...m, pending: false, status: undefined, content: m.content.trim() }));
        abortRef.current = null;
      }
    },
    []
  );

  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question || abortRef.current) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      const history = messagesRef.current
        .filter((m) => !m.pending && !m.error && m.content)
        .map((m) => ({ role: m.role, content: m.prompt ?? m.content }))
        .concat({ role: 'user' as const, content: question });
      void run(question, undefined, (onEvent, signal) => streamAi('/api/ai/chat', { messages: history }, onEvent, signal));
    },
    [run]
  );

  const analyze = useCallback(
    (indicator: string) => {
      if (abortRef.current) return;
      void run(`Analisar \`${indicator}\``, `Analise o indicador ${indicator}.`, (onEvent, signal) => streamAi('/api/ai/indicator', { indicator }, onEvent, signal));
    },
    [run]
  );

  // Pedidos vindos de fora (menu do botão direito).
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    if (request.kind === 'indicator') analyze(request.indicator);
    else ask(request.text);
  }, [request, analyze, ask]);

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    inputRef.current?.focus();
  };

  return (
    <aside
      className={`ai-drawer${open ? ' is-open' : ''}`}
      aria-label="Assistente de IA"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="ai-drawer__head">
        <span className="ai-drawer__mark" aria-hidden="true"><Sparkles /></span>
        <div className="min-w-0 flex-1">
          <h2>Assistente IA</h2>
          <p>{model ? `${model} · roda no servidor da equipe` : 'IA local'}</p>
        </div>
        <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={reset} title="Nova conversa" aria-label="Nova conversa" disabled={!messages.length}>
          <RotateCcw aria-hidden="true" />
        </button>
        <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar assistente">
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="ai-drawer__list" ref={listRef} aria-live="polite">
        {!messages.length && (
          <div className="ai-empty">
            <span className="ai-empty__icon" aria-hidden="true"><Sparkles /></span>
            <h3>Pergunte sobre as listas</h3>
            <p>A IA consulta os dados do GuardList para responder. Ela não altera nada.</p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="ai-chip" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
            <p className="ai-empty__tip">Dica: botão direito num IP → <strong>Perguntar à IA</strong>.</p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ai-msg ai-msg--user"><AiMarkdown text={m.content} /></div>
          ) : (
            <div key={m.id} className={`ai-msg ai-msg--ai${m.pending ? ' is-pending' : ''}`}>
              {m.content && <AiMarkdown text={m.content} />}
              {m.pending && !m.content && (
                <div className="ai-status"><Loader2 className="animate-spin" aria-hidden="true" />{m.status || 'Pensando…'}{elapsed >= 3 ? ` · ${elapsed} s` : ''}</div>
              )}
              {m.pending && m.content && m.status && <div className="ai-status ai-status--inline">{m.status}</div>}
              {m.error && <div className="ai-error" role="alert">{m.error}</div>}
              {m.meta && !m.pending && <div className="ai-meta">{m.meta}</div>}
            </div>
          )
        )}
      </div>

      <form
        className="ai-drawer__form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          maxLength={2000}
          placeholder="Pergunte sobre clientes, IPs, revisões…"
          aria-label="Pergunta para a IA"
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="ai-send is-stop" onClick={() => abortRef.current?.abort()} title="Parar" aria-label="Parar resposta">
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="ai-send" disabled={!input.trim()} title="Enviar (Enter)" aria-label="Enviar pergunta">
            <ArrowUp aria-hidden="true" />
          </button>
        )}
      </form>
      <p className="ai-drawer__foot">A IA pode errar. Confira antes de bloquear ou remover.</p>
    </aside>
  );
};
