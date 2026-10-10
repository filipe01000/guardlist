import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Trash2, 
  Edit3, 
  Copy, 
  Check, 
  AlertTriangle, 
  ExternalLink, 
  Filter, 
  ArrowUpDown, 
  Download, 
  FileText,
  Shield,
  Layers,
  Sparkles
} from 'lucide-react';
import { BlocklistEntry, ClientName } from '../types/blocklist';
import { exportToCSV, downloadFile } from '../utils/exportImport';

interface SpreadsheetViewProps {
  entries: BlocklistEntry[];
  selectedClient: ClientName | 'ALL';
  onDeleteEntry: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onEditEntry: (entry: BlocklistEntry) => void;
  onCleanDuplicatesForClient: (client: ClientName) => void;
}

export const SpreadsheetView: React.FC<SpreadsheetViewProps> = ({
  entries,
  selectedClient,
  onDeleteEntry,
  onBulkDelete,
  onEditEntry,
  onCleanDuplicatesForClient
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'duplicates_only' | 'private_only' | 'cross_only'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'addedDate' | 'ip' | 'client' | 'reason'>('addedDate');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Precompute duplicate statistics for highlighting in cells
  const duplicateMap = useMemo(() => {
    const map = new Map<string, { total: number; clients: Set<string>; ids: string[] }>();
    for (const item of entries) {
      if (item.status === 'removed') continue;
      const key = item.normalizedIp;
      if (!map.has(key)) {
        map.set(key, { total: 0, clients: new Set(), ids: [] });
      }
      const data = map.get(key)!;
      data.total += 1;
      data.clients.add(item.client);
      data.ids.push(item.id);
    }
    return map;
  }, [entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter(item => {
      // Client filter
      if (selectedClient !== 'ALL' && item.client !== selectedClient) {
        return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesIp = item.ip.toLowerCase().includes(q);
        const matchesClient = item.client.toLowerCase().includes(q);
        const matchesReason = item.reason.toLowerCase().includes(q);
        const matchesSource = item.source.toLowerCase().includes(q);
        const matchesNotes = (item.notes || '').toLowerCase().includes(q);
        if (!matchesIp && !matchesClient && !matchesReason && !matchesSource && !matchesNotes) {
          return false;
        }
      }

      const dupInfo = duplicateMap.get(item.normalizedIp);
      const isInternalDup = dupInfo ? dupInfo.ids.filter(id => {
        const match = entries.find(e => e.id === id);
        return match && match.client === item.client;
      }).length > 1 : false;

      const isCrossDup = dupInfo ? dupInfo.clients.size > 1 : false;

      // Status Filter
      if (statusFilter === 'duplicates_only') {
        if (!isInternalDup) return false;
      } else if (statusFilter === 'cross_only') {
        if (!isCrossDup) return false;
      } else if (statusFilter === 'private_only') {
        if (!item.isPrivateRange) return false;
      }

      return true;
    }).sort((a, b) => {
      let valA: string = a[sortField] || '';
      let valB: string = b[sortField] || '';

      if (sortField === 'ip') {
        // Natural IP sorting
        valA = a.normalizedIp;
        valB = b.normalizedIp;
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [entries, selectedClient, searchTerm, statusFilter, sortField, sortAsc, duplicateMap]);

  // Handle select all / clear
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredEntries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEntries.map(e => e.id)));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const handleExportFiltered = () => {
    const csv = exportToCSV(filteredEntries);
    const clientSlug = selectedClient === 'ALL' ? 'TODOS_CLIENTES' : selectedClient;
    downloadFile(`blocklist_${clientSlug}_${new Date().toISOString().split('T')[0]}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleSort = (field: 'addedDate' | 'ip' | 'client' | 'reason') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // Count internal duplicates in currently filtered list
  const currentClientInternalDups = useMemo(() => {
    let count = 0;
    const seen = new Set<string>();
    const clientTarget = selectedClient === 'ALL' ? null : selectedClient;
    
    for (const entry of entries) {
      if (clientTarget && entry.client !== clientTarget) continue;
      const key = `${entry.client}:::${entry.normalizedIp}`;
      if (seen.has(key)) {
        count++;
      } else {
        seen.add(key);
      }
    }
    return count;
  }, [entries, selectedClient]);

  return (
    <div className="space-y-4">
      {/* Control / Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por IP, motivo, cliente ou observações..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 text-slate-100 placeholder-slate-500 text-xs sm:text-sm pl-9 pr-4 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                statusFilter === 'all' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos ({entries.filter(e => selectedClient === 'ALL' || e.client === selectedClient).length})
            </button>

            <button
              onClick={() => setStatusFilter('duplicates_only')}
              className={`px-2.5 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                statusFilter === 'duplicates_only' 
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800' 
                  : 'text-slate-400 hover:text-rose-400'
              }`}
            >
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              Duplicados ({currentClientInternalDups})
            </button>

            <button
              onClick={() => setStatusFilter('cross_only')}
              className={`px-2.5 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                statusFilter === 'cross_only' 
                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800' 
                  : 'text-slate-400 hover:text-indigo-400'
              }`}
            >
              <Layers className="w-3 h-3 text-indigo-400" />
              Multi-Cliente
            </button>

            <button
              onClick={() => setStatusFilter('private_only')}
              className={`px-2.5 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                statusFilter === 'private_only' 
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800' 
                  : 'text-slate-400 hover:text-amber-400'
              }`}
            >
              IPs Privados
            </button>
          </div>

          {/* Quick action: Deduplicate current view if any duplicates exist */}
          {currentClientInternalDups > 0 && selectedClient !== 'ALL' && (
            <button
              onClick={() => onCleanDuplicatesForClient(selectedClient)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition shadow-sm"
              title={`Remover os ${currentClientInternalDups} IPs duplicados do cliente ${selectedClient}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Limpar {currentClientInternalDups} Duplicados de {selectedClient}
            </button>
          )}

          {/* Export button */}
          <button
            onClick={handleExportFiltered}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            Baixar CSV
          </button>
        </div>
      </div>

      {/* Batch Selection Banner */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-950/60 border border-blue-800/80 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-blue-200">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{selectedIds.size}</span> itens selecionados na planilha
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onBulkDelete(Array.from(selectedIds));
                setSelectedIds(new Set());
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1 rounded-md font-semibold flex items-center gap-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir Selecionados
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-400 hover:text-white px-2 py-1"
            >
              Desmarcar Todos
            </button>
          </div>
        </div>
      )}

      {/* Spreadsheet Table Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-medium select-none">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredEntries.length > 0 && selectedIds.size === filteredEntries.length}
                    onChange={handleToggleSelectAll}
                    className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                </th>

                <th className="py-3 px-3 w-28 cursor-pointer hover:text-white" onClick={() => handleSort('client')}>
                  <div className="flex items-center gap-1">
                    Cliente
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>

                <th className="py-3 px-3 w-44 cursor-pointer hover:text-white" onClick={() => handleSort('ip')}>
                  <div className="flex items-center gap-1">
                    Endereço IP / Faixa
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>

                <th className="py-3 px-3 w-24">
                  Tipo
                </th>

                <th className="py-3 px-3 min-w-[200px] cursor-pointer hover:text-white" onClick={() => handleSort('reason')}>
                  <div className="flex items-center gap-1">
                    Motivo do Bloqueio
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>

                <th className="py-3 px-3 w-36">
                  Origem / Alerta
                </th>

                <th className="py-3 px-3 w-28 cursor-pointer hover:text-white" onClick={() => handleSort('addedDate')}>
                  <div className="flex items-center gap-1">
                    Data Inclusão
                    <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  </div>
                </th>

                <th className="py-3 px-3 w-24">
                  Semana
                </th>

                <th className="py-3 px-3 w-32">
                  Status & Avisos
                </th>

                <th className="py-3 px-3 w-24 text-right">
                  Ações
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                    <FileText className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
                    Nenhum IP encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isSelected = selectedIds.has(entry.id);
                  const dupInfo = duplicateMap.get(entry.normalizedIp);
                  
                  // Check if duplicated within this same client
                  const clientEntries = dupInfo ? dupInfo.ids.filter(id => {
                    const match = entries.find(e => e.id === id);
                    return match && match.client === entry.client;
                  }) : [];
                  const isInternalDuplicate = clientEntries.length > 1;

                  // Check if present in other clients
                  const isCrossDuplicate = dupInfo ? dupInfo.clients.size > 1 : false;
                  const otherClients = dupInfo ? Array.from(dupInfo.clients).filter(c => c !== entry.client) : [];

                  return (
                    <tr 
                      key={entry.id}
                      className={`hover:bg-slate-800/50 transition-colors group ${
                        isSelected ? 'bg-blue-950/30' : ''
                      } ${isInternalDuplicate ? 'bg-rose-950/15' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(entry.id)}
                          className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Client */}
                      <td className="py-2.5 px-3 font-sans font-semibold text-slate-200">
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/80 text-[11px]">
                          {entry.client}
                        </span>
                      </td>

                      {/* IP / CIDR */}
                      <td className="py-2.5 px-3 font-medium text-white">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-mono font-semibold ${
                            isInternalDuplicate ? 'text-rose-300' : 'text-slate-100'
                          }`}>
                            {entry.ip}
                          </span>

                          <button
                            onClick={() => handleCopyIp(entry.ip)}
                            className="p-1 text-slate-500 hover:text-slate-200 rounded transition opacity-0 group-hover:opacity-100"
                            title="Copiar IP"
                          >
                            {copiedIp === entry.ip ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="py-2.5 px-3 font-sans">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                          entry.type === 'CIDR'
                            ? 'bg-purple-950/60 text-purple-300 border border-purple-800/60'
                            : entry.type === 'IPv6'
                            ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                          {entry.type}
                        </span>
                      </td>

                      {/* Reason */}
                      <td className="py-2.5 px-3 font-sans text-slate-300">
                        <div className="truncate max-w-[240px]" title={entry.reason}>
                          {entry.reason}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px]">
                        <span className="truncate max-w-[130px] block" title={entry.source}>
                          {entry.source}
                        </span>
                      </td>

                      {/* Added Date */}
                      <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px]">
                        {entry.addedDate}
                      </td>

                      {/* Week Code */}
                      <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px]">
                        <span className="bg-slate-800/60 px-1.5 py-0.5 rounded border border-slate-700/60 font-mono text-[10px]">
                          {entry.weekCode}
                        </span>
                      </td>

                      {/* Status & Badges */}
                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex flex-col gap-1 items-start">
                          {isInternalDuplicate && (
                            <span 
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/80 border border-rose-800 px-1.5 py-0.2 rounded"
                              title="Este IP aparece duplicado mais de uma vez para este mesmo cliente! Use o botão de limpeza."
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                              Duplicado ({clientEntries.length}x)
                            </span>
                          )}

                          {isCrossDuplicate && (
                            <span 
                              className="inline-flex items-center gap-1 text-[10px] text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-1.5 py-0.2 rounded"
                              title={`Também ativo em: ${otherClients.join(', ')}`}
                            >
                              <Layers className="w-2.5 h-2.5 text-indigo-400" />
                              Também em {otherClients.length} outro(s)
                            </span>
                          )}

                          {entry.isPrivateRange && (
                            <span 
                              className="inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded"
                              title="Atenção: IP pertencente a faixa privada RFC1918 ou loopback!"
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                              Faixa Privada
                            </span>
                          )}

                          {!isInternalDuplicate && !isCrossDuplicate && !entry.isPrivateRange && (
                            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                              <Shield className="w-2.5 h-2.5" />
                              Ativo
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right font-sans">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onEditEntry(entry)}
                            className="p-1 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition"
                            title="Editar este registro"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onDeleteEntry(entry.id)}
                            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                            title="Excluir IP da blocklist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="bg-slate-950/80 px-4 py-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Exibindo <span className="font-semibold text-slate-200">{filteredEntries.length}</span> de <span className="font-semibold text-slate-200">{entries.length}</span> registros totais
          </div>
          {currentClientInternalDups > 0 && (
            <div className="text-rose-400 flex items-center gap-1 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              {currentClientInternalDups} entradas duplicadas identificadas para limpeza
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
