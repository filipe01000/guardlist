import React, { useState, useMemo } from 'react';
import { ArrowLeftRight, Check, ChevronRight, Copy, Search } from 'lucide-react';
import { BlocklistEntry, Client } from '../types';
import { buildCorrelationMatrix } from '../utils/ctiService';
import { IpDossierModal } from './IpDossierModal';
import { PageHeader } from './PageHeader';

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

  const severityChip = (severity: string) =>
    severity === 'critical' ? 'chip chip--danger' : severity === 'high' ? 'chip chip--warn' : 'chip';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência de IPs"
        description="Indicadores que aparecem em duas ou mais listas de clientes. Clique em uma linha para abrir o dossiê."
      />

      <div className="workspace-summary intelligence-summary" aria-label="Resumo de correlação">
        <div className="workspace-summary__item">
          <span>Indicadores correlacionados</span>
          <strong>{correlation.totalCorrelatedIpsCount}</strong>
          <small>Presentes em 2 ou mais clientes</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__risk">
          <span>Maior disseminação</span>
          <strong>{maxDissemination}/{clients.length}</strong>
          <small>Clientes com o mesmo indicador</small>
        </div>
        <div className="workspace-summary__item">
          <span>Redes CIDR em comum</span>
          <strong>{cidrSharedCount}</strong>
          <small>Blocos repetidos entre listas</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__critical">
          <span>Nível crítico</span>
          <strong>{correlation.sharedIndicators.filter(s => s.severity === 'critical').length}</strong>
          <small>Presentes em 4 ou mais clientes</small>
        </div>
      </div>

      <div className="toolbar">
        <label className="field field--search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar IP, CIDR ou cliente"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar indicador ou cliente"
          />
        </label>
        <div className="toolbar__group">
          <select className="field" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filtrar por cliente">
            <option value="ALL">Todos os clientes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="field" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)} aria-label="Filtrar por severidade">
            <option value="ALL">Todas as severidades</option>
            <option value="critical">Crítica (4+ clientes)</option>
            <option value="high">Alta (3 clientes)</option>
            <option value="medium">Média (2 clientes)</option>
          </select>
        </div>
      </div>

      <section className="data-panel" aria-labelledby="shared-title">
        <header className="data-panel__header">
          <h2 id="shared-title">Indicadores em comum</h2>
          <span>{filteredList.length} {filteredList.length === 1 ? 'resultado' : 'resultados'}</span>
        </header>

        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '13%' }} />
              <col />
              <col style={{ width: '40px' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Tipo</th>
                <th>Clientes</th>
                <th>Disseminação</th>
                <th>Firewalls</th>
                <th aria-label="Abrir" />
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <Search aria-hidden="true" />
                      <strong>Nenhum indicador encontrado</strong>
                      <p>Ajuste a busca ou os filtros para ver outros resultados.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => (
                  <tr
                    key={item.indicator}
                    onClick={() => setSelectedIpForDossier(item.indicator)}
                    className="is-clickable"
                  >
                    <td>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="data-table__primary"
                          onClick={(e) => { e.stopPropagation(); setSelectedIpForDossier(item.indicator); }}
                        >
                          {item.indicator}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleCopy(item.indicator, e)}
                          className="btn btn--sm btn--icon btn--quiet data-table__reveal"
                          title="Copiar indicador"
                          aria-label={`Copiar ${item.indicator}`}
                        >
                          {copiedIp === item.indicator ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        </button>
                      </div>
                    </td>
                    <td><span className="data-tag">{item.type.replace('_', ' ')}</span></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {item.clientNames.map((name) => (
                          <span key={name} className="data-tag data-tag--client">{name}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={severityChip(item.severity)}>
                        {item.occurrencesCount} de {clients.length}
                      </span>
                    </td>
                    <td>
                      <span className="data-table__clamp" title={item.firewallsImpacted.join(' · ')}>
                        {item.firewallsImpacted.join(' · ')}
                      </span>
                    </td>
                    <td className="text-right">
                      <ChevronRight className="data-table__chevron" aria-hidden="true" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="data-panel" aria-labelledby="overlap-title">
        <header className="data-panel__header">
          <div>
            <h2 id="overlap-title">Sobreposição entre clientes</h2>
            <p>Pares de clientes que mais bloqueiam os mesmos indicadores.</p>
          </div>
        </header>
        <div className="overlap-grid">
          {correlation.clientOverlapTable.slice(0, 9).map((pair) => (
            <div key={`${pair.clientA}-${pair.clientB}`} className="overlap-pair">
              <span className="overlap-pair__names">
                {pair.clientA} <ArrowLeftRight className="overlap-pair__icon" aria-hidden="true" /><span className="sr-only">e</span> {pair.clientB}
              </span>
              <strong>{pair.sharedCount}</strong>
              <small>{pair.sharedCount === 1 ? 'indicador' : 'indicadores'}</small>
            </div>
          ))}
        </div>
      </section>

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
