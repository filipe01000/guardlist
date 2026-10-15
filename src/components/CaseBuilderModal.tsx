import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, CalendarClock, Check, ClipboardCheck, Copy, Loader2, Plus, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import type { BlocklistEntry, Client, SessionUser } from '../types';
import { checkClientCase, getAllActiveEntries, importBatch, saveClientCase, streamAi, type CaseCheck } from '../db/store';
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
import { checkReservedRange, classifyIndicator, getIsoWeek, ipv4ToNumber } from '../utils/validator';
import { formatDateBR } from '../utils/csv';
import { Modal } from './Modal';
import type { ShowToast } from '../App';
import './CaseBuilder.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Indicadores já preenchidos ao abrir (ex.: itens marcados na lista). */
  initialText?: string;
  /** Cliente já escolhido ao abrir (ex.: aberto pela lista de um cliente). */
  initialClientId?: string;
  clients: Client[];
  currentUser: SessionUser;
  aiEnabled: boolean;
  showToast: ShowToast;
  /** Chamado depois de incluir indicadores na lista do cliente. */
  onEntriesChanged?: () => void | Promise<void>;
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LIST_LABEL: Record<CaseCheck['items'][number]['list'], { text: string; tone: string }> = {
  listed: { text: 'Na lista', tone: 'ok' },
  covered: { text: 'Dentro de CIDR', tone: 'ok' },
  removed: { text: 'Removido da lista', tone: 'warn' },
  missing: { text: 'Fora da lista', tone: 'warn' }
};

/**
 * Texto do caso para o cliente: escolhe o cliente, cola os IPs (ou traz os incluídos hoje), valida com
 * as regras da importação e gera o corpo no modelo da equipe. Mostra a situação de cada IP na lista do
 * cliente e avisa quando um IP já foi informado em outro caso. Sem cliente e ticket TLD, nada é liberado.
 */
