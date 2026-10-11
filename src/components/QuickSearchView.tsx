import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Search } from 'lucide-react';
import { Client, BlocklistEntry } from '../types';
import { lookupIndicators, searchIndicatorAcrossClients, type LookupResult } from '../db/store';
import { extractTokensFromRawInput } from '../utils/importer';
import { Modal } from './Modal';

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToClientList: (clientId: string) => void;
}

const MATCH_LABEL = { exact: 'Na lista', covered: 'Dentro de', inside: 'Contém' } as const;

// Consulta em todas as listas. Um termo: busca parcial. Vários (um por linha, ou separados por espaço/vírgula):
// mostra, para cada IP, em quais clientes ele está, se está dentro de um CIDR ou se já foi removido.
export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({ isOpen, onClose, onNavigateToClientList }) => {
  const [query, setQuery] = useState('');
  const [single, setSingle] = useState<Array<{ client: Client; entry: BlocklistEntry }>>([]);
  const [multi, setMulti] = useState<LookupResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [filter, setFilter] = useState<'all' | 'found' | 'missing'>('all');
  const [copied, setCopied] = useState(false);

  const tokens = useMemo(() => extractTokensFromRawInput(query).map((t) => t.token), [query]);
  const isMulti = tokens.length > 1;

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSingle([]);
      setMulti(null);
      setFilter('all');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setSingle([]);
      setMulti(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (isMulti) {
          const results = await lookupIndicators(tokens);
          if (!cancelled) {
            setMulti(results);
            setSingle([]);
          }
        } else {
          const [partial, exact] = await Promise.all([searchIndicatorAcrossClients(query.trim()), lookupIndicators([query.trim()])]);
          if (!cancelled) {
            setSingle(partial);
            // Mostra também CIDRs que cobrem o IP e itens removidos.
            setMulti(exact[0]?.matches.some((m) => m.match !== 'exact' || m.status === 'removed') ? exact : null);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isMulti, tokens]);

  const found = (multi || []).filter((r) => r.matches.length > 0);
  const missing = (multi || []).filter((r) => r.valid && r.matches.length === 0);
  const shown = (multi || []).filter((r) => (filter === 'found' ? r.matches.length > 0 : filter === 'missing' ? r.matches.length === 0 : true));

  const copyMissing = async () => {
    await navigator.clipboard.writeText(missing.map((r) => r.normalized).join('\n')).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const goTo = (clientId: string) => {
    onNavigateToClientList(clientId);
    onClose();
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="lg" title="Consultar IPs em todas as listas" subtitle="Só leitura: nada é alterado. Cole vários IPs (um por linha) para ver onde cada um está.">
      <div className="space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" aria-hidden="true" />
          <textarea
            autoFocus
            data-dialog-initial-focus
            rows={isMulti ? 5 : 1}
            placeholder="IP, CIDR ou domínio — ou cole vários, um por linha"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field w-full font-mono text-sm pl-10 py-3 resize-y"
            aria-label="Indicadores para consultar"
          />
        </div>

        {isSearching && (
          <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Pesquisando em todas as listas…</div>
        )}

        {isMulti && multi && !isSearching && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="segmented" role="group" aria-label="Filtrar resultados">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos ({multi.length})</button>
              <button type="button" aria-pressed={filter === 'found'} onClick={() => setFilter('found')}>Encontrados ({found.length})</button>
              <button type="button" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>Fora das listas ({missing.length})</button>
            </div>
            {missing.length > 0 && (
              <button type="button" className="btn btn--sm" onClick={copyMissing}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                Copiar os {missing.length} que não estão em nenhuma lista
              </button>
            )}
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {!isMulti && single.length > 0 && (
            <div className="mb-3">
              {single.map(({ client, entry }) => (
                <div key={`${client.id}-${entry.id}`} className="lookup-result">
                  <div className="lookup-result__head">
                    <span>
                      <span className="lookup-result__query">{entry.indicator}</span>{' '}
                      <span className="data-tag data-tag--client">{client.name}</span>{' '}
                      <span className="chip chip--ok">Ativo</span>
                    </span>
                    <button type="button" className="btn btn--sm" onClick={() => goTo(client.id)}>Ver na lista</button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Incluído {entry.addedDate}{entry.sourceTicket ? ` · ticket ${entry.sourceTicket}` : ''}{entry.addedBy ? ` · por ${entry.addedBy}` : ''}
                    {entry.notes ? ` · "${entry.notes}"` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(isMulti ? shown : multi || []).map((r) => (
            <div key={r.normalized} className="lookup-result">
              <div className="lookup-result__head">
                <span className="lookup-result__query">{r.normalized}</span>
                {!r.valid ? (
                  <span className="chip chip--danger">Inválido</span>
                ) : r.matches.length === 0 ? (
                  <span className="chip">Em nenhuma lista</span>
                ) : (
                  <span className="chip chip--warn">{new Set(r.matches.map((m) => m.clientId)).size} cliente(s)</span>
                )}
              </div>
              {r.matches.map((m) => (
                <div key={`${m.entryId}-${m.match}`} className="lookup-match">
                  <span className="min-w-0">
                    <strong className="text-white">{m.clientName}</strong>{' · '}
                    {MATCH_LABEL[m.match]}{m.match !== 'exact' && <span className="font-mono"> {m.indicator}</span>}{' · '}
                    <span className={m.status === 'active' ? 'text-emerald-400' : 'text-slate-400'}>{m.status === 'active' ? 'ativo' : 'removido'}</span>
                    <br />
                    <small>
                      Incluído {m.addedDate}{m.sourceTicket ? ` · ticket ${m.sourceTicket}` : ''}{m.addedBy ? ` · por ${m.addedBy}` : ''}
                      {m.notes ? ` · ${m.notes}` : ''}
                    </small>
                  </span>
                  <button type="button" className="btn btn--sm btn--quiet" onClick={() => goTo(m.clientId)}>Abrir</button>
                </div>
              ))}
            </div>
          ))}

          {!isSearching && query.trim() && !isMulti && single.length === 0 && !multi && (
            <p className="py-8 text-center text-xs text-slate-500">Nenhuma lista tem "{query.trim()}".</p>
          )}
        </div>
      </div>
    </Modal>
  );
};
