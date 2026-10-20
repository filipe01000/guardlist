import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import { BlocklistEntry, Client, CorrelationPage } from '../types';
import { getCorrelationPage, getIndicatorEntries } from '../db/store';
import { IpDossierModal } from './IpDossierModal';
import { Modal } from './Modal';
import { PageHeader } from './PageHeader';
import { EvolutionPanel } from './EvolutionPanel';

interface IntelligenceViewProps {
  clients: Client[];
  onNavigateToClientList: (clientId: string) => void;
}

const CorrelationPanel: React.FC<IntelligenceViewProps> = ({
  clients
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'critical' | 'high' | 'medium'>('ALL');
  const [selectedIpForDossier, setSelectedIpForDossier] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimeout = useRef<number | null>(null);
  const copyVersion = useRef(0);
  const [correlation, setCorrelation] = useState<CorrelationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reload, setReload] = useState(0);
  const [dossierEntries, setDossierEntries] = useState<BlocklistEntry[]>([]);
  const [dossierState, setDossierState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [dossierRetry, setDossierRetry] = useState(0);
  const activeClients = clients.filter(client => !client.isArchived);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm), 200);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (searchTerm !== debouncedSearch) return;
    getCorrelationPage({ search: debouncedSearch, clientId: clientFilter, severity: severityFilter, page, pageSize })
      .then(result => {
        if (cancelled) return;
        setCorrelation(result);
        if (result.page !== page) setPage(result.page);
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a correlação.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [searchTerm, debouncedSearch, clientFilter, severityFilter, page, pageSize, reload, clients]);

  useEffect(() => {
    if (!selectedIpForDossier) return;
    let cancelled = false;
    setDossierState('loading');
    setDossierError(null);
    getIndicatorEntries(selectedIpForDossier)
      .then(matches => {
        if (cancelled) return;
        setDossierEntries(matches);
        setDossierState('ready');
      })
      .catch(reason => {
        if (cancelled) return;
        setDossierError(reason instanceof Error ? reason.message : 'Não foi possível carregar as ocorrências do indicador.');
        setDossierState('error');
      });
    return () => { cancelled = true; };
  }, [selectedIpForDossier, dossierRetry]);

  useEffect(() => () => {
    copyVersion.current += 1;
    if (copyTimeout.current !== null) window.clearTimeout(copyTimeout.current);
  }, []);

  const openDossier = (indicator: string) => {
    setDossierEntries([]);
    setDossierState('loading');
    setDossierError(null);
    setSelectedIpForDossier(indicator);
  };

  const handleCopy = async (ip: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const version = ++copyVersion.current;
    if (copyTimeout.current !== null) window.clearTimeout(copyTimeout.current);
    copyTimeout.current = null;
    setCopiedIp(null);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(ip);
      if (version !== copyVersion.current) return;
      setCopiedIp(ip);
      copyTimeout.current = window.setTimeout(() => { setCopiedIp(null); copyTimeout.current = null; }, 2000);
    } catch {
      if (version === copyVersion.current) setCopyError(`Não foi possível copiar ${ip}. Selecione o indicador e use Ctrl+C.`);
    }
  };

  const filteredList = loading || error ? [] : correlation?.sharedIndicators || [];
  const summary = correlation?.summary;
  const activeClientsCount = summary?.activeClientsCount ?? activeClients.length;
  const totalPages = Math.max(1, Math.ceil((correlation?.total || 0) / pageSize));

  const severityChip = (severity: string) =>
    severity === 'critical' ? 'chip chip--danger' : severity === 'high' ? 'chip chip--warn' : 'chip';

  return (
    <div className="space-y-6">

      <div className="workspace-summary intelligence-summary" aria-label="Resumo de correlação">
        <div className="workspace-summary__item">
          <span>Indicadores correlacionados</span>
          <strong>{summary?.totalCorrelatedIpsCount ?? '—'}</strong>
          <small>Presentes em 2 ou mais clientes</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__risk">
          <span>Maior disseminação</span>
          <strong>{summary?.maxDissemination ?? '—'}/{activeClientsCount}</strong>
          <small>Clientes com o mesmo indicador</small>
        </div>
        <div className="workspace-summary__item">
          <span>Redes CIDR em comum</span>
          <strong>{summary?.cidrSharedCount ?? '—'}</strong>
          <small>Blocos repetidos entre listas</small>
        </div>
        <div className="workspace-summary__item intelligence-summary__critical">
          <span>Nível crítico</span>
          <strong>{summary?.criticalCount ?? '—'}</strong>
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
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            aria-label="Buscar indicador ou cliente"
          />
        </label>
        <div className="toolbar__group">
          <select className="field" value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(1); }} aria-label="Filtrar por cliente">
            <option value="ALL">Todos os clientes</option>
            {activeClients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="field" value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value as typeof severityFilter); setPage(1); }} aria-label="Filtrar por severidade">
            <option value="ALL">Todas as severidades</option>
            <option value="critical">Crítica (4+ clientes)</option>
            <option value="high">Alta (3 clientes)</option>
            <option value="medium">Média (2 clientes)</option>
          </select>
        </div>
      </div>

      {copyError && <p className="notice notice--danger" role="alert">{copyError}</p>}

      <section className="data-panel" aria-labelledby="shared-title" aria-busy={loading}>
        <header className="data-panel__header">
          <h2 id="shared-title">Indicadores em comum</h2>
          <span role="status">{loading ? 'Carregando…' : error ? 'Consulta indisponível' : `${correlation?.total || 0} ${correlation?.total === 1 ? 'resultado' : 'resultados'}`}</span>
        </header>

        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '10%' }} />
              <col />
              <col style={{ width: '15%' }} />
              <col style={{ width: '40px' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Tipo</th>
                <th>Clientes</th>
                <th>Disseminação</th>
                <th aria-label="Abrir" />
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Search aria-hidden="true" />
                      <strong>{loading ? 'Carregando indicadores…' : error ? 'Não foi possível carregar a correlação' : summary?.totalCorrelatedIpsCount === 0 ? 'Nenhum indicador em comum' : 'Nenhum indicador encontrado'}</strong>
                      {error ? (
                        <>
                          <p role="alert">{error}</p>
                          <button type="button" className="btn btn--sm" onClick={() => setReload(value => value + 1)}>Tentar novamente</button>
                        </>
                      ) : <p>{loading ? 'Consultando as listas dos clientes.' : summary?.totalCorrelatedIpsCount === 0 ? 'A correlação aparece quando o mesmo indicador ativo é bloqueado por dois ou mais clientes.' : 'Ajuste a busca ou os filtros para ver outros resultados.'}</p>}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => (
                  <tr
                    key={item.indicator}
                    onClick={() => openDossier(item.indicator)}
                    className="is-clickable"
                  >
                    <td>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="data-table__primary"
                          onClick={(e) => { e.stopPropagation(); openDossier(item.indicator); }}
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
                        {item.occurrencesCount} de {activeClientsCount}
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
          <p>Exibindo <strong>{filteredList.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + filteredList.length}` : '0'}</strong> de <strong>{correlation?.total || 0}</strong></p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              Por página
              <select className="field" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} aria-label="Indicadores correlacionados por página">
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <nav className="flex items-center gap-2" aria-label="Páginas de indicadores correlacionados">
              <button type="button" className="btn btn--sm btn--icon" disabled={loading || Boolean(error) || page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Página anterior"><ChevronLeft aria-hidden="true" /></button>
              <span className="font-mono" aria-live="polite">{page} / {totalPages}</span>
              <button type="button" className="btn btn--sm btn--icon" disabled={loading || Boolean(error) || page >= totalPages} onClick={() => setPage(value => value + 1)} aria-label="Próxima página"><ChevronRight aria-hidden="true" /></button>
            </nav>
          </div>
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
          {(correlation?.clientOverlapTable || []).slice(0, 9).map((pair) => (
            <div key={`${pair.clientA}-${pair.clientB}`} className="overlap-pair">
              <span className="overlap-pair__names">
                {pair.clientA} <ArrowLeftRight className="overlap-pair__icon" aria-hidden="true" /><span className="sr-only">e</span> {pair.clientB}
              </span>
              <strong>{pair.sharedCount}</strong>
              <small>{pair.sharedCount === 1 ? 'indicador' : 'indicadores'}</small>
            </div>
          ))}
        </div>
        {!correlation?.clientOverlapTable.length && (
          <div className="empty-state">
            <ArrowLeftRight aria-hidden="true" />
            <strong>{loading ? 'Carregando sobreposição…' : error ? 'Sobreposição indisponível' : 'Nenhuma sobreposição entre clientes'}</strong>
            <p>{loading ? 'Consultando indicadores ativos em comum.' : error ? 'Tente carregar a correlação novamente.' : 'Os pares aparecem quando dois clientes bloqueiam o mesmo indicador ativo.'}</p>
          </div>
        )}
      </section>

      {selectedIpForDossier && dossierState === 'ready' && (
        <IpDossierModal
          indicator={selectedIpForDossier}
          onClose={() => setSelectedIpForDossier(null)}
          allEntries={dossierEntries}
          clients={clients}
        />
      )}
      <Modal open={Boolean(selectedIpForDossier) && dossierState !== 'ready'} title={`Dossiê de ${selectedIpForDossier || ''}`} onClose={() => setSelectedIpForDossier(null)}>
        {dossierState === 'error' ? (
          <div className="space-y-4">
            <p className="notice notice--danger" role="alert">{dossierError}</p>
            <button type="button" className="btn btn--primary" onClick={() => setDossierRetry(value => value + 1)}>Tentar novamente</button>
          </div>
        ) : <p role="status">Carregando as ocorrências deste indicador nos clientes…</p>}
      </Modal>
    </div>
  );
};

// Inteligência de IPs: correlação entre clientes e evolução (tamanho da lista, países e provedores).
export const IntelligenceView: React.FC<IntelligenceViewProps> = (props) => {
  const [view, setView] = useState<'correlation' | 'evolution'>('correlation');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inteligência de IPs"
        description={view === 'correlation'
          ? 'Indicadores que aparecem em duas ou mais listas de clientes. Clique em uma linha para abrir o dossiê.'
          : 'Como as listas cresceram, de onde vêm os IPs bloqueados e quais provedores mais aparecem.'}
      />
      <div className="page-tabs" role="tablist" aria-label="Visões">
        <button type="button" role="tab" aria-selected={view === 'correlation'} onClick={() => setView('correlation')}>Correlação entre clientes</button>
        <button type="button" role="tab" aria-selected={view === 'evolution'} onClick={() => setView('evolution')}>Evolução e origem</button>
      </div>
      <div key={view} className="view-enter">
        {view === 'correlation' ? <CorrelationPanel {...props} /> : <EvolutionPanel clients={props.clients} />}
      </div>
    </div>
  );
};
