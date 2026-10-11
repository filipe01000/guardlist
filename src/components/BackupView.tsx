import React, { useState } from 'react';
import { AlertTriangle, Check, HardDriveDownload, HardDriveUpload, Settings } from 'lucide-react';
import { AppSettings } from '../types';
import { 
  exportFullBackupJSON, 
  restoreFullBackupJSON, 
  saveAppSettings 
} from '../db/indexedDb';
import { triggerDownload } from '../utils/exporter';
import { getDaysSince } from '../utils/validator';
import { PageHeader } from './PageHeader';

interface BackupViewProps {
  settings: AppSettings;
  onRefreshAll: () => void;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onOpenTests: () => void;
}

export const BackupView: React.FC<BackupViewProps> = ({
  settings,
  onRefreshAll,
  onUpdateSettings,
  onOpenTests
}) => {
  const [slaDaysInput, setSlaDaysInput] = useState<number>(settings.slaDays || 7);
  const [sortNumeric, setSortNumeric] = useState<boolean>(settings.sortNumericallyByDefault ?? true);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const daysSinceBackup = getDaysSince(settings.lastBackupDate);
  const isBackupOutdated = daysSinceBackup === null || daysSinceBackup > 7;

  // Exportar Backup JSON
  const handleExportBackup = async () => {
    try {
      const json = await exportFullBackupJSON();
      const today = new Date().toISOString().split('T')[0];
      triggerDownload(`backup_guardlist_${today}.json`, json, 'application/json');
      setStatusMessage({ text: 'Backup baixado.', type: 'success' });
      onRefreshAll();
    } catch (err: any) {
      setStatusMessage({ text: `Erro ao exportar backup: ${err.message}`, type: 'error' });
    }
  };

  // Restaurar Backup JSON
  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('Atenção: A restauração substituirá todos os dados atuais pelo conteúdo do arquivo de backup. Deseja continuar?')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = evt.target?.result as string;
        const res = await restoreFullBackupJSON(json);
        setStatusMessage({
          text: `Backup restaurado: ${res.clientsCount} clientes, ${res.entriesCount} entradas e ${res.historyCount} registros de histórico.`,
          type: 'success'
        });
        onRefreshAll();
      } catch (err: any) {
        setStatusMessage({ text: `Falha ao restaurar: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsText(file);
  };

  // Salvar Ajustes
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: AppSettings = {
      ...settings,
      slaDays: Number(slaDaysInput) || 7,
      sortNumericallyByDefault: sortNumeric
    };
    await saveAppSettings(updated);
    onUpdateSettings(updated);
    setStatusMessage({ text: 'Ajustes salvos.', type: 'success' });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup e ajustes"
        description="Os dados ficam salvos neste navegador. Baixe um backup com frequência para não depender de um único computador."
        actions={
          <span className={isBackupOutdated ? 'chip chip--warn' : 'chip chip--ok'}>
            {daysSinceBackup === null
              ? 'Nenhum backup feito'
              : daysSinceBackup === 0
                ? 'Último backup hoje'
                : `Último backup há ${daysSinceBackup} ${daysSinceBackup === 1 ? 'dia' : 'dias'}`}
          </span>
        }
      />

      {statusMessage && (
        <div className={`notice ${statusMessage.type === 'success' ? 'notice--ok' : 'notice--danger'}`} role="status">
          {statusMessage.type === 'success' ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <p>{statusMessage.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="data-panel p-5 flex flex-col gap-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <HardDriveDownload className="w-4 h-4 text-slate-400" aria-hidden="true" />
            Baixar backup
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed flex-1">
            Um arquivo .json com todos os clientes, listas, histórico e ajustes. Serve para guardar uma cópia ou levar os dados para outro computador.
          </p>
          <button type="button" onClick={handleExportBackup} className="btn btn--primary self-start">
            <HardDriveDownload aria-hidden="true" />
            Baixar backup
          </button>
        </section>

        <section className="data-panel p-5 flex flex-col gap-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <HardDriveUpload className="w-4 h-4 text-slate-400" aria-hidden="true" />
            Restaurar backup
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed flex-1">
            Substitui todos os dados deste navegador pelo conteúdo do arquivo. Antes de restaurar, baixe um backup do estado atual.
          </p>
          <label className="btn self-start">
            <HardDriveUpload aria-hidden="true" />
            Escolher arquivo .json
            <input type="file" accept=".json" className="hidden" onChange={handleRestoreBackup} />
          </label>
        </section>
      </div>

      <section className="data-panel p-5" aria-labelledby="settings-title">
        <h2 id="settings-title" className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-slate-400" aria-hidden="true" />
          Ajustes
        </h2>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="field-label" htmlFor="sla-days">Prazo de atualização (dias)</label>
            <input
              id="sla-days"
              type="number"
              min={1}
              max={60}
              value={slaDaysInput}
              onChange={(e) => setSlaDaysInput(Number(e.target.value))}
              className="field w-32 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Um cliente sem importação há mais de {slaDaysInput} dias aparece como atrasado no painel.
            </p>
          </div>

          <div>
            <span className="field-label">Exportação</span>
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={sortNumeric}
                onChange={(e) => setSortNumeric(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Ordenar IPs numericamente nos arquivos .txt e .csv
            </label>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="btn btn--primary">Salvar ajustes</button>
          </div>
        </form>
      </section>

      <details className="data-panel disclosure">
        <summary>Diagnóstico</summary>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 pb-5">
          <p className="text-xs text-slate-400 max-w-xl">
            Roda os testes de normalização de IPs, detecção de CIDR e casos de borda usados na importação.
          </p>
          <button type="button" onClick={onOpenTests} className="btn">
            Rodar testes
          </button>
        </div>
      </details>
    </div>
  );
};
