import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  Calendar, 
  Clock, 
  ShieldCheck, 
  AlertCircle, 
  UploadCloud, 
  ListFilter, 
  DownloadCloud, 
  CheckCircle2, 
  Layers,
  Terminal,
  Radio,
  Flame,
  LayoutGrid,
  Table as TableIcon,
  Network,
  ArrowUpDown,
  Filter,
  Check
} from 'lucide-react';
import { Client } from '../types';
import { getDaysSince } from '../utils/validator';

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
  slaDays: number;
  onNavigateToImport: (clientId: string) => void;
  onNavigateToList: (clientId: string) => void;
  onQuickExportTxt: (client: Client) => void;
  onQuickExportNanoTxt: (client: Client) => void;
  onOpenIntelligenceTab: () => void;
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
  slaDays,
  onNavigateToImport,
  onNavigateToList,
  onQuickExportTxt,
  onQuickExportNanoTxt,
  onOpenIntelligenceTab
}) => {
  const activeClients = clients.filter(c => !c.isArchived);

  // Modo de visualização: 'cards' ou 'table' (Tabela Compacta SOC)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  // Filtro de urgência: se 'onlyLate' estiver ativo (clicado no card de topo)
  const [onlyLateFilter, setOnlyLateFilter] = useState<boolean>(false);

  // Calcular status, dias decorridos e urgência
  const enrichedClients = useMemo(() => {
    return activeClients.map(client => {
      const daysSince = getDaysSince(client.lastUpdateDate);
      const total = activeCounts[client.id] || 0;
      const ips = ipCounts[client.id] || 0;
      const cidrs = cidrCounts[client.id] || 0;
      const isLate = daysSince === null || daysSince > slaDays;
      const daysUntilDue = daysSince !== null ? slaDays - daysSince : -99;
      const isNearDeadline = !isLate && daysUntilDue <= 2 && daysUntilDue >= 0;

      // Pontuação de urgência para ordenação operacional (maior número = mais urgente)
      let urgencyScore = 0;
      if (daysSince === null) urgencyScore = 1000;
      else if (isLate) urgencyScore = 500 + daysSince; // Atrasados com mais dias no topo
      else if (isNearDeadline) urgencyScore = 200 + (3 - daysUntilDue);
      else urgencyScore = 50 - daysSince;

      return {
        client,
        daysSince,
        daysUntilDue,
        total,
        ips,
        cidrs,
        isLate,
        isNearDeadline,
        urgencyScore
      };
    });
  }, [activeClients, activeCounts, ipCounts, cidrCounts, slaDays]);

  // Ordenar por URGÊNCIA (Atrasados primeiro, depois próximos do vencimento, depois em dia)
  const sortedClients = useMemo(() => {
    let list = [...enrichedClients].sort((a, b) => b.urgencyScore - a.urgencyScore);
    if (onlyLateFilter) {
      list = list.filter(c => c.isLate);
    }
    return list;
  }, [enrichedClients, onlyLateFilter]);

  const upToDateCount = enrichedClients.filter(c => !c.isLate).length;
  const lateCount = enrichedClients.filter(c => c.isLate).length;

  // Próximo vencimento para exibição de alerta
  const nextExpiring = useMemo(() => {
    const upToDateList = enrichedClients.filter(c => !c.isLate && c.daysSince !== null);
    if (upToDateList.length === 0) return null;
    return upToDateList.sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99))[0];
  }, [enrichedClients]);

  return (
    <div className="space-y-7 animate-in fade-in duration-150">
      <section className="workspace-overview" aria-labelledby="workspace-title">
        <div className="workspace-overview__title">
          <div>
            <h1 id="workspace-title">Painel geral</h1>
            <p>Visão consolidada da manutenção semanal por cliente.</p>
          </div>
          <span className="workspace-overview__storage">
            <span aria-hidden="true" /> IndexedDB ativo
          </span>
        </div>

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
            <small>{onlyLateFilter ? 'Filtro aplicado' : `${upToDateCount} de ${activeClients.length} dentro do SLA`}</small>
          </button>
          <button
            type="button"
            onClick={onOpenIntelligenceTab}
            className="workspace-summary__item workspace-summary__action"
          >
            <span>IPs correlacionados</span>
            <strong>{totalCorrelatedIps}</strong>
            <small>Abrir investigação CTI</small>
          </button>
          <div className="workspace-summary__item">
            <span>Adicionados na semana</span>
            <strong>+{addedThisWeekCount}</strong>
            <small>{nextExpiring ? `${nextExpiring.client.name} vence em ${nextExpiring.daysUntilDue}d` : 'Sem vencimento imediato'}</small>
          </div>
        </div>
      </section>

      {/* Barra de Controles: Ordenação por Urgência, Filtro e Toggle de Visualização */}
      <div className="client-ledger-heading flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2">
        <div>
          <h2 className="text-xl font-bold text-white flex flex-wrap items-center gap-2 tracking-[-0.02em]">
            Fila de manutenção
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Cada linha é um perímetro independente. A ordem segue urgência, prazo e integridade da última importação.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Botão de limpar filtro de atrasados se ativo */}
          {onlyLateFilter && (
            <button
              onClick={() => setOnlyLateFilter(false)}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1 cursor-pointer"
            >
              <span>Mostrar Todos ({activeClients.length})</span>
            </button>
          )}

          {/* Alternador de Visualização: Cards vs Tabela Compacta */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-1 flex items-center gap-1">
            <button
              onClick={() => setViewMode('cards')}
              className={`p-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Visualização em Cards"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">Cards</span>
            </button>

            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Visualização em Tabela Compacta SOC"
            >
              <TableIcon className="w-4 h-4" />
              <span className="hidden md:inline">Tabela Compacta</span>
            </button>
          </div>
        </div>
      </div>

      {/* Visualização 1: Grid de Cards Operacionais */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedClients.map(({ client, daysSince, total, ips, cidrs, isLate, isNearDeadline }) => {
            return (
              <div
                key={client.id}
                className={`client-tile bg-slate-900 border rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-colors hover:border-slate-700 ${
                  isLate 
                    ? 'border-rose-900/70 ring-1 ring-rose-900/30' 
                    : isNearDeadline
                      ? 'border-amber-900/60'
                      : 'border-slate-800'
                }`}
              >
                <div>
                  {/* Cabeçalho do Card */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-base tracking-wide font-mono">
                        {client.name}
                      </h3>
                    </div>

                    {/* Selo com whitespace-nowrap rigoroso para não quebrar em duas linhas */}
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                      !isLate
                        ? isNearDeadline
                          ? 'bg-amber-950 text-amber-300 border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-rose-950 text-rose-300 border-rose-800'
                    }`}>
                      {!isLate ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="whitespace-nowrap">Em dia</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                          <span className="whitespace-nowrap">Atrasada</span>
                        </>
                      )}
                    </span>
                  </div>

                  <div className="client-tile__metrics" aria-label={`Resumo de ${client.name}`}>
                    <div>
                      <span>Total</span>
                      <strong>{total.toLocaleString('pt-BR')}</strong>
                    </div>
                    <div>
                      <span>IPs</span>
                      <strong>{ips.toLocaleString('pt-BR')}</strong>
                    </div>
                    <div>
                      <span>CIDRs</span>
                      <strong>{cidrs.toLocaleString('pt-BR')}</strong>
                    </div>
                  </div>

                  <div className="client-tile__review">
                    <span className="client-tile__review-label">
                      <Calendar aria-hidden="true" /> Última revisão
                    </span>
                    <span className="client-tile__review-value">
                      <strong>{client.lastUpdateDate || 'Nunca'}</strong>
                      <small className={`font-semibold ${
                      isLate ? 'text-rose-400' : isNearDeadline ? 'text-amber-400' : 'text-slate-300'
                    }`}>
                      {daysSince === null 
                        ? 'Pendente' 
                        : `${daysSince} dias atrás`}
                      </small>
                    </span>
                  </div>
                </div>

                {/* Ações do Card com Tooltips Claros e Completos */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-1.5 text-xs">
                  <button
                    onClick={() => onNavigateToImport(client.id)}
                    className="flex-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 py-1.5 px-2 rounded-lg font-medium transition flex items-center justify-center gap-1 text-[11px] cursor-pointer"
                    title="Importar novos IPs e atualizar lista semanal deste cliente"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-purple-400" />
                    Importar
                  </button>

                  <button
                    onClick={() => onNavigateToList(client.id)}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-1.5 px-2 rounded-lg font-medium transition flex items-center justify-center gap-1 text-[11px] cursor-pointer"
                    title="Abrir tabela detalhada, filtros e histórico deste cliente"
                  >
                    <ListFilter className="w-3.5 h-3.5 text-cyan-400" />
                    Ver Lista
                  </button>

                  {/* Botão de Download com Tooltip Claro */}
                  <button
                    onClick={() => onQuickExportTxt(client)}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-lg transition cursor-pointer relative group"
                    title="Baixar .TXT Firewall: 1 IP por linha, pronto para carregar no firewall"
                  >
                    <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
                  </button>

                  {/* Botão de Terminal / NANO com Tooltip Claro */}
                  <button
                    onClick={() => onQuickExportNanoTxt(client)}
                    className="p-1.5 bg-purple-950/60 hover:bg-purple-900/70 text-purple-300 hover:text-white border border-purple-800/80 rounded-lg transition cursor-pointer relative group"
                    title="Baixar .TXT Formato NANO: estruturado com cabeçalhos === IPS ÚNICOS === e === REDES CIDR ==="
                  >
                    <Terminal className="w-3.5 h-3.5 text-purple-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Visualização 2: Tabela Compacta SOC (Mais operacional para múltiplos clientes) */}
      {viewMode === 'table' && (
        <div className="client-ledger-table bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-sans">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Prioridade</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Total Ativo</th>
                  <th className="py-3 px-3">IPs Únicos</th>
                  <th className="py-3 px-3">Redes CIDR</th>
                  <th className="py-3 px-3">Última Atualização</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Ações Rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sortedClients.map(({ client, daysSince, total, ips, cidrs, isLate, isNearDeadline }, idx) => {
                  return (
                    <tr 
                      key={client.id}
                      className={`hover:bg-slate-800/30 transition ${
                        isLate ? 'bg-rose-950/10' : ''
                      }`}
                    >
                      {/* Prioridade */}
                      <td className="py-3 px-4 font-mono">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          isLate 
                            ? 'bg-rose-950 text-rose-300 border border-rose-800' 
                            : isNearDeadline
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-slate-800 text-slate-400'
                        }`}>
                          #{idx + 1} {isLate ? 'URGENTE' : ''}
                        </span>
                      </td>

                      {/* Cliente */}
                      <td className="py-3 px-4 font-bold text-white font-mono text-sm">
                        <button
                          onClick={() => onNavigateToList(client.id)}
                          className="hover:text-blue-400 transition cursor-pointer text-left"
                        >
                          {client.name}
                        </button>
                      </td>

                      {/* Total Ativo */}
                      <td className="py-3 px-4 font-mono font-bold text-white text-sm">
                        {total.toLocaleString('pt-BR')}
                      </td>

                      {/* IPs */}
                      <td className="py-3 px-3 font-mono text-blue-300">
                        {ips.toLocaleString('pt-BR')}
                      </td>

                      {/* CIDRs */}
                      <td className="py-3 px-3 font-mono text-purple-300">
                        {cidrs}
                      </td>

                      {/* Última Atualização */}
                      <td className="py-3 px-3 font-mono text-slate-300 text-xs">
                        {client.lastUpdateDate || 'Nunca'}
                        <span className="block text-[10px] text-slate-500 font-sans">
                          {daysSince === null ? 'Pendente' : `${daysSince}d atrás`}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${
                          !isLate
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border-rose-800'
                        }`}>
                          {!isLate ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              Em dia
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-rose-400" />
                              Atrasada
                            </>
                          )}
                        </span>
                      </td>

                      {/* Ações Rápidas */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onNavigateToImport(client.id)}
                            className="px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs transition cursor-pointer"
                            title="Importar novos IPs"
                          >
                            Importar
                          </button>
                          <button
                            onClick={() => onNavigateToList(client.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition cursor-pointer"
                            title="Ver lista"
                          >
                            Lista
                          </button>
                          <button
                            onClick={() => onQuickExportTxt(client)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
                            title="Exportar .TXT Simples"
                          >
                            <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
                          </button>
                          <button
                            onClick={() => onQuickExportNanoTxt(client)}
                            className="p-1.5 rounded-lg bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-800/80 transition cursor-pointer"
                            title="Exportar .TXT Formato NANO"
                          >
                            <Terminal className="w-3.5 h-3.5 text-purple-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
