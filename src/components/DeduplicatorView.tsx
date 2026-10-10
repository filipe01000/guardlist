import React, { useState, useMemo } from 'react';
import { 
  Sparkles, 
  Trash2, 
  CheckCircle2, 
  Layers, 
  AlertTriangle, 
  ArrowRight, 
  Copy, 
  Check, 
  ShieldCheck,
  Building2,
  Calendar,
  FileText
} from 'lucide-react';
import { BlocklistEntry, ClientName } from '../types/blocklist';
import { analyzeDuplicates } from '../utils/deduplication';

interface DeduplicatorViewProps {
  entries: BlocklistEntry[];
  clients: ClientName[];
  selectedClient: ClientName | 'ALL';
  onCleanDuplicatesForClient: (client: ClientName, keepStrategy: 'keep_newest' | 'keep_oldest') => void;
  onDeleteEntry: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
}

export const DeduplicatorView: React.FC<DeduplicatorViewProps> = ({
  entries,
  clients,
  selectedClient,
  onCleanDuplicatesForClient,
  onDeleteEntry,
  onBulkDelete
}) => {
  const [activeTab, setActiveTab] = useState<'internal' | 'cross' | 'scratchpad'>('internal');
  const [keepStrategy, setKeepStrategy] = useState<'keep_newest' | 'keep_oldest'>('keep_newest');
  const [copiedText, setCopiedText] = useState(false);
  
  // Quick scratchpad states for on-the-fly cleaning
  const [scratchInput, setScratchInput] = useState('');
  const [scratchOutput, setScratchOutput] = useState('');
  const [scratchStats, setScratchStats] = useState<{ total: number; unique: number; removed: number } | null>(null);

  // Analysis based on the active client filter or all
  const analysis = useMemo(() => {
    return analyzeDuplicates(entries, selectedClient);
  }, [entries, selectedClient]);

  // Separate same-client duplicates from cross-only
  const sameClientGroups = useMemo(() => {
    return analysis.groups.filter(g => g.hasSameClientDuplicates);
  }, [analysis]);

  const crossOnlyGroups = useMemo(() => {
    return analysis.groups.filter(g => g.isCrossClient && !g.hasSameClientDuplicates);
  }, [analysis]);

  const handleCleanCurrent = () => {
    onCleanDuplicatesForClient(selectedClient, keepStrategy);
  };

  // Scratchpad instant dedup logic
  const handleProcessScratchpad = () => {
    if (!scratchInput.trim()) return;
    const lines = scratchInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const seen = new Set<string>();
    const uniqueList: string[] = [];
    
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueList.push(line);
      }
    }

    setScratchOutput(uniqueList.join('\n'));
    setScratchStats({
      total: lines.length,
      unique: uniqueList.length,
      removed: lines.length - uniqueList.length
    });
  };

  const handleCopyScratch = () => {
    navigator.clipboard.writeText(scratchOutput);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Hero Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-amber-500/20 text-amber-300 rounded-lg border border-amber-500/30">
                <Sparkles className="w-5 h-5 text-amber-400" />
              </span>
              <h2 className="text-lg font-bold text-white">
                Módulo de Deduplicação & Higienização de IPs
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Identifique e elimine repetições de IPs em suas listas de controle semanal para evitar regras redundantes em firewalls Fortinet, Mikrotik, PFSense e WAFs.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800 text-xs">
              <span className="text-slate-400 px-1">Critério:</span>
              <select
                value={keepStrategy}
                onChange={(e) => setKeepStrategy(e.target.value as any)}
                className="bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:outline-none"
              >
                <option value="keep_newest">Manter o mais recente</option>
                <option value="keep_oldest">Manter o mais antigo</option>
              </select>
            </div>

            <button
              disabled={analysis.sameClientDuplicatesCount === 0}
              onClick={handleCleanCurrent}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl transition shadow-md ${
                analysis.sameClientDuplicatesCount > 0
                  ? 'bg-amber-500 hover:bg-amber-400 text-black cursor-pointer shadow-amber-500/10'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {selectedClient === 'ALL'
                ? `Remover Todas as ${analysis.sameClientDuplicatesCount} Duplicatas`
                : `Limpar ${analysis.sameClientDuplicatesCount} Duplicatas de ${selectedClient}`}
            </button>
          </div>
        </div>

        {/* Status Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/80 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-0.5">Duplicatas Internas:</span>
            <span className={`text-base font-bold flex items-center gap-1 ${
              analysis.sameClientDuplicatesCount > 0 ? 'text-rose-400' : 'text-emerald-400'
            }`}>
              {analysis.sameClientDuplicatesCount > 0 ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  {analysis.sameClientDuplicatesCount} entradas repetidas
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  0 (Listas limpas)
                </>
              )}
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-0.5">IPs Cruzados (Multi-Cliente):</span>
            <span className="text-base font-bold text-indigo-300 flex items-center gap-1">
              <Layers className="w-4 h-4" />
              {analysis.crossClientDuplicatesCount} IPs em múltiplos clientes
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-0.5">Total de IPs Analisados:</span>
            <span className="text-base font-bold text-slate-200">
              {entries.filter(e => selectedClient === 'ALL' || e.client === selectedClient).length} registros
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block mb-0.5">IPs Únicos Resultantes:</span>
            <span className="text-base font-bold text-emerald-400">
              {analysis.uniqueIpCount} IPs
            </span>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs font-medium">
        <button
          onClick={() => setActiveTab('internal')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
            activeTab === 'internal'
              ? 'bg-rose-950/80 text-rose-300 border border-rose-800 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          Duplicatas Internas por Cliente ({sameClientGroups.length})
        </button>

        <button
          onClick={() => setActiveTab('cross')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
            activeTab === 'cross'
              ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          IPs em Múltiplos Clientes ({crossOnlyGroups.length})
        </button>

        <button
          onClick={() => setActiveTab('scratchpad')}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
            activeTab === 'scratchpad'
              ? 'bg-blue-950/80 text-blue-300 border border-blue-800 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-blue-400" />
          Deduplicador Instantâneo de Texto
        </button>
      </div>

      {/* Tab 1: Internal Duplicates */}
      {activeTab === 'internal' && (
        <div className="space-y-4">
          {sameClientGroups.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-3">
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-full w-12 h-12 flex items-center justify-center mx-auto border border-emerald-500/20">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Nenhum IP duplicado encontrado!</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {selectedClient === 'ALL'
                  ? 'Todas as blocklists dos 7 clientes estão completamente higienizadas sem repetições internas.'
                  : `A lista do cliente ${selectedClient} está limpa e sem IPs duplicados.`}
              </p>
            </div>
          ) : (
            sameClientGroups.map((group) => {
              // Group entries by client to show internal repetition
              const perClient = new Map<string, typeof group.entries>();
              for (const entry of group.entries) {
                if (!perClient.has(entry.client)) {
                  perClient.set(entry.client, []);
                }
                perClient.get(entry.client)!.push(entry);
              }

              return (
                <div
                  key={group.normalizedIp}
                  className="bg-slate-900 border border-rose-900/40 rounded-xl p-4 shadow-sm space-y-3"
                >
                  {/* Header of group */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-base font-bold text-white px-2.5 py-1 bg-slate-950 rounded-lg border border-slate-700">
                        {group.ip}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                        {group.count} ocorrências no total
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          // Keep latest for this group and delete the rest
                          const sorted = [...group.entries].sort((a, b) => new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime());
                          const toDelete = sorted.slice(1).map(e => e.id);
                          onBulkDelete(toDelete);
                        }}
                        className="px-2.5 py-1 text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg transition"
                      >
                        Manter o Mais Recente e Apagar Cópias
                      </button>
                    </div>
                  </div>

                  {/* List of occurrences */}
                  <div className="space-y-2">
                    {group.entries.map((item, idx) => (
                      <div
                        key={item.id}
                        className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="px-2 py-0.5 rounded bg-slate-800 font-semibold text-slate-200 border border-slate-700">
                            {item.client}
                          </span>
                          <span className="text-slate-300 font-medium">
                            {item.reason}
                          </span>
                          <span className="text-slate-400 text-[11px] flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {item.addedDate}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            Fonte: {item.source}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] text-blue-400 font-semibold bg-blue-950/80 px-1.5 py-0.2 rounded border border-blue-800">
                              Original / Primeiro registro
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => onDeleteEntry(item.id)}
                            className="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition"
                            title="Remover apenas esta ocorrência específica"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Cross Client Overlap */}
      {activeTab === 'cross' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-indigo-900/40 rounded-xl p-4 text-xs text-indigo-200 flex items-start gap-3">
            <Layers className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">Inteligência de Ameaças Compartilhada</p>
              <p className="text-slate-300 mt-0.5">
                Estes IPs aparecem cadastrados nas blocklists de múltiplos clientes ao mesmo tempo. 
                Isso indica campanhas de varredura ou botnets atacando simultaneamente diversas infraestruturas da sua carteira (ex: CREA, EMBASA, LABCHECAP).
              </p>
            </div>
          </div>

          {crossOnlyGroups.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
              Nenhum IP compartilhado entre clientes diferentes no momento.
            </div>
          ) : (
            crossOnlyGroups.map((group) => (
              <div
                key={group.normalizedIp}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white px-2 py-0.5 bg-slate-950 rounded border border-slate-700">
                      {group.ip}
                    </span>
                    <span className="text-xs text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800 font-medium">
                      Ativo em {group.clients.length} clientes: {group.clients.join(', ')}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {group.entries.map((item) => (
                    <div key={item.id} className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-200 mr-2">{item.client}:</span>
                        <span className="text-slate-400">{item.reason}</span>
                      </div>
                      <span className="text-slate-500 text-[11px]">{item.addedDate}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 3: Instant Text Deduplicator Scratchpad */}
      {activeTab === 'scratchpad' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white">Deduplicador Rápido de Texto Solto</h3>
            <p className="text-xs text-slate-400 mt-1">
              Cole qualquer texto ou coluna de IPs (ex: copiado de um chamado, log ou planilha Excel) para remover duplicados instantaneamente.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Cole aqui a lista bruta (um por linha):
              </label>
              <textarea
                rows={9}
                value={scratchInput}
                onChange={(e) => setScratchInput(e.target.value)}
                placeholder={'192.168.1.1\n10.0.0.1\n192.168.1.1\n177.12.34.56'}
                className="w-full bg-slate-950 font-mono text-xs text-slate-100 p-3 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleProcessScratchpad}
                disabled={!scratchInput.trim()}
                className="disabled-action mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded-lg transition"
              >
                Deduplicar Lista
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">
                  Resultado Limpo (Sem Duplicados):
                </label>
                {scratchOutput && (
                  <button
                    onClick={handleCopyScratch}
                    className="text-xs text-blue-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedText ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedText ? 'Copiado!' : 'Copiar'}
                  </button>
                )}
              </div>
              <textarea
                readOnly
                rows={9}
                value={scratchOutput}
                placeholder="A lista limpa aparecerá aqui..."
                className="w-full bg-slate-950/80 font-mono text-xs text-emerald-300 p-3 rounded-xl border border-slate-700 focus:outline-none select-all"
              />
              {scratchStats && (
                <div className="mt-2 text-xs text-slate-400 flex items-center justify-between">
                  <span>Total: <strong className="text-slate-200">{scratchStats.total}</strong></span>
                  <span>Únicos: <strong className="text-emerald-400">{scratchStats.unique}</strong></span>
                  <span>Duplicados Removidos: <strong className="text-rose-400">{scratchStats.removed}</strong></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
