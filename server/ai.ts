// Assistente de IA do GuardList.
//
// Fala com qualquer servidor compatível com a API da OpenAI (/v1/chat/completions):
// Ollama, vLLM, LM Studio, LocalAI… Hoje aponta para o Ollama local; no servidor da empresa
// basta trocar AI_BASE_URL. Sem AI_BASE_URL e AI_MODEL, a função fica desligada.
//
// Pensado para servidores modestos (sem placa de vídeo): o GuardList já entrega à IA um panorama
// pronto dos dados e poucas ferramentas de consulta, todas só de leitura. A IA nunca altera nada.
import type { Database } from './db.ts';
import type { Cti } from './cti.ts';
import type { Actor, Store } from './store.ts';
import type { Client, CtiSummary } from '../src/types/index.ts';

export function aiSettings() {
  return {
    baseUrl: (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, ''),
    model: (process.env.AI_MODEL || '').trim(),
    apiKey: (process.env.AI_API_KEY || '').trim(),
    // "none" desliga o raciocínio longo de modelos como o qwen3: respostas muito mais rápidas.
    reasoningEffort: (process.env.AI_REASONING_EFFORT ?? 'none').trim(),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 180_000),
    maxTokens: Number(process.env.AI_MAX_TOKENS || 900),
    maxConcurrent: Math.max(1, Number(process.env.AI_MAX_CONCURRENT || 2))
  };
}

export function aiConfigured() {
  const s = aiSettings();
  return Boolean(s.baseUrl && s.model);
}

// ---------- Mensagens e chamadas ao servidor de IA ----------

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export type AiEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done'; model: string; ms: number; tokens?: number }
  | { type: 'error'; error: string };

/** Filtra blocos <think>…</think> que alguns modelos escrevem no meio do texto. */
export function thinkFilter(emit: (text: string) => void) {
  let buffer = '';
  let inThink = false;
  const push = (chunk: string, final = false) => {
    buffer += chunk;
    for (;;) {
      if (inThink) {
        const end = buffer.indexOf('</think>');
        if (end < 0) {
          buffer = buffer.slice(-8);
          return;
        }
        buffer = buffer.slice(end + 8).replace(/^\s+/, '');
        inThink = false;
      } else {
        const start = buffer.indexOf('<think>');
        if (start < 0) {
          // Segura um possível "<thi" incompleto no fim do pedaço.
          let keep = 0;
          const lt = buffer.lastIndexOf('<');
          if (!final && lt >= 0 && '<think>'.startsWith(buffer.slice(lt))) keep = buffer.length - lt;
          const out = buffer.slice(0, buffer.length - keep);
          if (out) emit(out);
          buffer = buffer.slice(out.length);
          return;
        }
        if (start > 0) emit(buffer.slice(0, start));
        buffer = buffer.slice(start + 7);
        inThink = true;
      }
    }
  };
  return { push: (c: string) => push(c), flush: () => push('', true) };
}

async function streamCompletion(
  messages: ChatMessage[],
  options: { tools?: unknown[]; signal: AbortSignal; onText?: (text: string) => void; maxTokens?: number }
): Promise<{ content: string; toolCalls: ToolCall[]; tokens?: number }> {
  const s = aiSettings();
  const body: Record<string, unknown> = {
    model: s.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.2,
    max_tokens: options.maxTokens ?? s.maxTokens
  };
  if (s.reasoningEffort) body.reasoning_effort = s.reasoningEffort;
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }
  const response = await fetch(`${s.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: options.signal
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`O servidor de IA respondeu ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  let content = '';
  let tokens: number | undefined;
  const calls = new Map<number, ToolCall>();
  const filter = thinkFilter((t) => {
    content += t;
    options.onText?.(t);
  });
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json: any;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.usage?.completion_tokens) tokens = json.usage.completion_tokens;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) filter.push(delta.content);
      for (const tc of delta.tool_calls ?? []) {
        const index = Number(tc.index ?? 0);
        const current = calls.get(index) ?? { id: tc.id || `call_${index}`, type: 'function' as const, function: { name: '', arguments: '' } };
        if (tc.id) current.id = tc.id;
        if (tc.function?.name) current.function.name += tc.function.name;
        if (tc.function?.arguments) current.function.arguments += tc.function.arguments;
        calls.set(index, current);
      }
    }
  }
  filter.flush();
  return { content: content.trim(), toolCalls: [...calls.values()].filter((c) => c.function.name), tokens };
}