export const CaseBuilderModal: React.FC<Props> = ({ open, onClose, initialText, initialClientId, clients, currentUser, aiEnabled, showToast, onEntriesChanged }) => {
  const [clientId, setClientId] = useState('');
  const [raw, setRaw] = useState('');
  const [validated, setValidated] = useState<{ raw: string; result: CaseValidation } | null>(null);
  const [ticket, setTicket] = useState('');
  const [debouncedTicket, setDebouncedTicket] = useState('');
  const [reason, setReason] = useState<CaseReason>('scan');
  const [customReason, setCustomReason] = useState('');
  const [note, setNote] = useState('');
  const [loadingToday, setLoadingToday] = useState(false);
  const [onlyMine, setOnlyMine] = useState(true);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<'body' | 'subject' | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [check, setCheck] = useState<{ key: string; data: CaseCheck } | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [acceptRepeated, setAcceptRepeated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const aiAbort = useRef<AbortController | null>(null);

  const activeClients = useMemo(() => clients.filter((c) => !c.isArchived).sort((a, b) => a.name.localeCompare(b.name)), [clients]);
  const client = activeClients.find((c) => c.id === clientId) ?? null;

  useEffect(() => {
    if (!open) {
      aiAbort.current?.abort();
      return;
    }
    setClientId(initialClientId && clients.some((c) => c.id === initialClientId) ? initialClientId : '');
    setRaw(initialText ?? '');
    setValidated(initialText ? { raw: initialText, result: validateCaseIndicators(initialText) } : null);
    setEdited(null);
    setCopied(null);
    setCheck(null);
    setAcceptRepeated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText, initialClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTicket(ticket.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [ticket]);

  const validate = (text = raw) => {
    const result = validateCaseIndicators(text);
    setValidated({ raw: text, result });
    setEdited(null);
    setAcceptRepeated(false);
    return result;
  };

  const v = validated?.result ?? null;
  const stale = validated !== null && validated.raw !== raw;
  const kind = v ? caseKind(v) : 'empty';
  const indicators = useMemo(() => (v ? [...v.ips, ...v.cidrs, ...v.domains] : []), [v]);
  const ticketOk = ticket.trim().length > 0;

  // Situação de cada indicador no cliente escolhido + casos anteriores.
  const checkKey = `${clientId}|${debouncedTicket}|${indicators.join(',')}|${refreshKey}`;
  useEffect(() => {
    if (!open || !clientId || !indicators.length || stale) return;
    let cancelled = false;
    setChecking(true);
    checkClientCase(clientId, indicators, debouncedTicket)
      .then((data) => { if (!cancelled) setCheck({ key: checkKey, data }); })
      .catch((err) => { if (!cancelled) showToast(err instanceof Error ? err.message : 'Não foi possível conferir o cliente.', 'warn'); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkKey, stale]);

  const current = check && check.key === checkKey ? check.data : null;
  const repeated = current?.items.filter((i) => i.previousCase) ?? [];
  const missing = current?.items.filter((i) => i.list === 'missing' || i.list === 'removed') ?? [];
  const checked = Boolean(clientId && current);
  const blockedByRepeat = repeated.length > 0 && !acceptRepeated;

  const loadToday = async () => {
    setLoadingToday(true);
    try {
      const today = localToday();
      const entries = (await getAllActiveEntries()).filter(
        (e) => e.addedDate === today && (!clientId || e.clientId === clientId) && (!onlyMine || e.addedBy === currentUser.displayName || e.addedBy === currentUser.username)
      );
      const text = [...new Set(entries.map((e) => e.indicator))].join('\n');
      if (!text) {
        showToast(`Nenhum indicador incluído hoje${client ? ` em ${client.name}` : ''}${onlyMine ? ' por você' : ''}.`, 'info');
        return;
      }
      setRaw(text);
      const result = validate(text);
      showToast(`${caseSummary(result)} incluídos hoje${client ? ` em ${client.name}` : ''}.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível buscar os itens de hoje.', 'warn');
    } finally {
      setLoadingToday(false);
    }
  };

  // Tira do caso os que já foram informados (mantém o restante da colagem).
  const dropRepeated = () => {
    const drop = new Set(repeated.map((r) => r.indicator));
    const text = indicators.filter((i) => !drop.has(i)).join('\n');
    setRaw(text);
    validate(text);
    showToast(`${drop.size} indicador(es) já informado(s) retirado(s) do caso.`, 'info');
  };

  // Inclui na lista do cliente os que ainda não estão (bloqueio avulso: não conta como manutenção semanal).
  const addMissing = async () => {
    if (!client || !missing.length) return;
    setAdding(true);
    try {
      const day = localToday();
      const entries: BlocklistEntry[] = missing.map(({ indicator }) => {
        const type = classifyIndicator(indicator).type;
        const reserved = checkReservedRange(indicator);
        return {
          id: `entry-${client.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          clientId: client.id,
          indicator,
          originalInput: indicator,
          type,
          addedDate: day,
          sourceTicket: ticket.trim() || undefined,
          status: 'active',
          notes: 'Incluído pelo gerador de caso',
          isReservedAlert: reserved.isReserved,
          reservedReason: reserved.reason,
          numericValue: type === 'IPv4' ? ipv4ToNumber(indicator) : undefined
        };
      });
      const outcome = await importBatch({
        clientId: client.id,
        mode: 'append',
        entries,
        todayStr: day,
        seen: [],
        adHoc: true,
        history: {
          id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          isoWeek: getIsoWeek(),
          sourceTicket: ticket.trim() || undefined,
          duplicatesDiscarded: 0,
          coveredByCidrDiscarded: 0,
          invalidsDiscarded: 0,
          notes: `Incluídos pelo gerador de caso${ticket.trim() ? ` (${ticket.trim()})` : ''}`
        }
      });
      showToast(
        outcome.status === 'pending'
          ? `Pedido de inclusão em ${client.name} enviado para aprovação.`
          : `${outcome.added} indicador(es) incluído(s) na lista de ${client.name}.`,
        outcome.status === 'pending' ? 'info' : 'success'
      );
      await onEntriesChanged?.();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível incluir na lista.', 'warn');
    } finally {
      setAdding(false);
    }
  };

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
  const canCopy = Boolean(generated && client && checked && !stale && !blockedByRepeat);

  const copy = async (what: 'body' | 'subject') => {
    const text = what === 'body' ? body : generated?.subject ?? '';
    let copiedOk = true;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      copiedOk = false;
      // Sem acesso à área de transferência: deixa o texto selecionado para o Ctrl+C.
      const area = document.querySelector<HTMLTextAreaElement>('.cb-output');
      if (what === 'body' && area) {
        area.focus();
        area.select();
      }
      showToast('Não foi possível copiar automaticamente. O texto ficou selecionado: use Ctrl+C.', 'warn');
    }
    // Ao copiar o texto, o caso fica registrado: os próximos casos deste cliente avisam se repetirem estes IPs.
    if (what === 'body' && client) {
      try {
        const saved = await saveClientCase(client.id, ticket, indicators);
        if (copiedOk) showToast(`Caso ${saved.ticket} registrado para ${saved.clientName} (${saved.count} indicador${saved.count === 1 ? '' : 'es'}).`);
        setRefreshKey((k) => k + 1);
      } catch (err) {
        showToast(err instanceof Error ? `Texto copiado, mas o caso não foi registrado: ${err.message}` : 'Caso não registrado.', 'warn');
      }
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
  const footHint = !client
    ? 'Escolha o cliente do caso.'
    : v && kind !== 'empty' && !ticketOk
      ? 'Informe o ticket TLD para liberar o texto.'
      : blockedByRepeat
        ? `${repeated.length} indicador(es) já informado(s) em outro caso.`
        : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Gerar caso para o cliente"
      subtitle="Escolha o cliente, valide os indicadores e informe o ticket TLD. O nome do cliente não aparece no texto."
      footer={
        <>
          <span className={`cb-foot-hint${blockedByRepeat ? ' is-warn' : ''}`}>{footHint}</span>
          <button type="button" className="btn" disabled={!canCopy} onClick={() => copy('subject')}>
            {copied === 'subject' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied === 'subject' ? 'Assunto copiado' : 'Copiar assunto'}
          </button>
          <button type="button" className="btn btn--primary" disabled={!canCopy} onClick={() => copy('body')} title="Copia o texto e registra o caso para este cliente">
            {copied === 'body' ? <Check aria-hidden="true" /> : <ClipboardCheck aria-hidden="true" />}
            {copied === 'body' ? 'Texto copiado' : 'Copiar texto do caso'}
          </button>
        </>
      }
    >
      <div className="cb-grid">
        {/* ---------- Cliente, indicadores e validação ---------- */}
        <section className="cb-col">
          <div className="cb-step"><span>1</span> Cliente e indicadores</div>
          <div className="cb-client">
            <Building2 aria-hidden="true" />
            <select
              className={`field flex-1 min-w-0${!clientId ? ' is-invalid' : ''}`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Cliente do caso"
            >
              <option value="">Escolha o cliente do caso…</option>
              {activeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {client && current?.recentCases.length ? (
            <p className="cb-recent">
              Últimos casos de {client.name}: {current.recentCases.slice(0, 3).map((c) => `${c.ticket} (${formatDateBR(c.at)}, ${c.count})`).join(' · ')}
            </p>
          ) : null}

          <textarea
            className="field cb-input font-mono"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'Cole os IPs e CIDRs, um por linha\n192.42.116.105\n155.254.28.0/24'}
            spellCheck={false}
            aria-label="Indicadores do caso"
          />
          <div className="cb-actions">
            <button type="button" className="btn btn--sm" onClick={loadToday} disabled={loadingToday} title={client ? `Incluídos hoje em ${client.name}` : 'Incluídos hoje em todos os clientes'}>
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
                  {v.duplicates.length > 0 && <li>{v.duplicates.length} repetido(s) na colagem, retirado(s): <code>{v.duplicates.slice(0, 4).join(', ')}</code>{v.duplicates.length > 4 ? '…' : ''}</li>}
                  {v.covered.slice(0, 6).map((c) => (
                    <li key={c.indicator}><code>{c.indicator}</code> retirado: já está dentro de <code>{c.by}</code></li>
                  ))}
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

              {/* Situação no cliente escolhido */}
              {kind !== 'empty' && !stale && (
                !client ? (
                  <p className="cb-muted">Escolha o cliente para conferir a lista dele e os casos já enviados.</p>
                ) : !current ? (
                  <p className="cb-muted"><Loader2 className="animate-spin" aria-hidden="true" /> Conferindo {client.name}…</p>
                ) : (
                  <>
                    <div className="cb-table" role="table" aria-label={`Situação em ${client.name}`}>
                      {current.items.map((item) => (
                        <div key={item.indicator} role="row" className={`cb-row-item${item.previousCase ? ' is-repeat' : ''}`}>
                          <code role="cell" data-indicator={item.indicator}>{item.indicator}</code>
                          <span role="cell" className={`chip chip--${LIST_LABEL[item.list].tone}`} title={item.via ? `Dentro de ${item.via}` : undefined}>
                            {LIST_LABEL[item.list].text}
                          </span>
                          <span role="cell" className="cb-case-cell">
                            {item.previousCase ? (
                              <span className="cb-repeat" title={`Informado por ${item.previousCase.by || '—'}${item.previousCase.via ? ` (dentro de ${item.previousCase.via})` : ''}`}>
                                <AlertTriangle aria-hidden="true" />
                                Já informado: {item.previousCase.ticket} · {formatDateBR(item.previousCase.at)}{item.previousCase.via ? ` (em ${item.previousCase.via})` : ''}
                              </span>
                            ) : (
                              <span className="cb-new">Ainda não informado</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="cb-check-actions">
                      {repeated.length > 0 && (
                        <button type="button" className="btn btn--sm btn--destructive" onClick={dropRepeated}>
                          <X aria-hidden="true" /> Retirar os já informados ({repeated.length})
                        </button>
                      )}
                      {missing.length > 0 && (
                        <button type="button" className="btn btn--sm" onClick={addMissing} disabled={adding} title="Bloqueio avulso: não conta como a manutenção semanal">
                          {adding ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                          Adicionar {missing.length} à lista de {client.name}
                        </button>
                      )}
                      {checking && <Loader2 className="animate-spin cb-spin" aria-hidden="true" />}
                    </div>
                    {repeated.length > 0 && (
                      <label className="cb-check cb-accept">
                        <input type="checkbox" checked={acceptRepeated} onChange={(e) => setAcceptRepeated(e.target.checked)} />
                        Gerar mesmo assim com os já informados
                      </label>
                    )}
                  </>
                )
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
          <div className="cb-step"><span>3</span> Texto do caso{client ? <em className="cb-for">para {client.name}</em> : null}</div>
          {generated && client ? (
            <>
              <div className="cb-subject"><span>Assunto</span><code>{generated.subject}</code></div>
              <textarea
                className="field cb-output"
                value={body}
                onChange={(e) => setEdited(e.target.value)}
                spellCheck={false}
                aria-label="Texto do caso (pode editar antes de copiar)"
              />
              <p className="cb-hint">
                {blockedByRepeat
                  ? 'Há indicadores já informados: retire-os ou marque "Gerar mesmo assim".'
                  : edited !== null
                    ? 'Editado à mão. Mudar ticket, motivo ou lista refaz o texto.'
                    : 'Ao copiar, o caso fica registrado para este cliente.'}
              </p>
            </>
          ) : (
            <div className="cb-placeholder">
              <ClipboardCheck aria-hidden="true" />
              <p>
                {!client ? 'Escolha o cliente do caso.'
                  : !v ? 'Cole ou traga os indicadores e clique em Validar.'
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
