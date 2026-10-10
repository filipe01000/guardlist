import React, { useState } from 'react';
import { 
  HardDriveDownload, 
  HardDriveUpload, 
  Settings, 
  Check, 
  AlertTriangle, 
  Calendar, 
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import { AppSettings } from '../types';
import { 
  exportFullBackupJSON, 
  restoreFullBackupJSON, 
  saveAppSettings 
} from '../db/indexedDb';
import { triggerDownload } from '../utils/exporter';
import { getDaysSince } from '../utils/validator';

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
      setStatusMessage({ text: 'Backup JSON gerado e baixado com sucesso!', type: 'success' });
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
          text: `Backup restaurado com sucesso! (${res.clientsCount} clientes, ${res.entriesCount} entradas, ${res.historyCount} registros históricos)`,
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
    setStatusMessage({ text: 'Configurações atualizadas com sucesso!', type: 'success' });
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <HardDriveDownload className="w-5 h-5 text-rose-400" />
            Backup Geral &amp; Ajustes do Sistema
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Gere cópias de segurança de todas as blocklists e históricos ou configure prazos de conformidade.
          </p>
        </div>

        {/* Status do Backup */}
        <div className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
          isBackupOutdated 
            ? 'bg-amber-950/80 text-amber-300 border-amber-800' 
            : 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
        }`}>
          {isBackupOutdated ? <AlertTriangle className="w-4 h-4 text-amber-400" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
          <span>
            {daysSinceBackup === null 
              ? 'Backup Pendente' 
              : `Último backup: há ${daysSinceBackup} dia(s)`}
          </span>
        </div>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' 
            : 'bg-rose-950/80 text-rose-300 border border-rose-800'
        }`}>
          <Check className="w-4 h-4" />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Grid de Backup e Restauração */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Exportar Backup */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <HardDriveDownload className="w-4 h-4 text-blue-400" />
            Exportar Backup Completo (JSON)
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Gera um único arquivo JSON contendo todos os clientes, entradas de blocklists, histórico semanal e configurações locais. Ideal para transferir para outro computador ou salvar de segurança.
          </p>
          <div className="pt-2">
            <button
              onClick={handleExportBackup}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <HardDriveDownload className="w-4 h-4" />
              Baixar Arquivo de Backup JSON
            </button>
          </div>
        </div>

        {/* Restaurar Backup */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <HardDriveUpload className="w-4 h-4 text-purple-400" />
            Restaurar a partir de Backup (JSON)
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Carregue um arquivo JSON gerado anteriormente para restaurar todas as tabelas no IndexedDB do navegador.
          </p>
          <div className="pt-2">
            <label className="cursor-pointer w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2">
              <HardDriveUpload className="w-4 h-4 text-purple-400" />
              Selecionar Arquivo JSON de Backup
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleRestoreBackup}
              />
            </label>
          </div>
        </div>

      </div>

      {/* Configurações Gerais do Sistema */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Settings className="w-4 h-4 text-amber-400" />
          Parâmetros de Alerta e Conformidade
        </h3>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Prazo Limite para Atualização Semanal (Dias):
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={slaDaysInput}
              onChange={(e) => setSlaDaysInput(Number(e.target.value))}
              className="w-full bg-slate-950 text-white p-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500 font-mono"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Se um cliente passar mais de {slaDaysInput} dias sem importação, o card no dashboard ficará em vermelho como "Atrasada".
            </span>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Ordenação Padrão na Exportação:
            </label>
            <label className="flex items-center gap-2 mt-3 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={sortNumeric}
                onChange={(e) => setSortNumeric(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-0"
              />
              <span>Ordenar IPs numericamente por padrão nos arquivos .txt e .csv</span>
            </label>
          </div>

          <div className="md:col-span-2 flex justify-end pt-2">
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-5 rounded-xl text-xs shadow transition cursor-pointer"
            >
              Salvar Ajustes
            </button>
          </div>
        </form>
      </div>

      {/* Diagnóstico técnico secundário, recolhido por padrão. */}
      <details className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-200">Diagnóstico técnico</summary>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
              Validação de regras
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Ferramenta isolada para validação algorítmica de normalização de IPs, detecção CIDR e tratamento de casos de borda.
            </p>
          </div>
          <button
            onClick={onOpenTests}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-xs font-bold transition shadow-sm cursor-pointer"
          >
            Executar Bateria de Testes Unitários
          </button>
        </div>
      </details>

      {/* Referência de implantação secundária, recolhida por padrão. */}
      <details className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-200">Referência de implantação multioperador</summary>
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            Notas de arquitetura para implantação centralizada
          </h3>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            A versão atual mantém os dados localmente no navegador. Uma implantação com vários analistas exige armazenamento central, autenticação e trilha de auditoria.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border border-slate-800 rounded-xl overflow-hidden font-sans">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase font-semibold">
              <tr>
                <th className="py-2.5 px-3 border-b border-slate-800">Camada / Componente</th>
                <th className="py-2.5 px-3 border-b border-slate-800">Tecnologia Recomendada</th>
                <th className="py-2.5 px-3 border-b border-slate-800">Função no SOC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300 text-[11px]">
              <tr>
                <td className="py-2 px-3 font-bold text-blue-400 font-sans">Frontend</td>
                <td className="py-2 px-3">React + TypeScript + Tailwind</td>
                <td className="py-2 px-3 font-sans">Interface operacional, pré-visualização de lote e correlação CTI.</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-bold text-blue-300 font-sans">Backend</td>
                <td className="py-2 px-3">FastAPI (Python) ou Node.js (Express/NestJS)</td>
                <td className="py-2 px-3 font-sans">Processamento de feeds, consultas assíncronas CTI e controle de versão.</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-bold text-blue-300 font-sans">Banco Principal</td>
                <td className="py-2 px-3">PostgreSQL + PostGIS/ip4r</td>
                <td className="py-2 px-3 font-sans">Armazenamento relacional de blocklists com índices de rede tipo CIDR.</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-bold text-blue-300 font-sans">Autenticação &amp; RBAC</td>
                <td className="py-2 px-3">OAuth2 / SAML / JWT</td>
                <td className="py-2 px-3 font-sans">Permissões granulares: Administrador SOC, Analista N1 e Auditor de Firewall.</td>
              </tr>
              <tr>
                <td className="py-2 px-3 font-bold text-blue-300 font-sans">Cache Local</td>
                <td className="py-2 px-3">IndexedDB (Browser)</td>
                <td className="py-2 px-3 font-sans">Cache de alta velocidade offline e buffer durante manipulações de lista.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};