// ---------- Fila: num servidor fraco, poucas respostas ao mesmo tempo ----------

let running = 0;
const waiting: Array<() => void> = [];
async function withSlot<T>(onQueued: () => void, fn: () => Promise<T>): Promise<T> {
  if (running >= aiSettings().maxConcurrent) {
    onQueued();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// ---------- Dados para a IA ----------

const fmtDate = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');
const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime()) / 86_400_000) : null);
const clip = (text: string | undefined | null, max = 120) => (text ? (text.length > max ? `${text.slice(0, max)}…` : text) : '');

function findClient(clients: Client[], name?: string): Client | undefined {
  if (!name) return undefined;
  const q = name.trim().toLowerCase();
  return clients.find((c) => c.name.toLowerCase() === q) ?? clients.find((c) => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
}

interface LookupRow { clientName: string; status: string; match: string; via?: string; indicator: string; addedDate: string; sourceTicket?: string; notes?: string }

function ctiLine(c: CtiSummary | undefined): string {
  if (!c) return 'reputação: não consultada';
  const verdict = { high: 'ALTO risco', medium: 'risco médio', low: 'baixo risco', legit: 'LEGÍTIMO', unknown: 'sem dados' }[c.verdict] ?? c.verdict;
  const parts = [`reputação: ${verdict}${c.verdictReason ? ` (${c.verdictReason})` : ''}`];
  if (c.score !== null) parts.push(`AbuseIPDB ${c.score}% com ${c.totalReports ?? 0} denúncias (última ${fmtDate(c.lastReportedAt)})`);
  if (c.greyNoise?.classification) parts.push(`GreyNoise: ${c.greyNoise.classification}${c.greyNoise.name ? ` (${c.greyNoise.name})` : ''}`);
  if (c.otxPulses !== null) parts.push(`OTX: ${c.otxPulses} pulsos`);
  if (c.isp || c.asn) parts.push(`rede: ${[c.isp, c.asn].filter(Boolean).join(' · ')}`);
  if (c.countryCode) parts.push(`país: ${c.countryCode}`);
  return parts.join('; ');
}

export function createAi(deps: { db: Database; store: Store; cti: Cti }) {
  const { db, store, cti } = deps;

  async function reputation(indicators: string[], fetchMissing: number) {
    try {
      return (await cti.enrich(indicators, { limit: fetchMissing })).results;
    } catch {
      return {} as Record<string, CtiSummary>;
    }
  }

  /** Retrato atual da base, mandado em toda conversa: muitas perguntas se respondem só com ele. */
  async function panorama(): Promise<string> {
    const [clients, stats, settings] = await Promise.all([store.getAllClients(), store.getDashboardStats(), store.getAppSettings()]);
    const sla = settings.slaDays || 7;
    const lines = clients
      .filter((c) => !c.isArchived)
      .map((c) => {
        const d = daysSince(c.lastUpdateDate);
        const situation = d === null ? 'nunca revisado' : d > sla ? `ATRASADO há ${d - sla} dia(s)` : sla - d <= 2 ? `vence em ${sla - d} dia(s)` : `em dia (vence em ${sla - d} dias)`;
        return `- ${c.name} · firewall/obs: ${clip(c.notes, 60) || '—'} · ativos ${stats.activeCounts[c.id] ?? 0} (${stats.ipCounts[c.id] ?? 0} IPs, ${stats.cidrCounts[c.id] ?? 0} CIDRs) · última revisão ${fmtDate(c.lastUpdateDate)}${d !== null ? ` (há ${d} dias)` : ''} · ${situation} · exceções: ${c.exceptions?.length ?? 0}`;
      });
    const recurring = stats.recurring.slice(0, 6).map((r) => `${r.indicator} (${r.count} clientes)`).join(', ');
    return [
      `Hoje: ${new Date().toLocaleDateString('pt-BR')}. Prazo de manutenção semanal: ${sla} dias. Revisão de bloqueios parados após ${settings.reviewDays ?? 90} dias.`,
      `Totais: ${stats.totalActiveAcrossAll} bloqueios ativos (${stats.totalIpsAcrossAll} IPs, ${stats.totalCidrsAcrossAll} CIDRs) em ${lines.length} clientes; ${stats.totalCorrelatedIps} indicadores em 2+ clientes; ${stats.addedThisWeekCount} incluídos nesta semana.`,
      `Mais recorrentes: ${recurring || 'nenhum'}.`,
      'Clientes:',
      ...lines
    ].join('\n');
  }

  // Ferramentas de consulta (só leitura). Descrições curtas: modelos pequenos lidam melhor.
  const tools = [
    {
      type: 'function',
      function: {
        name: 'consultar_indicadores',
        description: 'Onde IPs, CIDRs ou domínios estão bloqueados (em quais clientes, se ativos ou removidos, se cobertos por CIDR) e a reputação de cada IP.',
        parameters: { type: 'object', properties: { indicadores: { type: 'array', items: { type: 'string' }, description: 'Até 20 indicadores' } }, required: ['indicadores'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'listar_bloqueios_do_cliente',
        description: 'Lista os bloqueios da lista de um cliente, com filtros.',
        parameters: {
          type: 'object',
          properties: {
            cliente: { type: 'string', description: 'Nome do cliente' },
            status: { type: 'string', enum: ['active', 'removed', 'ALL'], description: 'Padrão: active' },
            periodo: { type: 'string', enum: ['7d', '30d', 'year', 'ALL'], description: 'Incluídos neste período' },
            busca: { type: 'string', description: 'Trecho de IP, ticket ou observação' }
          },
          required: ['cliente']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fila_de_revisao',
        description: 'Bloqueios parados há muito tempo (sem reaparecer nem denúncias recentes), candidatos a remoção.',
        parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'Opcional: só deste cliente' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'indicadores_em_comum',
        description: 'Indicadores presentes em 2 ou mais clientes (correlação), do mais espalhado ao menos.',
        parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'Opcional: que envolvam este cliente' }, busca: { type: 'string' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'historico_de_importacoes',
        description: 'Últimas importações semanais gravadas (quem, quando, quantos incluídos e descartados).',
        parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'Opcional' }, limite: { type: 'number', description: 'Padrão 10' } } }
      }
    }
  ];

  const toolLabel: Record<string, (a: any) => string> = {
    consultar_indicadores: (a) => `Consultando ${(a.indicadores ?? []).slice(0, 3).join(', ')}${(a.indicadores ?? []).length > 3 ? '…' : ''}`,
    listar_bloqueios_do_cliente: (a) => `Lendo a lista de ${a.cliente ?? 'cliente'}`,
    fila_de_revisao: (a) => `Verificando a fila de revisão${a.cliente ? ` de ${a.cliente}` : ''}`,
    indicadores_em_comum: () => 'Cruzando indicadores entre clientes',
    historico_de_importacoes: (a) => `Lendo o histórico${a.cliente ? ` de ${a.cliente}` : ''}`
  };

  async function runTool(actor: Actor, name: string, args: any): Promise<string> {
    const clients = await store.getAllClients();
    const clientOrError = (n?: string) => {
      const c = findClient(clients, n);
      return c ? { c } : { error: `Cliente "${n}" não encontrado. Clientes: ${clients.map((x) => x.name).join(', ')}.` };
    };
    switch (name) {
      case 'consultar_indicadores': {
        const list = (Array.isArray(args.indicadores) ? args.indicadores : [args.indicadores]).map(String).filter(Boolean).slice(0, 20);
        if (!list.length) return 'Nenhum indicador informado.';
        const [results, rep] = await Promise.all([store.lookupIndicators(actor, list), reputation(list, 5)]);
        return results
          .map((r) => {
            if (!r.valid) return `${r.query}: não é um IP, CIDR ou domínio válido.`;
            const where = r.matches.length
              ? r.matches
                  .map((raw) => { const m = raw as unknown as LookupRow; return `${m.clientName} (${m.status === 'active' ? 'ativo' : 'removido'}${m.match === 'covered' ? `, dentro de ${m.via}` : m.match === 'inside' ? `, contém ${m.indicator}` : ''}; incluído ${fmtDate(m.addedDate)}${m.sourceTicket ? `; ticket ${m.sourceTicket}` : ''}${m.notes ? `; obs: ${clip(m.notes, 60)}` : ''})`; })
                  .join('; ')
              : 'não está em nenhuma lista';
            const exceptions = clients.filter((c) => c.exceptions?.some((x) => x.indicator === r.normalized)).map((c) => c.name);
            // A conta "onde falta" já vai pronta: modelos pequenos erram esse tipo de diferença.
            const active = clients.filter((c) => !c.isArchived);
            const blocked = new Set(r.matches.map((raw) => raw as unknown as LookupRow).filter((m) => m.status === 'active').map((m) => m.clientName));
            const missing = active.filter((c) => !blocked.has(c.name) && !exceptions.includes(c.name)).map((c) => c.name);
            return [
              `${r.normalized}: ${where}.`,
              `Bloqueado (ativo) em ${blocked.size} de ${active.length} clientes.`,
              `NÃO está bloqueado em: ${missing.length ? missing.join(', ') : 'nenhum (está em todos)'}.`,
              exceptions.length ? `Exceção (nunca bloquear) em: ${exceptions.join(', ')}.` : '',
              ctiLine(rep[r.normalized])
            ].filter(Boolean).join(' ');
          })
          .join('\n');
      }
      case 'listar_bloqueios_do_cliente': {
        const found = clientOrError(args.cliente);
        if ('error' in found) return found.error!;
        const page = await store.getClientEntriesPage(actor, {
          clientId: found.c.id,
          status: ['active', 'removed', 'ALL'].includes(args.status) ? args.status : 'active',
          period: ['7d', '30d', 'year', 'ALL'].includes(args.periodo) ? args.periodo : 'ALL',
          search: typeof args.busca === 'string' ? args.busca : undefined,
          sort: 'date',
          page: 1,
          pageSize: 40
        });
        const rows = page.entries.map((e) => `${e.indicator} [${e.type}] ${e.status === 'active' ? 'ativo' : 'removido'} · incluído ${fmtDate(e.addedDate)}${e.sourceTicket ? ` · ${e.sourceTicket}` : ''}${e.notes ? ` · ${clip(e.notes, 50)}` : ''}`);
        return `${found.c.name}: ${page.total} resultado(s) (lista com ${page.activeCount} ativos).${page.total > rows.length ? ` Mostrando ${rows.length}.` : ''}\n${rows.join('\n')}`;
      }
      case 'fila_de_revisao': {
        let clientId: string | undefined;
        if (args.cliente) {
          const found = clientOrError(args.cliente);
          if ('error' in found) return found.error!;
          clientId = found.c.id;
        }
        const queue = await store.getReviewQueue(actor, clientId);
        if (!queue.items.length) return `Nada para revisar (critério: ${queue.reviewDays} dias sem atividade).`;
        return `${queue.items.length} item(ns) parados há mais de ${queue.reviewDays} dias:\n` + queue.items.slice(0, 30)
          .map((i) => `${i.entry.indicator} · ${i.clientName} · parado há ${i.daysIdle ?? '?'} dias${i.score !== null ? ` · AbuseIPDB ${i.score}%` : ''}${i.lastReportedAt ? ` · última denúncia ${fmtDate(i.lastReportedAt)}` : ''}`)
          .join('\n');
      }
      case 'indicadores_em_comum': {
        let clientId: string | undefined;
        if (args.cliente) {
          const found = clientOrError(args.cliente);
          if ('error' in found) return found.error!;
          clientId = found.c.id;
        }
        const page = await store.getCorrelationPage(actor, { clientId, search: typeof args.busca === 'string' ? args.busca : undefined, page: 1, pageSize: 20 });
        if (!page.sharedIndicators.length) return 'Nenhum indicador em comum entre clientes.';
        return `${page.total} indicador(es) em 2+ clientes:\n` + page.sharedIndicators
          .map((s) => `${s.indicator} [${s.type}] em ${s.occurrencesCount} clientes: ${s.clientNames.join(', ')} (severidade ${s.severity})`)
          .join('\n');
      }
      case 'historico_de_importacoes': {
        let clientId: string | undefined;
        if (args.cliente) {
          const found = clientOrError(args.cliente);
          if ('error' in found) return found.error!;
          clientId = found.c.id;
        }
        const records = (await store.getHistoryRecords(actor, clientId)).slice(0, Math.min(Number(args.limite) || 10, 25));
        if (!records.length) return 'Nenhuma importação registrada.';
        return records
          .map((h) => `${fmtDate(h.date)} · ${h.clientName} · por ${h.importedBy ?? '—'} · +${h.addedCount} incluídos (antes ${h.totalBefore}, depois ${h.totalAfter}) · descartados: ${h.duplicatesDiscarded} repetidos, ${h.coveredByCidrDiscarded} em CIDR, ${h.invalidsDiscarded} inválidos${h.sourceTicket ? ` · ${h.sourceTicket}` : ''}`)
          .join('\n');
      }
      default:
        return `Ferramenta desconhecida: ${name}.`;
    }
  }

  const RULES = `Você é o assistente do GuardList, sistema interno de gestão das blocklists de firewall dos clientes de uma equipe de segurança.
Regras:
- Responda em português do Brasil, direto e curto. Use Markdown simples: frases curtas, listas com "-", **negrito** e \`código\` para IPs, CIDRs e domínios.
- Use APENAS os dados do panorama e das ferramentas. Nunca invente IPs, números, datas, clientes ou reputação. Se faltar dado, diga isso.
- Você não altera nada. Para agir, indique onde fazer no GuardList: botão direito no IP → "Bloquear em clientes…" ou "Adicionar exceção…"; telas "Revisão de bloqueios", "Importação semanal", "Listas dos clientes".
- Conceitos: cada cliente tem sua lista isolada; IP dentro de um CIDR já bloqueado é redundante; exceção = nunca bloquear naquele cliente; IPs de serviços legítimos (DNS público, CDN, nuvem de grandes provedores) merecem cuidado antes de bloquear.`;

  /** Conversa livre, com ferramentas. Emite eventos para o navegador conforme avança. */
  async function chat(actor: Actor, history: Array<{ role: 'user' | 'assistant'; content: string }>, emit: (e: AiEvent) => void, signal: AbortSignal) {
    const t0 = Date.now();
    const used: string[] = [];
    let tokens = 0;
    await withSlot(() => emit({ type: 'status', text: 'Na fila: a IA está respondendo outra pessoa…' }), async () => {
      emit({ type: 'status', text: 'Lendo o panorama…' });
      const messages: ChatMessage[] = [
        { role: 'system', content: `${RULES}\n\nPanorama atual:\n${await panorama()}` },
        ...history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      ];
      for (let round = 0; round < 4; round++) {
        emit({ type: 'status', text: round === 0 ? 'Pensando…' : 'Escrevendo a resposta…' });
        const result = await streamCompletion(messages, {
          tools: round < 3 ? tools : undefined,
          signal,
          onText: (text) => emit({ type: 'text', text })
        });
        tokens += result.tokens ?? 0;
        if (!result.toolCalls.length) break;
        messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
        for (const call of result.toolCalls) {
          let args: any = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* argumentos inválidos: segue com vazio */ }
          emit({ type: 'status', text: (toolLabel[call.function.name] ?? (() => 'Consultando dados'))(args) + '…' });
          used.push(call.function.name);
          const output = await runTool(actor, call.function.name, args).catch((err) => `Erro ao consultar: ${err instanceof Error ? err.message : 'falha'}`);
          messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 6000) });
        }
      }
    });
    await auditAi(actor, 'ai.chat', { question: clip(history.at(-1)?.content, 300), tools: used, ms: Date.now() - t0 });
    emit({ type: 'done', model: aiSettings().model, ms: Date.now() - t0, tokens: tokens || undefined });
  }

  /** Análise de um indicador (menu do botão direito): o GuardList junta os fatos; a IA só redige. */
  async function analyzeIndicator(actor: Actor, indicator: string, emit: (e: AiEvent) => void, signal: AbortSignal) {
    const t0 = Date.now();
    let tokens = 0;
    await withSlot(() => emit({ type: 'status', text: 'Na fila: a IA está respondendo outra pessoa…' }), async () => {
      emit({ type: 'status', text: `Juntando os dados de ${indicator}…` });
      const facts = await runTool(actor, 'consultar_indicadores', { indicadores: [indicator] });
      const entries = await store.getIndicatorEntries(actor, indicator).catch(() => []);
      const clients = await store.getAllClients();
      const names = new Map(clients.map((c) => [c.id, c.name]));
      const timeline = entries
        .slice(0, 15)
        .map((e) => `${fmtDate(e.addedDate)} · ${names.get(e.clientId) ?? e.clientId} · ${e.status === 'active' ? 'ativo' : 'removido'}${e.sourceTicket ? ` · ${e.sourceTicket}` : ''}${e.lastSeenAt ? ` · reapareceu ${fmtDate(e.lastSeenAt)}` : ''}${e.removedAt ? ` · removido ${fmtDate(e.removedAt)} por ${e.removedBy ?? '—'}` : ''}`)
        .join('\n');
      emit({ type: 'status', text: 'Escrevendo a análise…' });
      const messages: ChatMessage[] = [
        { role: 'system', content: `${RULES}\n\nTotal de clientes ativos: ${clients.filter((c) => !c.isArchived).length}.` },
        {
          role: 'user',
          content: `Analise o indicador ${indicator} com base nestes dados do GuardList.\n\nSituação:\n${facts}\n\nLinha do tempo:\n${timeline || 'sem registros'}\n\nResponda com estas seções curtas:\n**Resumo** (1-2 frases)\n**Onde está** (clientes e situação)\n**Reputação** (o que os dados dizem; se não houver, diga que não foi consultada)\n**Recomendação** (bloquear nos demais clientes, manter, revisar ou tratar como exceção — e por quê)`
        }
      ];
      const result = await streamCompletion(messages, { signal, onText: (text) => emit({ type: 'text', text }) });
      tokens = result.tokens ?? 0;
    });
    await auditAi(actor, 'ai.indicator', { indicator, ms: Date.now() - t0 });
    emit({ type: 'done', model: aiSettings().model, ms: Date.now() - t0, tokens: tokens || undefined });
  }

  /**
   * Motivo do caso enviado ao cliente (só os parágrafos de contexto). A lista de indicadores e o ticket
   * são montados pelo GuardList; a IA não escreve endereços nem nomes de clientes.
   */
  async function writeCaseReason(
    actor: Actor,
    input: { ips: string[]; cidrs: string[]; domains: string[]; note?: string },
    emit: (e: AiEvent) => void,
    signal: AbortSignal
  ) {
    const t0 = Date.now();
    let tokens = 0;
    await withSlot(() => emit({ type: 'status', text: 'Na fila: a IA está respondendo outra pessoa…' }), async () => {
      emit({ type: 'status', text: 'Lendo a reputação dos indicadores…' });
      const ips = input.ips.slice(0, 40);
      const rep = await reputation(ips, 10);
      const known = ips.map((ip) => rep[ip]).filter(Boolean) as CtiSummary[];
      const verdicts = known.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] ?? 0) + 1 }), {});
      const usage = [...new Set(known.map((c) => c.usageType).filter(Boolean))].slice(0, 4);
      const gn = [...new Set(known.map((c) => c.greyNoise?.classification).filter(Boolean))];
      const isps = [...new Set(known.map((c) => c.isp).filter(Boolean))].slice(0, 4);
      const maxReports = Math.max(0, ...known.map((c) => c.totalReports ?? 0));
      const singular = input.ips.length + input.cidrs.length + input.domains.length === 1;
      const what = [
        input.ips.length ? `${input.ips.length} endereço(s) IP` : '',
        input.cidrs.length ? `${input.cidrs.length} faixa(s) de rede CIDR` : '',
        input.domains.length ? `${input.domains.length} domínio(s)` : ''
      ].filter(Boolean).join(' e ');
      const facts = known.length
        ? `Reputação consultada de ${known.length} IP(s): vereditos ${JSON.stringify(verdicts)}; tipos de uso: ${usage.join(', ') || '—'}; GreyNoise: ${gn.join(', ') || '—'}; provedores: ${isps.join(', ') || '—'}; maior número de denúncias no AbuseIPDB: ${maxReports}.`
        : 'Não há dados de reputação consultados para esses indicadores.';
      emit({ type: 'status', text: 'Escrevendo o motivo…' });
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `Você escreve, em português do Brasil formal, o trecho de MOTIVO de um e-mail enviado a um cliente informando bloqueios no firewall.
Regras: exatamente 2 parágrafos curtos separados por uma linha em branco; não cite nomes de clientes; não liste endereços IP, faixas nem domínios (a lista vem depois); não invente números, ataques ou fontes que não estejam nos dados; termine dizendo que, como medida preventiva, foi realizado o bloqueio ${singular ? 'da origem identificada' : 'das origens identificadas'}. Não escreva saudação, despedida, título nem a frase "Após a análise dos eventos". Use ${singular ? 'singular' : 'plural'}.
Exemplo do estilo da equipe:
"Durante as atividades de monitoramento dos eventos de segurança, foram identificadas conexões originadas de endereços IP associados a serviços automatizados de varredura na Internet.

Essas origens realizam atividades de reconhecimento em ativos expostos, buscando identificar portas abertas e serviços acessíveis. Embora esse comportamento, por si só, não caracterize uma tentativa de comprometimento, ele pode representar uma etapa inicial de reconhecimento utilizada antes de possíveis ataques. Como medida preventiva, foi realizado o bloqueio dos endereços identificados."`
        },
        {
          role: 'user',
          content: `Bloqueados: ${what}.\n${facts}${input.note?.trim() ? `\nObservação do analista sobre o que foi visto: ${clip(input.note, 400)}` : ''}\n\nEscreva o motivo.`
        }
      ];
      const result = await streamCompletion(messages, { signal, maxTokens: 400, onText: (text) => emit({ type: 'text', text }) });
      tokens = result.tokens ?? 0;
    });
    await auditAi(actor, 'ai.case_reason', { ips: input.ips.length, cidrs: input.cidrs.length, domains: input.domains.length, ms: Date.now() - t0 });
    emit({ type: 'done', model: aiSettings().model, ms: Date.now() - t0, tokens: tokens || undefined });
  }

  async function auditAi(actor: Actor, action: string, detail: Record<string, unknown>) {
    await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [actor.username, action, JSON.stringify(detail)]).catch(() => undefined);
  }

  /** Teste da página de status: responde? quão rápido? */
  async function test() {
    const s = aiSettings();
    if (!aiConfigured()) return { configured: false as const };
    const t0 = Date.now();
    let firstTokenMs: number | null = null;
    const result = await streamCompletion(
      [{ role: 'user', content: 'Responda só com: GuardList conectado.' }],
      { signal: AbortSignal.timeout(Math.min(s.timeoutMs, 120_000)), maxTokens: 30, onText: () => { firstTokenMs ??= Date.now() - t0; } }
    );
    const ms = Date.now() - t0;
    return { configured: true as const, model: s.model, baseUrl: s.baseUrl, reply: result.content.slice(0, 120), ms, firstTokenMs, tokens: result.tokens ?? null };
  }

  return { chat, analyzeIndicator, writeCaseReason, test };
}

export type Ai = ReturnType<typeof createAi>;
