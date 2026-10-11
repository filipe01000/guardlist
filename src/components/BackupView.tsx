import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, CloudUpload, HardDriveDownload, HardDriveUpload, Settings } from 'lucide-react';
import { AppSettings } from '../types';
import { 
  exportFullBackupJSON, 
  restoreFullBackupJSON, 
  saveAppSettings 
} from '../db/store';
import { triggerDownload } from '../utils/exporter';
import { readLegacyBrowserData, type LegacyBrowserData } from '../db/legacyBrowserStore';
import { getDaysSince } from '../utils/validator';
import { PageHeader } from './PageHeader';

interface BackupViewProps {
  settings: AppSettings;
  onRefreshAll: () => void;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onOpenTests: () => void;
  isAdmin: boolean;
}

const LEGACY_DISMISSED_KEY = 'guardlist-legacy-migration-dismissed';

export const BackupView: React.FC<BackupViewProps> = ({
  settings,
  onRefreshAll,
  onUpdateSettings,
  onOpenTests,
  isAdmin
}) => {
  const [slaDaysInput, setSlaDaysInput] = useState<number>(settings.slaDays || 7);
  const [sortNumeric, setSortNumeric] = useState<boolean>(settings.sortNumericallyByDefault ?? true);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [legacy, setLegacy] = useState<LegacyBrowserData | null>(null);
  const [migrating, setMigrating] = useState(false);

  // Dados de versões anteriores que ficaram só neste navegador.
  useEffect(() => {
    if (!isAdmin) return;
    try {
      if (window.localStorage.getItem(LEGACY_DISMISSED_KEY) === '1') return;
    } catch {
      // Sem armazenamento local: segue mostrando a opção.
    }
    readLegacyBrowserData().then(setLegacy).catch(() => setLegacy(null));
  }, [isAdmin]);

  const dismissLegacy = () => {
    try {
      window.localStorage.setItem(LEGACY_DISMISSED_KEY, '1');
    } catch {
      // Preferência opcional.
    }
    setLegacy(null);
  };

  const handleMigrateLegacy = async () => {
    if (!legacy) return;
    if (!window.confirm(`Enviar ${legacy.clients.length} clientes e ${legacy.entries.length} entradas deste navegador para a base da equipe? Isso substitui todos os dados que estão no servidor hoje.`)) return;
    setMigrating(true);
    try {
      const res = await restoreFullBackupJSON(JSON.stringify(legacy));
      setStatusMessage({ text: `Dados enviados: ${res.clientsCount} clientes, ${res.entriesCount} entradas e ${res.historyCount} registros de histórico.`, type: 'success' });
      dismissLegacy();
      onRefreshAll();
    } catch (err) {
      setStatusMessage({ text: `Falha ao enviar: ${err instanceof Error ? err.message : 'erro desconhecido'}`, type: 'error' });
    } finally {
      setMigrating(false);
    }
  };

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

    if (!window.confirm('A restauração substitui todos os dados da equipe pelo conteúdo do arquivo. Continuar?')) {
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
        description="Os dados ficam no servidor e são compartilhados pela equipe. Baixe um backup de vez em quando para ter uma cópia fora dele."
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
            Substitui todos os dados da equipe pelo conteúdo do arquivo. Antes de restaurar, baixe um backup do estado atual.
          </p>
          {isAdmin ? (
            <label className="btn self-start">
              <HardDriveUpload aria-hidden="true" />
              Escolher arquivo .json
              <input type="file" accept=".json" className="hidden" onChange={handleRestoreBackup} />
            </label>
          ) : (
            <p className="text-[11px] text-slate-500">Só administradores podem restaurar backups.</p>
          )}
        </section>
      </div>

      {legacy && (
        <section className="data-panel p-5 flex flex-col sm:flex-row sm:items-center gap-4" aria-labelledby="legacy-title">
          <CloudUpload className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <h2 id="legacy-title" className="text-sm font-bold text-white">Dados antigos neste navegador</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Antes da base compartilhada, o GuardList guardava os dados em cada navegador. Este tem {legacy.clients.length} clientes
              e {legacy.entries.length} entradas que podem ir para a base da equipe. O envio substitui o que está no servidor.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="btn btn--quiet" onClick={dismissLegacy}>Ignorar</button>
            <button type="button" className="btn btn--primary" onClick={handleMigrateLegacy} disabled={migrating}>
              {migrating ? 'Enviando…' : 'Enviar para a equipe'}
            </button>
          </div>
        </section>
      )}

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
