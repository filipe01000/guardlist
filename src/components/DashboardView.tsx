import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Calendar,
  Download,
  FileText,
  History,
  LayoutGrid,
  List,
  ShieldCheck,
  Table as TableIcon,
  Upload,
  ListChecks
} from 'lucide-react';
import ActionMenu, { openActionMenuAt } from './ActionMenu';
import { ValidateAllModal } from './ValidateAllModal';
import type { ShowToast } from '../App';
import { Client, DashboardStats, ImportHistoryRecord } from '../types';
import { getDaysSince } from '../utils/validator';
import { formatDateBR } from '../utils/csv';
import { coverBackground } from '../utils/imageToCover';
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
  /** Endereços IPv4 cobertos (CIDRs pelo tamanho), por cliente e no total, e as faixas IPv6 à parte. */
  addressStats: Pick<DashboardStats, 'addressCounts' | 'totalAddresses' | 'ipv6Networks'>;
  totalCorrelatedIps: number;
  addedThisWeekCount: number;
  recurring: DashboardStats['recurring'];
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
  onManageClients: () => void;
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

// Troca de filtro/visualização com animação: os cards deslizam para a nova posição
// (View Transitions do navegador). Sem suporte ou com "reduzir movimento", troca na hora.
function morph(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const rootEl = document.documentElement;
  rootEl.dataset.vt = 'cards';
  const transition = doc.startViewTransition.call(document, () => flushSync(update));
  transition.finished.finally(() => {
    delete rootEl.dataset.vt;
  });
}

