import React, { useState, useMemo } from 'react';
import { 
  Radio, 
  Search, 
  Building2, 
  ShieldAlert, 
  Layers, 
  ExternalLink, 
  Copy, 
  Check, 
  Filter, 
  Sparkles, 
  Flame, 
  Network,
  ArrowUpDown
} from 'lucide-react';
import { BlocklistEntry, Client } from '../types';
import { buildCorrelationMatrix } from '../utils/ctiService';
import { IpDossierModal } from './IpDossierModal';

interface IntelligenceViewProps {
  allEntries: BlocklistEntry[];
  clients: Client[];
  onNavigateToClientList: (clientId: string) => void;
}

export const IntelligenceView: React.FC<IntelligenceViewProps> = ({
  allEntries,
  clients,
  onNavigateToClientList
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'critical' | 'high' | 'medium'>('ALL');
  const [selectedIpForDossier, setSelectedIpForDossier] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  // Calcular matriz de correlação em tempo real
  const correlation = useMemo(() => {
    return buildCorrelationMatrix(allEntries, clients);
  }, [allEntries, clients]);

  // Filtrar indicadores correlacionados
  const filteredList = useMemo(() => {
    return correlation.sharedIndicators.filter(item => {
      // Busca
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchesIp = item.indicator.toLowerCase().includes(q);
        const matchesClient = item.clientNames.some(c => c.toLowerCase().includes(q));
        if (!matchesIp && !matchesClient) return false;
      }

      // Filtro por cliente
      if (clientFilter !== 'ALL') {
        if (!item.clientIds.includes(clientFilter)) return false;
      }

      // Filtro por severidade
      if (severityFilter !== 'ALL') {
        if (item.severity !== severityFilter) return false;
      }

      return true;
    });
  }, [correlation.sharedIndicators, searchTerm, clientFilter, severityFilter]);

  const handleCopy = (ip: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const maxDissemination = correlation.sharedIndicators.length > 0
    ? Math.max(...correlation.sharedIndicators.map(s => s.occurrencesCount))
    : 0;

  const cidrSharedCount = correlation.sharedIndicators.filter(
    s => s.type === 'CIDR_v4' || s.type === 'CIDR_v6' || s.indicator.includes('/')
  ).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="page-heading">
        <div>
          <h1>Inteligência de IPs e correlação</h1>
          <p>Indicadores presentes em duas ou mais listas de clientes.</p>
        </div>
        <span className="page-safety">Isolamento mantido · somente leitura</span>
      </div>

      <div className="workspace-summary intelligence-summary" aria-label="Resumo de correlação">
        <div className="workspace-summary__item">
          <span>Indicadores correlacionados</span>
          <strong>{correlation.totalCorrelatedIpsCount}</strong>
          <small>Presentes em 2 ou mais clientes</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__risk">
          <span>Maior disseminação</span>
          <strong>{maxDissemination}/{clients.length}</strong>
          <small>Clientes na mesma ocorrência</small>
        </div>
        <div className="workspace-summary__item">
          <span>Sub-redes CIDR em comum</span>
          <strong>{cidrSharedCount}</strong>
          <small>Blocos cruzados entre listas</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__critical">
          <span>Nível crítico</span>
          <strong>{correlation.sharedIndicators.filter(s => s.severity === 'critical').length}</strong>
          <small>Presentes em 4 ou mais clientes</small>
        </div>
      </div>

      {/* Controles de Filtros e Busca */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Campo de Busca */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar IP, CIDR ou nome de cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-100 placeholder-slate-500 text-base sm:text-sm pl-9 pr-4 py-2.5 rounded-xl border border-slate-700 focus:border-purple-500 font-mono"
          />
        </div>

        {/* Filtros por Cliente e Severidade */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Cliente */}
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="bg-slate-950 text-slate-200 text-xs rounded-xl px-3 py-2 border border-slate-700 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            <option value="ALL">Todos os Clientes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Severidade */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as any)}
            className="bg-slate-950 text-slate-200 text-xs rounded-xl px-3 py-2 border border-slate-700 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            <option value="ALL">Todas as Severidades</option>
            <option value="critical">Crítica ({'>='} 4 Clientes)</option>
            <option value="high">Alta (3 Clientes)</option>
            <option value="medium">Média (2 Clientes)</option>
          </select>
        </div>
      </div>

      {/* Tabela de Indicadores Compartilhados */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Indicadores Transversais ({filteredList.length})
            </span>
            <span className="text-[11px] text-slate-400">
              Clique em qualquer indicador para abrir a Ficha CTI completa
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Indicador / Alvo</th>
                <th className="py-3 px-3">Tipo</th>
                <th className="py-3 px-4">Clientes Onde Aparece</th>
                <th className="py-3 px-3">Disseminação</th>
                <th className="py-3 px-4">Firewalls Impactados</th>
                <th className="py-3 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 font-sans">
                    Nenhum indicador compartilhado encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => (
                  <tr
                    key={item.indicator}
                    onClick={() => setSelectedIpForDossier(item.indicator)}
                    className="hover:bg-slate-800/40 transition cursor-pointer group"
                  >
                    {/* Indicador */}
                    <td className="py-3 px-4 font-bold text-white group-hover:text-purple-300 transition">
                      <div className="flex items-center gap-2">
                        <span>{item.indicator}</span>
                        <button
                          onClick={(e) => handleCopy(item.indicator, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700 rounded transition text-slate-400 hover:text-white"
                          title="Copiar IP"
                        >
                          {copiedIp === item.indicator ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="py-3 px-3 text-slate-400">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700">
                        {item.type}
                      </span>
                    </td>

                    {/* Clientes Onde Aparece */}
                    <td className="py-3 px-4 font-sans">
                      <div className="flex flex-wrap gap-1">
                        {item.clientNames.map((name, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-950 border border-slate-700 text-slate-200"
                          >
                            <Building2 className="w-3 h-3 text-blue-400" />
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Disseminação */}
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        item.severity === 'critical'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                          : item.severity === 'high'
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                            : 'bg-blue-950/80 text-blue-300 border-blue-800'
                      }`}>
                        {item.occurrencesCount} clientes ({Math.round((item.occurrencesCount / clients.length) * 100)}%)
                      </span>
                    </td>

                    {/* Firewalls Impactados */}
                    <td className="py-3 px-4 font-sans text-slate-400 text-xs">
                      {item.firewallsImpacted.join(' • ')}
                    </td>

                    {/* Ação */}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIpForDossier(item.indicator);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-sans transition"
                      >
                        Ver Dossiê CTI
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Matriz de Sobreposição entre Clientes */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-400" />
            Matriz de Sobreposição entre Clientes (Overlap Inter-Empresarial)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Mede quais clientes possuem maior convergência de ameaças bloqueadas nas suas respectivas blocklists.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {correlation.clientOverlapTable.slice(0, 9).map((pair, idx) => (
            <div
              key={idx}
              className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex items-center justify-between"
            >
              <div>
                <span className="text-xs font-semibold text-slate-200 block">
                  {pair.clientA} <span className="text-slate-500">↔</span> {pair.clientB}
                </span>
                <span className="text-[11px] text-slate-400">
                  {pair.sharedCount} {pair.sharedCount === 1 ? 'indicador em comum' : 'indicadores em comum'}
                </span>
              </div>
              <span className="text-sm font-bold font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                {pair.sharedCount} IPs
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modal de Ficha Técnica / Dossiê do IP */}
      {selectedIpForDossier && (
        <IpDossierModal
          indicator={selectedIpForDossier}
          onClose={() => setSelectedIpForDossier(null)}
          allEntries={allEntries}
          clients={clients}
        />
      )}
    </div>
  );
};
