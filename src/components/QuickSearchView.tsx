import React, { useState, useEffect } from 'react';
import { Search, X, Building2, Shield, Calendar, Tag, CheckCircle2 } from 'lucide-react';
import { Client, BlocklistEntry } from '../types';
import { searchIndicatorAcrossClients } from '../db/indexedDb';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToClientList: (clientId: string) => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigateToClientList
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ client: Client; entry: BlocklistEntry }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const dialogRef = useDialogFocus(isOpen);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleSearch = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const matches = await searchIndicatorAcrossClients(query);
        setResults(matches);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(handleSearch, 200);
    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="quick-search-title" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-400" />
            <h3 id="quick-search-title" className="text-base font-bold text-white">
              Consulta Rápida de Indicador
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar consulta rápida"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Campo de Busca */}
        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              data-dialog-initial-focus
              placeholder="Digite um IP, CIDR ou Domínio para consultar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-slate-950 font-mono text-sm text-white pl-10 pr-4 py-3 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <p className="text-[11px] text-slate-400">
            Esta ferramenta realiza apenas leitura rápida para identificar presenças simultâneas, sem qualquer mesclagem entre as blocklists dos clientes.
          </p>

          {/* Resultados */}
          <div className="max-h-80 overflow-y-auto space-y-2 pt-2">
            {isSearching ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Pesquisando em todas as blocklists...
              </div>
            ) : query.trim() && results.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Nenhum cliente ativo possui o indicador "{query}".
              </div>
            ) : (
              results.map(({ client, entry }) => (
                <div
                  key={`${client.id}-${entry.id}`}
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex items-center justify-between text-xs transition"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white font-mono text-sm">
                        {entry.indicator}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 font-bold border border-blue-800 text-[10px] uppercase">
                        {client.name}
                      </span>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                        Ativo
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        Incluso: {entry.addedDate}
                      </span>
                      {entry.sourceTicket && (
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3 text-slate-500" />
                          Ticket: {entry.sourceTicket}
                        </span>
                      )}
                      {entry.notes && (
                        <span className="text-slate-300 italic">
                          "{entry.notes}"
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onNavigateToClientList(client.id);
                      onClose();
                    }}
                    className="text-xs text-blue-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 font-medium transition shrink-0"
                  >
                    Ver na Lista
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
