import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, ClipboardCheck, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Client, CtiSummary } from '../types';
import { enrichIndicators, getReviewQueue, reviewEntries, updateEntryStatus, type ReviewItem } from '../db/store';
import { formatDateBR } from '../utils/csv';
import { VerdictBadge } from './CtiBits';
import type { ShowToast } from '../App';

interface ReviewViewProps {
  clients: Client[];
  showToast: ShowToast;
  onRefresh: () => void;
  onOpenList: (clientId: string) => void;
}

// Fila de revisão: bloqueios antigos que não reapareceram em importações nem receberam denúncias recentes.
export const ReviewView: React.FC<ReviewViewProps> = ({ clients, showToast, onRefresh, onOpenList }) => {
  const [clientId, setClientId] = useState('ALL');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [reviewDays, setReviewDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [cti, setCti] = useState<Record<string, CtiSummary>>({});
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getReviewQueue(clientId === 'ALL' ? undefined : clientId);
      setItems(result.items);
      setReviewDays(result.reviewDays);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleIds = useMemo(() => items.map((i) => i.entry.id), [items]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const decide = async (ids: string[], decision: 'keep' | 'remove') => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await reviewEntries(ids, decision);
      const removedItems = items.filter((i) => ids.includes(i.entry.id));
      await load();
      onRefresh();
      showToast(
        decision === 'keep' ? `${ids.length} mantido(s); voltam a contar a partir de hoje.` : `${ids.length} removido(s) da lista.`,
        decision === 'remove'
          ? {
              action: {
                label: 'Desfazer',
                onClick: async () => {
                  for (const item of removedItems) await updateEntryStatus(item.entry.id, 'active');
                  await load();
                  onRefresh();
                  showToast('Remoção desfeita.', 'info');
                }
              }
            }
          : undefined
      );
    } finally {
      setBusy(false);
    }
  };

  // Consulta a reputação atual dos IPs da fila: denúncia recente tira o item da revisão.
  const checkReputation = async () => {
    const ips = items.map((i) => i.entry.indicator).filter((x) => !x.includes('/'));
    if (ips.length === 0) return;
    setChecking(true);
    try {
      const result = await enrichIndicators(ips.slice(0, 100), true);
      setCti((prev) => ({ ...prev, ...result.results }));
      if (!result.configured) showToast('Nenhuma chave de reputação configurada no servidor.', 'info');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha na consulta.', 'info');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revisão de bloqueios"
        description={`Bloqueios há mais de ${reviewDays} dias sem reaparecer nas importações, sem revisão e sem denúncias recentes. Mantenha o que ainda faz sentido e remova o resto.`}
        actions={
          <>
            <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Cliente">
              <option value="ALL">Todos os clientes</option>
              {clients.filter((c) => !c.isArchived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn" onClick={checkReputation} disabled={checking || items.length === 0} title="Consulta AbuseIPDB, GreyNoise e OTX (até 100 IPs)">
              {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Atualizar reputação
            </button>
          </>
        }
      />

      {items.length > 0 && <div className="action-bar">
        <div className="action-bar__group">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />
            Selecionar todos ({items.length})
          </label>
        </div>
        <div className="action-bar__group">
          <button type="button" className="btn" disabled={busy || selected.size === 0} onClick={() => decide([...selected], 'keep')}>
            <CheckCheck aria-hidden="true" />
            Manter {selected.size || ''}
          </button>
          <button type="button" className="btn btn--danger" disabled={busy || selected.size === 0} onClick={() => decide([...selected], 'remove')}>
            <Trash2 aria-hidden="true" />
            Remover {selected.size || ''}
          </button>
        </div>
      </div>}

      <section className="data-panel">
        {loading ? (
          <div className="empty-state"><Loader2 className="animate-spin" aria-hidden="true" /><p>Carregando a fila…</p></div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <ClipboardCheck aria-hidden="true" />
            <strong>Nada para revisar</strong>
            <p>Todos os bloqueios reapareceram, foram revisados ou têm denúncias nos últimos {reviewDays} dias.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Indicador</th>
                  <th>Cliente</th>
                  <th>Incluído</th>
                  <th>Última atividade</th>
                  <th className="text-right">Parado há</th>
                  <th>Reputação</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const rep = cti[item.entry.indicator.toLowerCase()];
                  return (
                    <tr key={item.entry.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${item.entry.indicator}`}
                          checked={selected.has(item.entry.id)}
                          onChange={() => setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.entry.id)) next.delete(item.entry.id);
                            else next.add(item.entry.id);
                            return next;
                          })}
                        />
                      </td>
                      <td className="font-mono text-white">{item.entry.indicator}</td>
                      <td>
                        <button type="button" className="data-table__primary" onClick={() => onOpenList(item.entry.clientId)}>{item.clientName}</button>
                      </td>
                      <td className="font-mono whitespace-nowrap">{formatDateBR(item.entry.addedDate)}</td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDateBR(item.lastActivity)}
                        {item.entry.reviewedAt && <span className="text-slate-500"> · revisado</span>}
                      </td>
                      <td className="text-right font-mono tabular-nums">{item.daysIdle ?? '—'} d</td>
                      <td>
                        {rep ? (
                          <span className="flex items-center gap-2"><VerdictBadge summary={rep} /><small className="text-slate-400">{rep.totalReports ?? 0} denúncias</small></span>
                        ) : item.totalReports !== null ? (
                          <small className="text-slate-400">{item.totalReports} denúncias · score {item.score ?? 0}</small>
                        ) : (
                          <small className="text-slate-500">Não consultado</small>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => decide([item.entry.id], 'keep')}>Manter</button>{' '}
                        <button type="button" className="btn btn--sm btn--quiet btn--danger" disabled={busy} onClick={() => decide([item.entry.id], 'remove')}>Remover</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-slate-500">
        O prazo de {reviewDays} dias é ajustado por um administrador em Backup e ajustes. Um item sai da fila quando reaparece numa importação, recebe denúncia recente ou é mantido aqui.
      </p>
    </div>
  );
};
