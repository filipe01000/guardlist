import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, ShieldOff, ShieldPlus } from 'lucide-react';
import type { BlocklistEntry, Client } from '../types';
import { importBatch, lookupIndicators, updateClientExceptions, type LookupMatch } from '../db/store';
import { checkReservedRange, classifyIndicator, getIsoWeek, ipv4ToNumber } from '../utils/validator';
import { Modal } from './Modal';
import { TYPE_LABEL } from './contextActions';
import type { ShowToast } from '../App';

export type IndicatorActionMode = 'block' | 'exception';

interface Props {
  request: { indicator: string; mode: IndicatorActionMode } | null;
  clients: Client[];
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  showToast: ShowToast;
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * Ação rápida sobre um indicador, aberta pelo menu de contexto:
 * bloquear em vários clientes de uma vez ou cadastrar como exceção (nunca bloquear).
 * Mostra antes onde o indicador já está, para não gravar repetido.
 */
export const IndicatorActionModal: React.FC<Props> = ({ request, clients, isAdmin, onClose, onDone, showToast }) => {
  const [matches, setMatches] = useState<LookupMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ticket, setTicket] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const indicator = request?.indicator ?? '';
  const mode = request?.mode ?? 'block';
  const type = classifyIndicator(indicator).type;
  const reserved = useMemo(() => (indicator ? checkReservedRange(indicator) : null), [indicator]);
  const activeClients = useMemo(() => clients.filter((c) => !c.isArchived).sort((a, b) => a.name.localeCompare(b.name)), [clients]);

  useEffect(() => {
    if (!request) return;
    setSelected(new Set());
    setTicket('');
    setNote('');
    setError(null);
    setMatches(null);
    let cancelled = false;
    lookupIndicators([request.indicator])
      .then((r) => { if (!cancelled) setMatches(r[0]?.matches ?? []); })
      .catch(() => { if (!cancelled) setMatches([]); });
    return () => { cancelled = true; };
  }, [request]);

  // Situação do indicador em cada cliente: decide se a caixa fica disponível.
  const statusOf = (client: Client): { label: string; tone: 'ok' | 'warn' | 'muted'; locked: boolean } | null => {
    const isException = client.exceptions?.some((x) => x.indicator === indicator);
    const active = matches?.filter((m) => m.clientId === client.id && m.status === 'active') ?? [];
    const exact = active.find((m) => m.match === 'exact');
    const covered = active.find((m) => m.match === 'covered');
    if (mode === 'exception') {
      if (isException) return { label: 'Já é exceção', tone: 'muted', locked: true };
      if (exact || covered) return { label: exact ? 'Bloqueado: será retirado' : `Dentro de ${covered!.via || covered!.indicator}`, tone: 'warn', locked: false };
      return null;
    }
    if (isException) return { label: 'Exceção: recusado', tone: 'warn', locked: true };
    if (exact) return { label: 'Já bloqueado', tone: 'ok', locked: true };
    if (covered) return { label: `Já coberto por ${covered.via || covered.indicator}`, tone: 'ok', locked: true };
    if (matches?.some((m) => m.clientId === client.id && m.status === 'removed')) return { label: 'Removido antes', tone: 'muted', locked: false };
    return null;
  };

