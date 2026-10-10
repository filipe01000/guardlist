import React, { useState, useMemo } from 'react';
import { 
  UploadCloud, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Layers, 
  Building2, 
  ShieldCheck,
  Plus
} from 'lucide-react';
import { BlocklistEntry, ClientName } from '../types/blocklist';
import { classifyIpType, getCurrentWeekCode, isPrivateOrLocalIp, sanitizeIpInput } from '../utils/ipValidator';
import { INITIAL_REASONS, INITIAL_SOURCES } from '../utils/seedData';
import { parseCSV } from '../utils/exportImport';

interface BulkImportViewProps {
  clients: ClientName[];
  existingEntries: BlocklistEntry[];
  onImportEntries: (newEntries: BlocklistEntry[]) => void;
  defaultClient: ClientName;
}

export const BulkImportView: React.FC<BulkImportViewProps> = ({
  clients,
  existingEntries,
  onImportEntries,
  defaultClient
}) => {
  const currentWeek = getCurrentWeekCode();
  const [selectedClient, setSelectedClient] = useState<ClientName>(defaultClient || clients[0] || 'CREA');
  const [rawText, setRawText] = useState('');
  const [reason, setReason] = useState(INITIAL_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [source, setSource] = useState(INITIAL_SOURCES[0]);
  const [notes, setNotes] = useState('');
  
  // Options
  const [autoDedupInternal, setAutoDedupInternal] = useState(true);
  const [skipAlreadyExisting, setSkipAlreadyExisting] = useState(true);

  // Parse extracted items in real-time
  const parseResult = useMemo(() => {
    if (!rawText.trim()) return { items: [], duplicatesInInput: 0, alreadyInClient: 0, validCount: 0 };

    const lines = rawText.split(/[\r\n,;\s]+/).map(sanitizeIpInput).filter(Boolean);
    const seenInInput = new Set<string>();
    let duplicatesInInput = 0;
    let alreadyInClient = 0;

    const existingClientIps = new Set(
      existingEntries
        .filter(e => e.client === selectedClient && e.status !== 'removed')
        .map(e => e.normalizedIp)
    );

    const items: Array<{
      ip: string;
      normalized: string;
      type: ReturnType<typeof classifyIpType>;
      isPrivate: boolean;
      isDupInInput: boolean;
      alreadyInClient: boolean;
      valid: boolean;
    }> = [];

    for (const rawIp of lines) {
      const normalized = rawIp.toLowerCase();
      const type = classifyIpType(rawIp);
      const isPrivate = isPrivateOrLocalIp(rawIp);
      const isDupInInput = seenInInput.has(normalized);
      const inClient = existingClientIps.has(normalized);

      if (isDupInInput) {
        duplicatesInInput++;
      } else {
        seenInInput.add(normalized);
      }

      if (inClient) {
        alreadyInClient++;
      }

      items.push({
        ip: rawIp,
        normalized,
        type,
        isPrivate,
        isDupInInput,
        alreadyInClient: inClient,
        valid: type !== 'Invalido'
      });
    }

    const validCount = items.filter(i => {
      if (!i.valid) return false;
      if (autoDedupInternal && i.isDupInInput) return false;
      if (skipAlreadyExisting && i.alreadyInClient) return false;
      return true;
    }).length;

    return {
      items,
      duplicatesInInput,
      alreadyInClient,
      validCount
    };
  }, [rawText, selectedClient, existingEntries, autoDedupInternal, skipAlreadyExisting]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        // If csv, test parsing
        if (file.name.endsWith('.csv')) {
          const parsed = parseCSV(content, selectedClient, currentWeek);
          if (parsed.length > 0) {
            const newEntries: BlocklistEntry[] = parsed.map((p, idx) => {
              const clean = sanitizeIpInput(p.ip || '');
              return {
                id: `entry-csv-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                client: p.client || selectedClient,
                ip: clean,
                normalizedIp: clean.toLowerCase(),
                type: classifyIpType(clean),
                reason: p.reason || reason,
                source: p.source || source,
                addedDate: p.addedDate || new Date().toISOString().split('T')[0],
                weekCode: p.weekCode || currentWeek,
                status: 'active',
                isPrivateRange: isPrivateOrLocalIp(clean),
                notes: p.notes || ''
              };
            });
            onImportEntries(newEntries);
            return;
          }
        }
        setRawText(content);
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = () => {
    const finalReason = customReason.trim() || reason;
    const today = new Date().toISOString().split('T')[0];
    const seen = new Set<string>();

    const existingClientIps = new Set(
      existingEntries
        .filter(e => e.client === selectedClient && e.status !== 'removed')
        .map(e => e.normalizedIp)
    );

    const toImport: BlocklistEntry[] = [];

    for (const item of parseResult.items) {
      if (!item.valid) continue;
      if (autoDedupInternal && seen.has(item.normalized)) continue;
      if (skipAlreadyExisting && existingClientIps.has(item.normalized)) continue;

      seen.add(item.normalized);
      toImport.push({
        id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        client: selectedClient,
        ip: item.ip,
        normalizedIp: item.normalized,
        type: item.type,
        reason: finalReason,
        source,
        addedDate: today,
        weekCode: currentWeek,
        status: 'active',
        isPrivateRange: item.isPrivate,
        notes: notes.trim()
      });
    }

    if (toImport.length > 0) {
      onImportEntries(toImport);
      setRawText('');
      setNotes('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30">
                <UploadCloud className="w-5 h-5 text-purple-400" />
              </span>
              <h2 className="text-lg font-bold text-white">
                Importação em Lote & Extrator Inteligente
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Cole múltiplos IPs de relatórios, chamados ou logs de firewall. O sistema valida os formatos (IPv4/CIDR/IPv6) e deduplica automaticamente antes de salvar.
            </p>
          </div>

          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition">
            <FileText className="w-4 h-4 text-purple-400" />
            Carregar Arquivo (.txt ou .csv)
            <input
              type="file"
              accept=".txt,.csv,.log"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>

        {/* Form controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-5 border-t border-slate-800 text-xs">
          {/* Target Client */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              Cliente Destino:
            </label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full bg-slate-950 text-white rounded-lg p-2 border border-slate-700 focus:outline-none focus:border-purple-500 font-semibold"
            >
              {clients.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Motivo do Bloqueio:
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-950 text-white rounded-lg p-2 border border-slate-700 focus:outline-none focus:border-purple-500"
            >
              {INITIAL_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Ou digite um motivo personalizado..."
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="w-full mt-1.5 bg-slate-950 text-slate-300 text-xs rounded-lg p-1.5 border border-slate-800 focus:outline-none"
            />
          </div>

          {/* Source & Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Origem / Ferramenta:
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full bg-slate-950 text-white rounded-lg p-2 border border-slate-700 focus:outline-none focus:border-purple-500"
            >
              {INITIAL_SOURCES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Observação opcional para os IPs..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full mt-1.5 bg-slate-950 text-slate-300 text-xs rounded-lg p-1.5 border border-slate-800 focus:outline-none"
            />
          </div>
        </div>

        {/* Deduplication check options */}
        <div className="flex flex-wrap items-center gap-6 mt-4 pt-3 border-t border-slate-800/60 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
            <input
              type="checkbox"
              checked={autoDedupInternal}
              onChange={(e) => setAutoDedupInternal(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-purple-600 focus:ring-0"
            />
            <span>Deduplicar automaticamente (remove IPs repetidos no texto colado)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
            <input
              type="checkbox"
              checked={skipAlreadyExisting}
              onChange={(e) => setSkipAlreadyExisting(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-purple-600 focus:ring-0"
            />
            <span>Ignorar IPs que já existem na blocklist de <strong className="text-white">{selectedClient}</strong></span>
          </label>
        </div>
      </div>

      {/* Text Area and Real-time Preview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Column */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-200">
              Cole os IPs ou texto aqui:
            </label>
            <span className="text-[11px] text-slate-400">
              Aceita quebras de linha, vírgulas, espaços ou logs
            </span>
          </div>

          <textarea
            rows={12}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'185.220.101.5\n45.148.10.12\n192.168.1.1\n194.26.29.112/24\n185.220.101.5 (duplicado)'}
            className="w-full bg-slate-950 font-mono text-xs text-slate-100 p-3.5 rounded-xl border border-slate-700 focus:outline-none focus:border-purple-500 leading-relaxed"
          />

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setRawText('')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Limpar Campo
            </button>

            <button
              disabled={parseResult.validCount === 0}
              onClick={handleExecuteImport}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md ${
                parseResult.validCount > 0
                  ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer shadow-purple-600/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Plus className="w-4 h-4" />
              Importar {parseResult.validCount} IPs para {selectedClient}
            </button>
          </div>
        </div>

        {/* Live Validation Preview Column */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Prévia da Validação & Deduplicação
              </h3>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">Prontos p/ Importar:</span>
                <span className="font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                  {parseResult.validCount}
                </span>
              </div>
            </div>

            {/* Quick summary metrics */}
            <div className="grid grid-cols-3 gap-2 py-3 text-xs">
              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-slate-400 block text-[10px]">Identificados</span>
                <strong className="text-slate-200">{parseResult.items.length}</strong>
              </div>

              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-slate-400 block text-[10px]">Repetidos no Texto</span>
                <strong className={parseResult.duplicatesInInput > 0 ? 'text-amber-400' : 'text-slate-400'}>
                  {parseResult.duplicatesInInput}
                </strong>
              </div>

              <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-center">
                <span className="text-slate-400 block text-[10px]">Já no {selectedClient}</span>
                <strong className={parseResult.alreadyInClient > 0 ? 'text-rose-400' : 'text-slate-400'}>
                  {parseResult.alreadyInClient}
                </strong>
              </div>
            </div>

            {/* Scrollable list of items */}
            <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1 mt-2">
              {parseResult.items.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  Cole os IPs ao lado para ver a verificação automática de duplicidade e sintaxe aqui.
                </div>
              ) : (
                parseResult.items.map((item, idx) => {
                  const willBeIgnored = 
                    !item.valid || 
                    (autoDedupInternal && item.isDupInInput) || 
                    (skipAlreadyExisting && item.alreadyInClient);

                  return (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-between font-mono ${
                        willBeIgnored 
                          ? 'bg-slate-950/40 border-slate-800/60 opacity-60' 
                          : 'bg-slate-950 border-slate-700/80'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={willBeIgnored ? 'line-through text-slate-400' : 'text-slate-200 font-semibold'}>
                          {item.ip}
                        </span>

                        <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-400 font-sans">
                          {item.type}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 font-sans text-[10px]">
                        {!item.valid && (
                          <span className="text-rose-400 bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-800">
                            Inválido
                          </span>
                        )}

                        {item.isDupInInput && autoDedupInternal && (
                          <span className="text-amber-400 bg-amber-950/80 px-1.5 py-0.2 rounded border border-amber-800">
                            Duplicado (Ignorado)
                          </span>
                        )}

                        {item.alreadyInClient && skipAlreadyExisting && (
                          <span className="text-rose-300 bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-800">
                            Já cadastrado
                          </span>
                        )}

                        {item.isPrivate && (
                          <span className="text-amber-300 bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-800">
                            IP Privado
                          </span>
                        )}

                        {!willBeIgnored && (
                          <span className="text-emerald-400 flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                            Válido
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
