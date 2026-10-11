import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Download,
  FileText,
  History,
  LayoutGrid,
  List,
  ShieldCheck,
  Table as TableIcon,
  Upload
} from 'lucide-react';
import { ValidateAllModal } from './ValidateAllModal';
import type { ShowToast } from '../App';
import { BlocklistEntry, Client, ImportHistoryRecord } from '../types';
import { getDaysSince } from '../utils/validator';
import { getHistoryRecords } from '../db/store';
import { PageHeader } from './PageHeader';

interface DashboardViewProps {
  clients: Client[];
  activeCounts: Record<string, number>;
  ipCounts: Record<string, number>;
  cidrCounts: Record<string, number>;
  totalActiveAcrossAll: number;
  totalIpsAcrossAll: number;
  totalCidrsAcrossAll: number;
  totalCorrelatedIps: number;
  addedThisWeekCount: number;
  allActiveEntries: BlocklistEntry[];
  slaDays: number;
  onNavigateToImport: (clientId: string) => void;
  onNavigateToList: (clientId: string) => void;
  onNavigateToHistory: () => void;
  onQuickExportTxt: (client: Client) => void;
  onQuickExportNanoTxt: (client: Client) => void;
  onOpenIntelligenceTab: () => void;
  onRefresh: () => void;
  showToast: ShowToast;
  onOpenReview: () => void;
}

const VIEW_MODE_KEY = 'guardlist-dashboard-view';

