import React, { useState } from 'react';
import { 
  DownloadCloud, 
  Copy, 
  Check, 
  FileSpreadsheet, 
  Server, 
  Terminal, 
  Shield, 
  HardDriveDownload, 
  HardDriveUpload,
  Layers
} from 'lucide-react';
import { BlocklistEntry, ClientAuditStatus, ClientName } from '../types/blocklist';
import { 
  exportToCSV, 
  exportToPlainIPList, 
  exportToMikrotik, 
  exportToFortinet, 
  exportToIptables, 
  downloadFile 
} from '../utils/exportImport';

interface ExportViewProps {
  entries: BlocklistEntry[];
  clients: ClientName[];
  selectedClient: ClientName | 'ALL';
  auditStatuses: ClientAuditStatus[];
  onRestoreBackup: (entries: BlocklistEntry[], audits: ClientAuditStatus[], clients: ClientName[]) => void;
}

export const ExportView: React.FC<ExportViewProps> = ({
  entries,
  clients,
  selectedClient,
  auditStatuses,
  onRestoreBackup
}) => {
  const [exportFormat, setExportFormat] = useState<'csv' | 'txt' | 'mikrotik' | 'fortinet' | 'iptables'>('csv');
  const [delimiter, setDelimiter] = useState<';' | ','>(';');
  const [onlyActive, setOnlyActive] = useState<boolean>(true);
  const [uniqueOnly, setUniqueOnly] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Filter relevant entries
  const targetEntries = entries.filter(e => {
    if (selectedClient !== 'ALL' && e.client !== selectedClient) return false;
    if (onlyActive && e.status === 'removed') return false;
    return true;
  });

  const getGeneratedContent = (): string => {
    switch (exportFormat) {
      case 'csv':
        return exportToCSV(targetEntries, delimiter);
      case 'txt':
        return exportToPlainIPList(targetEntries, uniqueOnly);
      case 'mikrotik':
        return exportToMikrotik(targetEntries, 'BLOCKLIST');
      case 'fortinet':
        return exportToFortinet(targetEntries);
      case 'iptables':
        return exportToIptables(targetEntries);
      default:
        return '';
    }
  };

  const previewContent = getGeneratedContent();

  const handleDownload = () => {
    const today = new Date().toISOString().split('T')[0];
    const clientSlug = selectedClient === 'ALL' ? 'TODOS_CLIENTES' : selectedClient;
    
    switch (exportFormat) {
      case 'csv':
        downloadFile(`blocklist_${clientSlug}_${today}.csv`, previewContent, 'text/csv;charset=utf-8');
        break;
      case 'txt':
        downloadFile(`ips_${clientSlug}_${today}.txt`, previewContent, 'text/plain;charset=utf-8');
        break;
      case 'mikrotik':
        downloadFile(`mikrotik_blocklist_${clientSlug}_${today}.rsc`, previewContent, 'text/plain;charset=utf-8');
        break;
      case 'fortinet':
        downloadFile(`fortigate_blocklist_${clientSlug}_${today}.conf`, previewContent, 'text/plain;charset=utf-8');
        break;
      case 'iptables':
        downloadFile(`iptables_${clientSlug}_${today}.sh`, previewContent, 'text/plain;charset=utf-8');
        break;
    }
  };

  const handleCopyClipboard = () => {
    navigator.clipboard.writeText(previewContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Full JSON Backup & Restore
  const handleDownloadBackup = () => {
    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      clients,
      entries,
      auditStatuses
    };
    downloadFile(`backup_blocklists_${new Date().toISOString().split('T')[0]}.json`, JSON.stringify(backupData, null, 2), 'application/json');
  };

  const handleRestoreJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (json && Array.isArray(json.entries)) {
          onRestoreBackup(json.entries, json.auditStatuses || [], json.clients || clients);
        }
      } catch (err) {
        // failed parse
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/30">
                <DownloadCloud className="w-5 h-5 text-cyan-400" />
              </span>
              <h2 className="text-lg font-bold text-white">
                Exportação de Planilhas & Scripts de Firewall
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Exporte para Excel com formatação correta para o Brasil, lista de IPs puros ou scripts diretos para aplicar nos roteadores e firewalls da sua infraestrutura.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadBackup}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1.5"
              title="Baixar arquivo JSON com todos os dados e histórico"
            >
              <HardDriveDownload className="w-4 h-4 text-cyan-400" />
              Backup Completo (JSON)
            </button>

            <label className="cursor-pointer px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1.5">
              <HardDriveUpload className="w-4 h-4 text-purple-400" />
              Restaurar Backup
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleRestoreJsonFile}
              />
            </label>
          </div>
        </div>

        {/* Format Selector Pills */}
        <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-slate-800">
          <button
            onClick={() => setExportFormat('csv')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              exportFormat === 'csv'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Planilha Excel (.csv UTF-8)
          </button>

          <button
            onClick={() => setExportFormat('txt')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              exportFormat === 'txt'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Lista Simples (.txt)
          </button>

          <button
            onClick={() => setExportFormat('mikrotik')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              exportFormat === 'mikrotik'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Mikrotik RouterOS (.rsc)
          </button>

          <button
            onClick={() => setExportFormat('fortinet')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              exportFormat === 'fortinet'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Fortinet FortiGate (.conf)
          </button>

          <button
            onClick={() => setExportFormat('iptables')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              exportFormat === 'iptables'
                ? 'bg-cyan-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Linux Iptables (.sh)
          </button>
        </div>

        {/* Options for current format */}
        {exportFormat === 'csv' && (
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-300">
            <span>Delimitador:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="delimiter"
                checked={delimiter === ';'}
                onChange={() => setDelimiter(';')}
                className="text-cyan-600"
              />
              Ponto e vírgula (;) - Padrão Excel Brasil
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="delimiter"
                checked={delimiter === ','}
                onChange={() => setDelimiter(',')}
                className="text-cyan-600"
              />
              Vírgula (,) - Internacional / Google Sheets
            </label>
          </div>
        )}
      </div>

      {/* Preview Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-200">
              Pré-visualização do Arquivo:
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              ({targetEntries.length} itens incluídos para {selectedClient === 'ALL' ? 'Todos os Clientes' : selectedClient})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyClipboard}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : 'Copiar Tudo'}
            </button>

            <button
              onClick={handleDownload}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow transition"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              Baixar Arquivo
            </button>
          </div>
        </div>

        <pre className="w-full bg-slate-950 font-mono text-xs text-slate-300 p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-[420px] select-all leading-relaxed">
          {previewContent || 'Nenhum item para exportar com os filtros atuais.'}
        </pre>
      </div>
    </div>
  );
};
