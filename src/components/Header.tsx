import React from 'react';
import { 
  ShieldAlert, 
  CopyCheck, 
  CalendarCheck, 
  DownloadCloud, 
  FileSpreadsheet, 
  PlusCircle, 
  Sparkles, 
  RotateCcw,
  AlertTriangle
} from 'lucide-react';

interface HeaderProps {
  currentTab: 'spreadsheet' | 'dedup' | 'weekly' | 'import' | 'export';
  setCurrentTab: (tab: 'spreadsheet' | 'dedup' | 'weekly' | 'import' | 'export') => void;
  totalIps: number;
  uniqueIps: number;
  internalDuplicatesCount: number;
  crossDuplicatesCount: number;
  reviewedClientsCount: number;
  totalClientsCount: number;
  onOpenAddModal: () => void;
  onQuickCleanDuplicates: () => void;
  onResetSampleData: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  totalIps,
  uniqueIps,
  internalDuplicatesCount,
  crossDuplicatesCount,
  reviewedClientsCount,
  totalClientsCount,
  onOpenAddModal,
  onQuickCleanDuplicates,
  onResetSampleData
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-30 shadow-md">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl shadow-inner">
            <ShieldAlert className="w-7 h-7 text-blue-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                SecOps Blocklists
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Controle Semanal
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Gestão e deduplicação de IPs para: <span className="text-slate-300 font-medium">CREA, SULGIPE, DELFINANCE, SANTA CASA, LABCHECAP, EMBASA, UNIT</span>
            </p>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {internalDuplicatesCount > 0 && (
            <button
              onClick={onQuickCleanDuplicates}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition shadow-sm animate-pulse"
              title="Remove automaticamente IPs duplicados mantendo a entrada mais recente"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Limpar {internalDuplicatesCount} Duplicatas Agora
            </button>
          )}

          <button
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            Novo Bloqueio
          </button>

          <button
            onClick={onResetSampleData}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Recarregar clientes e dados de teste"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar Padrão
          </button>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="bg-slate-950/60 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Total de IPs:</span>
              <span className="font-semibold text-slate-100 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                {totalIps}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">IPs Únicos:</span>
              <span className="font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
                {uniqueIps}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">Duplicados no Mesmo Cliente:</span>
              <span className={`font-semibold px-2 py-0.5 rounded border flex items-center gap-1 ${
                internalDuplicatesCount > 0 
                  ? 'bg-rose-950/60 text-rose-300 border-rose-800/60 font-bold' 
                  : 'bg-slate-800/80 text-slate-400 border-slate-700'
              }`}>
                {internalDuplicatesCount > 0 && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                {internalDuplicatesCount} {internalDuplicatesCount === 1 ? 'duplicata' : 'duplicatas'}
              </span>
            </div>

            <div className="flex items-center gap-2 hidden lg:flex">
              <span className="text-slate-400">IPs Compartilhados (Multi-Cliente):</span>
              <span className="font-semibold text-indigo-300 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/50">
                {crossDuplicatesCount}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Auditoria Semanal:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-20 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${totalClientsCount > 0 ? (reviewedClientsCount / totalClientsCount) * 100 : 0}%` }}
                />
              </div>
              <span className="text-slate-300 font-medium">
                {reviewedClientsCount}/{totalClientsCount} revisados
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-4 border-b border-transparent overflow-x-auto py-1">
          <button
            onClick={() => setCurrentTab('spreadsheet')}
            className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition whitespace-nowrap border-b-2 ${
              currentTab === 'spreadsheet'
                ? 'border-blue-500 text-blue-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Planilha de Controle
          </button>

          <button
            onClick={() => setCurrentTab('dedup')}
            className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition whitespace-nowrap border-b-2 relative ${
              currentTab === 'dedup'
                ? 'border-amber-500 text-amber-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <CopyCheck className="w-4 h-4" />
            Deduplicador & Limpeza
            {internalDuplicatesCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-rose-600 text-white text-[10px] font-bold rounded-full">
                {internalDuplicatesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setCurrentTab('weekly')}
            className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition whitespace-nowrap border-b-2 ${
              currentTab === 'weekly'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <CalendarCheck className="w-4 h-4" />
            Checklist Semanal
          </button>

          <button
            onClick={() => setCurrentTab('import')}
            className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition whitespace-nowrap border-b-2 ${
              currentTab === 'import'
                ? 'border-purple-500 text-purple-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Colar / Importar em Lote
          </button>

          <button
            onClick={() => setCurrentTab('export')}
            className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-t-lg transition whitespace-nowrap border-b-2 ${
              currentTab === 'export'
                ? 'border-cyan-500 text-cyan-400 bg-slate-800/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            <DownloadCloud className="w-4 h-4" />
            Exportar & Firewalls
          </button>
        </nav>
      </div>
    </header>
  );
};