  const available = activeClients.filter((c) => !statusOf(c)?.locked);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!selected.size) return;
    setSaving(true);
    setError(null);
    try {
      const targets = activeClients.filter((c) => selected.has(c.id));
      if (mode === 'block') {
        let added = 0;
        let pending = 0;
        for (const client of targets) {
          const entry: BlocklistEntry = {
            id: `entry-${client.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            clientId: client.id,
            indicator,
            originalInput: indicator,
            type,
            addedDate: today(),
            sourceTicket: ticket.trim() || undefined,
            status: 'active',
            notes: note.trim() || 'Incluído pelo menu de ações',
            isReservedAlert: Boolean(reserved?.isReserved),
            reservedReason: reserved?.reason,
            numericValue: type === 'IPv4' ? ipv4ToNumber(indicator) : undefined
          };
          const outcome = await importBatch({
            clientId: client.id,
            mode: 'append',
            entries: [entry],
            todayStr: today(),
            seen: [],
            adHoc: true,
            history: {
              id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              isoWeek: getIsoWeek(),
              sourceTicket: ticket.trim() || undefined,
              duplicatesDiscarded: 0,
              coveredByCidrDiscarded: 0,
              invalidsDiscarded: 0,
              notes: `Bloqueio avulso de ${indicator} pelo menu de ações`
            }
          });
          if (outcome.status === 'pending') pending++;
          else added += outcome.added;
        }
        const parts: string[] = [];
        if (added) parts.push(`${indicator} bloqueado em ${added === 1 ? '1 cliente' : `${added} clientes`}.`);
        if (pending) parts.push(`${pending === 1 ? '1 pedido enviado' : `${pending} pedidos enviados`} para aprovação.`);
        showToast(parts.join(' ') || 'Nada novo para gravar.', pending && !added ? 'info' : 'success');
      } else {
        let retired = 0;
        for (const client of targets) {
          const list = [...(client.exceptions ?? []).map(({ indicator: i, reason }) => ({ indicator: i, reason })), { indicator, reason: note.trim() || undefined }];
          const result = await updateClientExceptions(client.id, list);
          retired += result.retired;
        }
        showToast(
          `${indicator} agora é exceção em ${targets.length === 1 ? '1 cliente' : `${targets.length} clientes`}.${retired ? ` ${retired} bloqueio(s) retirado(s).` : ''}`
        );
      }
      await onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gravar.');
    } finally {
      setSaving(false);
    }
  };

  const isBlock = mode === 'block';
  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      size="md"
      title={isBlock ? 'Bloquear em clientes' : 'Adicionar exceção'}
      subtitle={
        <span>
          <span className="font-mono text-[var(--text)]">{indicator}</span> · {TYPE_LABEL[type] ?? type}
          {isBlock ? ' — entra na lista dos clientes marcados.' : ' — nunca será bloqueado nos clientes marcados.'}
        </span>
      }
      footer={
        <>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancelar</button>
          <button type="button" className={isBlock ? 'btn btn--primary' : 'btn btn--destructive'} disabled={!selected.size || saving} onClick={submit}>
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : isBlock ? <ShieldPlus aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            {isBlock ? 'Bloquear' : 'Adicionar exceção'}{selected.size ? ` em ${selected.size}` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {reserved?.isReserved && isBlock && (
          <div className="notice notice--warn">
            <AlertTriangle aria-hidden="true" />
            <p>Faixa reservada ({reserved.reason}). Confira se é mesmo para bloquear.</p>
          </div>
        )}
        {!isBlock && (
          <div className="notice">
            <ShieldOff aria-hidden="true" />
            <p>Se o indicador já estiver bloqueado num desses clientes, o bloqueio é retirado (fica no histórico como removido).</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="field-label !mb-0">Clientes</span>
            {available.length > 0 && (
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => setSelected(selected.size === available.length ? new Set() : new Set(available.map((c) => c.id)))}
              >
                {selected.size === available.length ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            )}
          </div>
          {matches === null ? (
            <div className="empty-state py-6"><Loader2 className="animate-spin" aria-hidden="true" /><p>Verificando onde o indicador já está…</p></div>
          ) : (
            <ul className="ia-clients" role="list">
              {activeClients.map((client) => {
                const status = statusOf(client);
                const locked = Boolean(status?.locked);
                return (
                  <li key={client.id}>
                    <label className={`ia-client${locked ? ' is-locked' : ''}${selected.has(client.id) ? ' is-on' : ''}`}>
                      <input type="checkbox" disabled={locked} checked={selected.has(client.id)} onChange={() => toggle(client.id)} />
                      <span className="ia-client__name">{client.name}</span>
                      {status && <span className={`chip chip--${status.tone === 'muted' ? '' : status.tone}`.trim()}>{status.label}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={isBlock ? 'grid gap-3 sm:grid-cols-2' : ''}>
          {isBlock && (
            <div>
              <label className="field-label" htmlFor="ia-ticket">Ticket / fonte</label>
              <input id="ia-ticket" className="field w-full" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="SEC-1234" maxLength={80} />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="ia-note">{isBlock ? 'Observação' : 'Motivo da exceção'}</label>
            <input
              id="ia-note"
              className="field w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isBlock ? 'Ex.: varredura SSH no firewall' : 'Ex.: IP do parceiro de backup'}
              maxLength={200}
            />
          </div>
        </div>

        {!isAdmin && isBlock && <p className="text-[11px] text-[var(--muted)]">Se a sua conta exigir aprovação, o pedido vai para um administrador antes de entrar na lista.</p>}
        {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