function dueLabel(daysSince: number | null, daysUntilDue: number): { text: string; tone: 'danger' | 'warn' | 'muted' } {
  if (daysSince === null) return { text: 'Sem importação', tone: 'danger' };
  if (daysUntilDue < 0) return { text: `Atrasado há ${-daysUntilDue}d`, tone: 'danger' };
  if (daysUntilDue === 0) return { text: 'Vence hoje', tone: 'warn' };
  if (daysUntilDue === 1) return { text: 'Vence amanhã', tone: 'warn' };
  if (daysUntilDue <= 2) return { text: `Vence em ${daysUntilDue}d`, tone: 'warn' };
  return { text: `Vence em ${daysUntilDue}d`, tone: 'muted' };
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  activeCounts,
  ipCounts,
  cidrCounts,
  totalActiveAcrossAll,
  totalIpsAcrossAll,
  totalCidrsAcrossAll,
  totalCorrelatedIps,
  addedThisWeekCount,
  allActiveEntries,
  slaDays,
  onNavigateToImport,
  onNavigateToList,
  onNavigateToHistory,
  onQuickExportTxt,
  onQuickExportNanoTxt,
  onOpenIntelligenceTab,
  onRefresh,
  showToast,
  onOpenReview
}) => {
  const [isValidateOpen, setIsValidateOpen] = useState(false);
  const activeClients = useMemo(() => clients.filter((c) => !c.isArchived), [clients]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    try {
      return window.localStorage.getItem(VIEW_MODE_KEY) === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const [onlyLateFilter, setOnlyLateFilter] = useState(false);
  const [history, setHistory] = useState<ImportHistoryRecord[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Preferência opcional.
    }
  }, [viewMode]);

  useEffect(() => {
    getHistoryRecords().then((records) => setHistory(records.slice(0, 4))).catch(() => setHistory([]));
  }, [clients]);

  const enrichedClients = useMemo(() => {
    return activeClients.map((client) => {
      const daysSince = getDaysSince(client.lastUpdateDate);
      const isLate = daysSince === null || daysSince > slaDays;
      const daysUntilDue = daysSince !== null ? slaDays - daysSince : -99;
      const isNearDeadline = !isLate && daysUntilDue <= 2;
      let urgencyScore: number;
      if (daysSince === null) urgencyScore = 1000;
      else if (isLate) urgencyScore = 500 + daysSince;
      else if (isNearDeadline) urgencyScore = 200 + (3 - daysUntilDue);
      else urgencyScore = 50 - daysSince;

      return {
        client,
        daysSince,
        daysUntilDue,
        total: activeCounts[client.id] || 0,
        ips: ipCounts[client.id] || 0,
        cidrs: cidrCounts[client.id] || 0,
        isLate,
        isNearDeadline,
        urgencyScore
      };
    });
  }, [activeClients, activeCounts, ipCounts, cidrCounts, slaDays]);

  const sortedClients = useMemo(() => {
    const list = [...enrichedClients].sort((a, b) => b.urgencyScore - a.urgencyScore);
    return onlyLateFilter ? list.filter((c) => c.isLate) : list;
  }, [enrichedClients, onlyLateFilter]);

  const lateCount = enrichedClients.filter((c) => c.isLate).length;
  const upToDateCount = enrichedClients.length - lateCount;

  const agenda = useMemo(
    () => [...enrichedClients].sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 6),
    [enrichedClients]
  );

  // Indicadores presentes em mais clientes ativos (mesma regra da correlação).
  const recurring = useMemo(() => {
    const activeIds = new Set(activeClients.map((c) => c.id));
    const byIndicator = new Map<string, Set<string>>();
    for (const entry of allActiveEntries) {
      if (!activeIds.has(entry.clientId)) continue;
      const set = byIndicator.get(entry.indicator) ?? new Set<string>();
      set.add(entry.clientId);
      byIndicator.set(entry.indicator, set);
    }
    return [...byIndicator.entries()]
      .filter(([, set]) => set.size >= 2)
      .map(([indicator, set]) => ({ indicator, count: set.size }))
      .sort((a, b) => b.count - a.count || a.indicator.localeCompare(b.indicator))
      .slice(0, 5);
  }, [allActiveEntries, activeClients]);

  const nextExpiring = useMemo(() => {
    const upcoming = enrichedClients.filter((c) => !c.isLate && c.daysSince !== null);
    return upcoming.sort((a, b) => a.daysUntilDue - b.daysUntilDue)[0] ?? null;
  }, [enrichedClients]);

  const statusChip = (isLate: boolean, isNear: boolean) =>
    isLate ? (
      <span className="chip chip--danger">Atrasada</span>
    ) : isNear ? (
      <span className="chip chip--warn">Vence logo</span>
    ) : (
      <span className="chip chip--ok">Em dia</span>
    );

  return (
    <div className="workspace-overview">
      <PageHeader
        title="Painel geral"
        description="Situação da manutenção semanal de cada cliente, ordenada por urgência."
        actions={
          <button type="button" className="btn" onClick={() => setIsValidateOpen(true)} title="Procura repetidos, IPs dentro de CIDR e conflitos com exceções em todos os clientes">
            <ShieldCheck aria-hidden="true" />
            Validar todas as listas
          </button>
        }
      />

      <ValidateAllModal
        open={isValidateOpen}
        onClose={() => setIsValidateOpen(false)}
        onDone={onRefresh}
        onOpenList={onNavigateToList}
        onOpenReview={onOpenReview}
        showToast={showToast}
      />

      <div className="workspace-summary" aria-label="Resumo operacional">
        <div className="workspace-summary__item">
          <span>Entradas ativas</span>
          <strong>{totalActiveAcrossAll.toLocaleString('pt-BR')}</strong>
          <small>{totalIpsAcrossAll.toLocaleString('pt-BR')} IPs · {totalCidrsAcrossAll} CIDRs</small>
        </div>
        <button
          type="button"
          onClick={() => setOnlyLateFilter(!onlyLateFilter)}
          className={`workspace-summary__item workspace-summary__action ${lateCount > 0 ? 'has-warning' : ''} ${onlyLateFilter ? 'is-active' : ''}`}
          aria-pressed={onlyLateFilter}
        >
          <span>Fora do prazo</span>
          <strong>{lateCount}</strong>
          <small>{onlyLateFilter ? 'Mostrando só atrasados' : `${upToDateCount} de ${activeClients.length} no prazo`}</small>
        </button>
        <button type="button" onClick={onOpenIntelligenceTab} className="workspace-summary__item workspace-summary__action">
          <span>IPs correlacionados</span>
          <strong>{totalCorrelatedIps}</strong>
          <small>Presentes em 2 ou mais clientes</small>
        </button>
        <div className="workspace-summary__item">
          <span>Adicionados na semana</span>
          <strong>+{addedThisWeekCount}</strong>
          <small>{nextExpiring ? `Próximo prazo: ${nextExpiring.client.name}` : 'Nenhum prazo próximo'}</small>
        </div>
      </div>

      <div className="dash-layout">
        <section aria-labelledby="queue-title">
          <div className="client-ledger-heading flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
            <div>
              <h2 id="queue-title" className="text-lg font-bold text-white tracking-[-0.02em]">Fila de manutenção</h2>
              <p className="text-xs text-slate-400 mt-1">Atrasados primeiro, depois os prazos mais próximos.</p>
            </div>
            <div className="flex items-center gap-2">
              {onlyLateFilter && (
                <button type="button" className="btn btn--sm btn--quiet" onClick={() => setOnlyLateFilter(false)}>
                  Mostrar todos ({activeClients.length})
                </button>
              )}
              <div className="segmented" role="group" aria-label="Modo de visualização">
                <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')}>
                  <LayoutGrid aria-hidden="true" /> Cards
                </button>
                <button type="button" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}>
                  <TableIcon aria-hidden="true" /> Tabela
                </button>
              </div>
            </div>
          </div>

          {sortedClients.length === 0 ? (
            <div className="rail-panel empty-state">
              <Calendar aria-hidden="true" />
              <strong>Nenhum cliente atrasado</strong>
              <p>Todos os clientes estão dentro do prazo de {slaDays} dias.</p>
              <button type="button" className="btn btn--sm" onClick={() => setOnlyLateFilter(false)}>Mostrar todos</button>
            </div>
          ) : viewMode === 'cards' ? (
            <div key="cards" className="view-enter grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {sortedClients.map(({ client, daysSince, total, ips, cidrs, isLate, isNearDeadline }) => (
                <article
                  key={client.id}
                  className={`client-tile ${isLate ? 'is-late' : isNearDeadline ? 'is-near' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-bold text-white text-[0.95rem] tracking-wide font-mono">{client.name}</h3>
                    {statusChip(isLate, isNearDeadline)}
                  </div>

                  <div className="client-tile__metrics" aria-label={`Resumo de ${client.name}`}>
                    <div><span>Total</span><strong>{total.toLocaleString('pt-BR')}</strong></div>
                    <div><span>IPs</span><strong>{ips.toLocaleString('pt-BR')}</strong></div>
                    <div><span>CIDRs</span><strong>{cidrs.toLocaleString('pt-BR')}</strong></div>
                  </div>

                  <div className="client-tile__review">
                    <span className="client-tile__review-label">
                      <Calendar aria-hidden="true" /> Última revisão
                    </span>
                    <span className="client-tile__review-value">
                      <strong>{client.lastUpdateDate || 'Nunca'}</strong>
                      <small className={isLate ? 'text-rose-400' : isNearDeadline ? 'text-amber-400' : 'text-slate-400'}>
                        {daysSince === null ? 'Pendente' : daysSince === 0 ? 'Hoje' : `Há ${daysSince} dias`}
                      </small>
                    </span>
                  </div>

                  <div className="client-tile__actions">
                    <button type="button" className={`btn btn--sm ${isLate || isNearDeadline ? 'btn--primary' : ''}`} onClick={() => onNavigateToImport(client.id)}>
                      <Upload aria-hidden="true" /> Importar
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => onNavigateToList(client.id)}>
                      <List aria-hidden="true" /> Lista
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      className="btn btn--sm btn--icon btn--quiet"
                      onClick={() => onQuickExportTxt(client)}
                      title="Baixar .txt para o firewall (1 indicador por linha)"
                      aria-label={`Baixar .txt de ${client.name}`}
                    >
                      <Download aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--icon btn--quiet"
                      onClick={() => onQuickExportNanoTxt(client)}
                      title="Baixar .txt no formato NANO (IPs e redes separados)"
                      aria-label={`Baixar .txt NANO de ${client.name}`}
                    >
                      <FileText aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div key="table" className="view-enter client-ledger-table overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[11px] font-semibold">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3 text-right">IPs</th>
                    <th className="py-3 px-3 text-right">CIDRs</th>
                    <th className="py-3 px-3">Última revisão</th>
                    <th className="py-3 px-3">Situação</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedClients.map(({ client, daysSince, total, ips, cidrs, isLate, isNearDeadline }, idx) => (
                    <tr key={client.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">{idx + 1}</td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => onNavigateToList(client.id)}
                          className="font-mono font-bold text-white hover:text-blue-400 transition-colors cursor-pointer"
                        >
                          {client.name}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">{total.toLocaleString('pt-BR')}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{ips.toLocaleString('pt-BR')}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{cidrs}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-mono text-slate-300">{client.lastUpdateDate || 'Nunca'}</span>
                        <span className="text-slate-500 ml-2">{daysSince === null ? '' : `há ${daysSince}d`}</span>
                      </td>
                      <td className="py-2.5 px-3">{statusChip(isLate, isNearDeadline)}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn btn--sm" onClick={() => onNavigateToImport(client.id)}>Importar</button>
                          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={() => onQuickExportTxt(client)} title="Baixar .txt" aria-label={`Baixar .txt de ${client.name}`}>
                            <Download aria-hidden="true" />
                          </button>
                          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={() => onQuickExportNanoTxt(client)} title="Baixar .txt NANO" aria-label={`Baixar .txt NANO de ${client.name}`}>
                            <FileText aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="dash-rail" aria-label="Resumo da semana">
          <section className="rail-panel">
            <header>
              <h2>Esta semana</h2>
              <small>Prazo de {slaDays} dias</small>
            </header>
            <ul className="rail-list">
              {agenda.map(({ client, daysSince, daysUntilDue }) => {
                const due = dueLabel(daysSince, daysUntilDue);
                return (
                  <li key={client.id}>
                    <button type="button" className="rail-row" onClick={() => onNavigateToImport(client.id)} title={`Importar ${client.name}`}>
                      <strong>{client.name}</strong>
                      <span className={`is-${due.tone}`}>{due.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rail-panel">
            <header>
              <h2>Mais recorrentes</h2>
              <small>em {activeClients.length} clientes</small>
            </header>
            {recurring.length === 0 ? (
              <p className="rail-empty">Nenhum indicador aparece em mais de um cliente.</p>
            ) : (
              <ul className="rail-list">
                {recurring.map(({ indicator, count }) => (
                  <li key={indicator}>
                    <button type="button" className="rail-row" onClick={onOpenIntelligenceTab} title="Abrir na inteligência de IPs">
                      <strong>{indicator}</strong>
                      <span className="is-muted">{count} clientes</span>
                      <span className="rail-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round((count / Math.max(1, activeClients.length)) * 100)}%` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rail-panel">
            <header>
              <h2>Últimas importações</h2>
              {history.length > 0 && (
                <button type="button" className="btn btn--sm btn--quiet" onClick={onNavigateToHistory}>
                  Ver todas
                </button>
              )}
            </header>
            {history.length === 0 ? (
              <p className="rail-empty">
                As importações aparecem aqui assim que a primeira lista da semana for gravada.
              </p>
            ) : (
              <ul className="rail-list">
                {history.map((record) => (
                  <li key={record.id}>
                    <button type="button" className="rail-row" onClick={onNavigateToHistory}>
                      <strong>{record.clientName}</strong>
                      <span className="is-muted">+{record.addedCount} · {formatShortDate(record.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="flex items-center gap-1.5 text-[11px] text-slate-500 px-1">
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            Base compartilhada da equipe, atualizada a cada minuto.
          </p>
        </aside>
      </div>
    </div>
  );
};
