import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ClipboardCheck, Copy, Loader2, ShieldCheck, Sparkles, Square } from 'lucide-react';
import type { SessionUser } from '../types';
import { getAllActiveEntries, streamAi } from '../db/store';
import {
  buildCaseText,
  CASE_KIND_LABEL,
  CASE_REASONS,
  caseKind,
  caseSummary,
  reasonText,
  validateCaseIndicators,
  type CaseReason,
  type CaseValidation
} from '../utils/caseTemplate';
import { Modal } from './Modal';
import type { ShowToast } from '../App';
import './CaseBuilder.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Indicadores já preenchidos ao abrir (ex.: itens marcados na lista). */
  initialText?: string;
  currentUser: SessionUser;
  aiEnabled: boolean;
  showToast: ShowToast;
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Texto do caso para o cliente: cola os IPs (ou traz os incluídos hoje), valida com as regras da
 * importação e gera o corpo no modelo da equipe. Sem o ticket TLD o texto não é liberado.
 */
export const CaseBuilderModal: React.FC<Props> = ({ open, onClose, initialText, currentUser, aiEnabled, showToast }) => {
  const [raw, setRaw] = useState('');
  const [validated, setValidated] = useState<{ raw: string; result: CaseValidation } | null>(null);
  const [ticket, setTicket] = useState('');
  const [reason, setReason] = useState<CaseReason>('scan');
  const [customReason, setCustomReason] = useState('');
  const [note, setNote] = useState('');
  const [loadingToday, setLoadingToday] = useState(false);
  const [onlyMine, setOnlyMine] = useState(true);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<'body' | 'subject' | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const aiAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      aiAbort.current?.abort();
      return;
    }
    setRaw(initialText ?? '');
    setValidated(initialText ? { raw: initialText, result: validateCaseIndicators(initialText) } : null);
    setEdited(null);
    setCopied(null);
  }, [open, initialText]);

  const validate = (text = raw) => {
    const result = validateCaseIndicators(text);
    setValidated({ raw: text, result });
    setEdited(null);
    return result;
  };

  const loadToday = async () => {
    setLoadingToday(true);
    try {
      const today = localToday();
      const entries = (await getAllActiveEntries()).filter(
        (e) => e.addedDate === today && (!onlyMine || e.addedBy === currentUser.displayName || e.addedBy === currentUser.username)
      );
      const text = [...new Set(entries.map((e) => e.indicator))].join('\n');
      if (!text) {
        showToast(onlyMine ? 'Você não incluiu nenhum indicador hoje.' : 'Nenhum indicador incluído hoje.', 'info');
        return;
      }
      setRaw(text);
      const result = validate(text);
      showToast(`${caseSummary(result)} incluídos hoje.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível buscar os itens de hoje.', 'warn');
    } finally {
      setLoadingToday(false);
    }
  };

  const v = validated?.result ?? null;
  const stale = validated !== null && validated.raw !== raw;
  const kind = v ? caseKind(v) : 'empty';
  const ticketOk = ticket.trim().length > 0;
  const generated = useMemo(() => {
    if (!v || kind === 'empty' || !ticketOk) return null;
    try {
      return buildCaseText(v, { ticket, date: new Date(), reason, customReason });
    } catch {
      return null;
    }
  }, [v, kind, ticket, ticketOk, reason, customReason]);

  // Texto editado à mão vale até mudar algo que refaça o modelo.
  useEffect(() => setEdited(null), [ticket, reason, customReason, validated]);
  const body = edited ?? generated?.body ?? '';

  const copy = async (what: 'body' | 'subject') => {
    const text = what === 'body' ? body : generated?.subject ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      showToast('Não foi possível copiar. Selecione o texto e use Ctrl+C.', 'warn');
    }
  };

  const writeWithAi = async () => {
    if (!v) return;
    const controller = new AbortController();
    aiAbort.current = controller;
    setReason('custom');
    setCustomReason('');
    setAiBusy('Pedindo à IA…');
    try {
      await streamAi(
        '/api/ai/case-reason',
        { ips: v.ips, cidrs: v.cidrs, domains: v.domains, note },
        (e) => {
          if (e.type === 'status') setAiBusy(e.text);
          else if (e.type === 'text') setCustomReason((prev) => prev + e.text);
          else if (e.type === 'error') showToast(e.error, 'warn');
        },
        controller.signal
      );
      setCustomReason((prev) => prev.trim());
    } catch (err) {
      if (!controller.signal.aborted) showToast(err instanceof Error ? err.message : 'Falha na IA.', 'warn');
    } finally {
      setAiBusy(null);
      aiAbort.current = null;
    }
  };

  const removed = v ? v.duplicates.length + v.covered.length + v.invalid.length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Gerar caso para o cliente"
      subtitle="Valide os indicadores, informe o ticket TLD e copie o texto pronto. O texto não cita o nome do cliente."
      footer={
        <>
          <span className="cb-foot-hint">{!ticketOk && v && kind !== 'empty' ? 'Informe o ticket TLD para liberar o texto.' : ''}</span>
          <button type="button" className="btn" disabled={!generated} onClick={() => copy('subject')}>
            {copied === 'subject' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied === 'subject' ? 'Assunto copiado' : 'Copiar assunto'}
          </button>
          <button type="button" className="btn btn--primary" disabled={!generated || stale} onClick={() => copy('body')}>
            {copied === 'body' ? <Check aria-hidden="true" /> : <ClipboardCheck aria-hidden="true" />}
            {copied === 'body' ? 'Texto copiado' : 'Copiar texto do caso'}
          </button>
        </>
      }
    >
      <div className="cb-grid">
        {/* ---------- Entrada e validação ---------- */}
        <section className="cb-col">
          <div className="cb-step"><span>1</span> Indicadores bloqueados</div>
          <textarea
            className="field cb-input font-mono"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'Cole os IPs e CIDRs, um por linha\n192.42.116.105\n155.254.28.0/24'}
            spellCheck={false}
            aria-label="Indicadores do caso"
            data-dialog-initial-focus
          />
          <div className="cb-actions">
            <button type="button" className="btn btn--sm" onClick={loadToday} disabled={loadingToday}>
              {loadingToday ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
              Usar os incluídos hoje
            </button>
            <label className="cb-check">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              só os que eu incluí
            </label>
            <button type="button" className="btn btn--sm btn--primary ml-auto" onClick={() => validate()} disabled={!raw.trim()}>
              <ShieldCheck aria-hidden="true" />
              Validar
            </button>
          </div>

          {v && (
            <div className={`cb-result${stale ? ' is-stale' : ''}`} role="status">
              <div className="cb-result__head">
                <strong>{kind === 'empty' ? 'Nenhum indicador válido' : caseSummary(v)}</strong>
                {kind !== 'empty' && <span className="chip chip--ok">{CASE_KIND_LABEL[kind]}</span>}
              </div>
              {stale && <p className="cb-warn">A lista mudou depois da validação. Clique em Validar de novo.</p>}
              {removed > 0 && (
                <ul className="cb-notes">
                  {v.duplicates.length > 0 && <li>{v.duplicates.length} repetido(s) retirado(s): <code>{v.duplicates.slice(0, 4).join(', ')}</code>{v.duplicates.length > 4 ? '…' : ''}</li>}
                  {v.covered.map((c) => (
                    <li key={c.indicator}><code>{c.indicator}</code> retirado: já está dentro de <code>{c.by}</code></li>
                  )).slice(0, 6)}
                  {v.covered.length > 6 && <li>… e mais {v.covered.length - 6} dentro de CIDRs da lista</li>}
                  {v.invalid.length > 0 && <li>{v.invalid.length} ignorado(s) por não ser IP, CIDR ou domínio: <code>{v.invalid.slice(0, 3).join(', ')}</code>{v.invalid.length > 3 ? '…' : ''}</li>}
                </ul>
              )}
              {v.reserved.length > 0 && (
                <p className="cb-warn">
                  <AlertTriangle aria-hidden="true" />
                  Faixa privada/reservada no texto: {v.reserved.map((r) => r.indicator).join(', ')}. Confira antes de enviar.
                </p>
              )}
            </div>
          )}

          <div className="cb-step"><span>2</span> Ticket e motivo</div>
          <div className="cb-row">
            <div className="cb-ticket">
              <label className="field-label" htmlFor="cb-ticket">Ticket TLD <span className="cb-req">obrigatório</span></label>
              <input
                id="cb-ticket"
                className={`field w-full font-mono${!ticketOk && v && kind !== 'empty' ? ' is-invalid' : ''}`}
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                placeholder="Ex.: TLD-48213"
                maxLength={60}
                aria-required="true"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="field-label" htmlFor="cb-reason">Motivo</label>
              <select id="cb-reason" className="field w-full" value={reason} onChange={(e) => setReason(e.target.value as CaseReason)}>
                {CASE_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {reason === 'custom' && (
            <textarea
              className="field cb-reason-text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Descreva o que foi observado (2 parágrafos curtos)…"
              aria-label="Texto do motivo"
            />
          )}

          {aiEnabled && (
            <div className="cb-ai">
              <input
                className="field flex-1 min-w-0"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Opcional: o que você viu (ex.: tentativas SSH na porta 22)"
                aria-label="Observação para a IA"
              />
              {aiBusy ? (
                <button type="button" className="btn btn--sm" onClick={() => aiAbort.current?.abort()}>
                  <Square aria-hidden="true" /> Parar
                </button>
              ) : (
                <button type="button" className="btn btn--sm" disabled={!v || kind === 'empty' || stale} onClick={writeWithAi} title="A IA escreve só o motivo; a lista e o ticket não mudam">
                  <Sparkles aria-hidden="true" /> Escrever motivo com IA
                </button>
              )}
            </div>
          )}
          {aiBusy && <p className="cb-ai-status"><Loader2 className="animate-spin" aria-hidden="true" />{aiBusy}</p>}
        </section>

        {/* ---------- Texto pronto ---------- */}
        <section className="cb-col">
          <div className="cb-step"><span>3</span> Texto do caso</div>
          {generated ? (
            <>
              <div className="cb-subject"><span>Assunto</span><code>{generated.subject}</code></div>
              <textarea
                className="field cb-output"
                value={body}
                onChange={(e) => setEdited(e.target.value)}
                spellCheck={false}
                aria-label="Texto do caso (pode editar antes de copiar)"
              />
              <p className="cb-hint">{edited !== null ? 'Editado à mão. Mudar ticket, motivo ou lista refaz o texto.' : 'Você pode ajustar o texto antes de copiar.'}</p>
            </>
          ) : (
            <div className="cb-placeholder">
              <ClipboardCheck aria-hidden="true" />
              <p>
                {!v ? 'Cole ou traga os indicadores e clique em Validar.'
                  : kind === 'empty' ? 'Nenhum indicador válido para o caso.'
                  : 'Informe o ticket TLD para liberar o texto.'}
              </p>
              {v && kind !== 'empty' && reason !== 'custom' && (
                <details className="cb-preview-reason">
                  <summary>Prévia do motivo</summary>
                  <p>{reasonText(reason, kind)}</p>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};