const vtName = (id: string) => `cl-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
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
  addressStats,
  totalCorrelatedIps,
  addedThisWeekCount,
  recurring,
  slaDays,
  onNavigateToImport,
  onNavigateToList,
  onNavigateToHistory,
  onQuickExportTxt,
  onQuickExportNanoTxt,
  onOpenIntelligenceTab,
  onRefresh,
  showToast,
  onOpenReview,
  onManageClients
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'late' | 'near' | 'ok'>('all');
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
      else urgencyScore = 50 + daysSince;

      return {
        client,
        daysSince,
        daysUntilDue,
        total: activeCounts[client.id] || 0,
        ips: ipCounts[client.id] || 0,
        cidrs: cidrCounts[client.id] || 0,
        addresses: addressStats.addressCounts[client.id] || 0,
        isLate,
        isNearDeadline,
        urgencyScore
      };
    });
  }, [activeClients, activeCounts, ipCounts, cidrCounts, slaDays]);

  const sortedClients = useMemo(() => {
    const list = [...enrichedClients].sort((a, b) => b.urgencyScore - a.urgencyScore);
    if (statusFilter === 'late') return list.filter((c) => c.isLate);
    if (statusFilter === 'near') return list.filter((c) => !c.isLate && c.isNearDeadline);
    if (statusFilter === 'ok') return list.filter((c) => !c.isLate && !c.isNearDeadline);
    return list;
  }, [enrichedClients, statusFilter]);

  const lateCount = enrichedClients.filter((c) => c.isLate).length;
  const nearCount = enrichedClients.filter((c) => !c.isLate && c.isNearDeadline).length;
  const okCount = enrichedClients.length - lateCount - nearCount;
  const onlyLateFilter = statusFilter === 'late';
  const upToDateCount = enrichedClients.length - lateCount;

  const agenda = useMemo(
    () => [...enrichedClients].sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 6),
    [enrichedClients]
  );

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
        description="Situação das listas de cada cliente, das mais urgentes para as em dia."
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
          <span>IPs bloqueados</span>
          <strong title="Endereços IPv4 distintos: cada CIDR conta pelo tamanho, sem repetir sobreposições">{addressStats.totalAddresses.toLocaleString('pt-BR')}</strong>
          <small>
            {totalActiveAcrossAll.toLocaleString('pt-BR')} entradas · {totalIpsAcrossAll.toLocaleString('pt-BR')} IPs · {totalCidrsAcrossAll} CIDRs
            {addressStats.ipv6Networks > 0 && ` · +${addressStats.ipv6Networks} ${addressStats.ipv6Networks === 1 ? 'rede' : 'redes'} IPv6`}
          </small>
        </div>
        <button
          type="button"
          onClick={() => morph(() => setStatusFilter(onlyLateFilter ? 'all' : 'late'))}
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
          <span>Adicionados em 7 dias</span>
          <strong>+{addedThisWeekCount}</strong>
          <small>{nextExpiring ? `Próximo prazo: ${nextExpiring.client.name}` : 'Nenhum prazo próximo'}</small>
        </div>
      </div>

      <div className="dash-layout">
        <section aria-labelledby="queue-title">
          <div className="dash-toolbar">
            <h2 id="queue-title" className="sr-only">Clientes</h2>
            <div className="dash-filters" role="group" aria-label="Filtrar clientes por situação">
              {([
                ['all', 'Todos', activeClients.length, ''],
                ['late', 'Atrasados', lateCount, 'is-late'],
                ['near', 'Vencem logo', nearCount, 'is-near'],
                ['ok', 'Em dia', okCount, 'is-ok']
              ] as const).map(([id, label, count, tone]) => (
                <button key={id} type="button" className={`dash-filter ${tone}`} aria-pressed={statusFilter === id} onClick={() => morph(() => setStatusFilter(id))} disabled={id !== 'all' && count === 0}>
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Modo de visualização">
              <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => morph(() => setViewMode('cards'))}>
                <LayoutGrid aria-hidden="true" /> Cards
              </button>
              <button type="button" aria-pressed={viewMode === 'table'} onClick={() => morph(() => setViewMode('table'))}>
                <TableIcon aria-hidden="true" /> Tabela
              </button>
            </div>
          </div>

          {sortedClients.length === 0 ? (
            <div className="rail-panel empty-state">
              <Calendar aria-hidden="true" />
              <strong>{activeClients.length === 0 ? 'Cadastre seu primeiro cliente' : 'Nenhum cliente nesta situação'}</strong>
              <p>{activeClients.length === 0 ? 'Crie um cliente para importar e acompanhar sua lista de bloqueios.' : 'Escolha outro filtro para ver os demais clientes.'}</p>
              <button type="button" className="btn btn--sm" onClick={activeClients.length === 0 ? onManageClients : () => morph(() => setStatusFilter('all'))}>{activeClients.length === 0 ? 'Gerenciar clientes' : 'Mostrar todos'}</button>
            </div>
          ) : viewMode === 'cards' ? (
            <div key="cards" className="cl-grid">
              {sortedClients.map(({ client, daysSince, daysUntilDue, total, ips, cidrs, addresses, isLate, isNearDeadline }, index) => {
                const tone = isLate ? 'is-late' : isNearDeadline ? 'is-near' : 'is-ok';
                const due = dueLabel(daysSince, daysUntilDue);
                return (
                  <article
                    key={client.id}
                    aria-label={client.name}
                    title={client.name}
                    className={`cl-card ${tone}`}
                    data-client-id={client.id}
                    onContextMenu={openActionMenuAt}
                    style={{ '--i': Math.min(index, 12), '--vt': vtName(client.id) } as React.CSSProperties}
                  >
                    <div className={`cl-card__cover${client.logo ? ' has-logo' : ''}`}>
                      <div className="cl-card__logo">
                      {client.logo ? (
                        <img
                          src={client.logo}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            img.classList.toggle('is-small', img.naturalWidth < 80);
                            // A capa assume a cor de fundo da própria logo (branca, azul-marinho...).
                            const bg = coverBackground(img);
                            const cover = img.closest('.cl-card__cover') as HTMLElement | null;
                            if (cover) {
                              cover.classList.toggle('has-bg', Boolean(bg));
                              if (bg) cover.style.setProperty('--cover-bg', bg);
                            }
                          }}
                        />
                      ) : (
                        <span className="cl-card__initials">{client.name}</span>
                      )}
                      </div>
                      <span className="cl-card__status">
                        <i aria-hidden="true" />
                        {isLate || isNearDeadline ? due.text : 'Em dia'}
                      </span>
                    </div>
                    <div className="cl-card__body">

                    <ul className="cl-card__tags" aria-label={`Resumo de ${client.name}`}>
                      <li><strong>{total.toLocaleString('pt-BR')}</strong> ativos</li>
                      <li>{ips.toLocaleString('pt-BR')} IPs</li>
                      <li>{cidrs.toLocaleString('pt-BR')} CIDRs</li>
                      {cidrs > 0 && <li title="Endereços IPv4 cobertos, contando o tamanho de cada CIDR">≈ {addresses.toLocaleString('pt-BR')} endereços</li>}
                    </ul>

                    <footer className="cl-card__foot">
                      <div className="cl-card__icons">
                        <button type="button" className="cl-icon" onClick={() => onNavigateToImport(client.id)} title="Importar bloqueios" aria-label={`Importar bloqueios de ${client.name}`}>
                          <Upload aria-hidden="true" />
                        </button>
                        <button type="button" className="cl-icon" onClick={() => onNavigateToList(client.id)} title="Abrir a lista" aria-label={`Abrir a lista de ${client.name}`}>
                          <List aria-hidden="true" />
                        </button>
                        <ActionMenu
                          label={`Mais ações de ${client.name}`}
                          items={[
                            { label: 'Baixar .txt', icon: Download, onSelect: () => onQuickExportTxt(client) },
                            { label: 'Baixar .txt NANO', icon: FileText, onSelect: () => onQuickExportNanoTxt(client) }
                          ]}
                        />
                      </div>
                      <span className="cl-card__date" title={client.lastUpdateDate ? `Última revisão em ${formatDateBR(client.lastUpdateDate)}` : 'Nunca revisado'}>
                        {client.lastUpdateDate ? `Revisado ${formatDateBR(client.lastUpdateDate).slice(0, 5)}` : 'Nunca revisado'}
                      </span>
                    </footer>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div key="table" className="client-ledger-table overflow-x-auto">
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
                    <th className="py-3 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedClients.map(({ client, daysSince, total, ips, cidrs, isLate, isNearDeadline }, idx) => (
                    <tr key={client.id} className="hover:bg-slate-800/30 transition-colors" onContextMenu={openActionMenuAt}>
                      <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">{idx + 1}</td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => onNavigateToList(client.id)}
                          className="font-bold text-white hover:text-blue-400 transition-colors cursor-pointer"
                        >
                          {client.name}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-white">{total.toLocaleString('pt-BR')}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{ips.toLocaleString('pt-BR')}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{cidrs}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-mono text-slate-300">{client.lastUpdateDate ? formatDateBR(client.lastUpdateDate) : 'Nunca'}</span>
                        <span className="text-slate-500 ml-2">{daysSince === null ? '' : `há ${daysSince}d`}</span>
                      </td>
                      <td className="py-2.5 px-3">{statusChip(isLate, isNearDeadline)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <ActionMenu
                          label={`Ações de ${client.name}`}
                          items={[
                            { label: 'Importar bloqueios', icon: Upload, onSelect: () => onNavigateToImport(client.id) },
                            { label: 'Abrir lista do cliente', icon: ListChecks, onSelect: () => onNavigateToList(client.id) },
                            { type: 'divider' },
                            { label: 'Baixar .txt', icon: Download, onSelect: () => onQuickExportTxt(client) },
                            { label: 'Baixar .txt NANO', icon: FileText, onSelect: () => onQuickExportNanoTxt(client) }
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="dash-rail" aria-label="Prazos e recorrência">
          <section className="rail-panel">
            <header>
              <h2>Próximos prazos</h2>
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
                As importações aparecem aqui assim que a primeira lista for gravada.
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
