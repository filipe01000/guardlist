import React, { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { WeeklyImportView } from './components/WeeklyImportView';
import { ClientListView } from './components/ClientListView';
import { IntelligenceView } from './components/IntelligenceView';
import { HistoryView } from './components/HistoryView';
import { ClientManagerView } from './components/ClientManagerView';
import { BackupView } from './components/BackupView';
import { QuickSearchModal } from './components/QuickSearchView';
import { TestRunnerModal } from './components/TestRunnerModal';
import { Client, AppSettings, BlocklistEntry, ImportHistoryRecord } from './types';
import { 
  initializeDatabaseIfEmpty, 
  getAllClients, 
  getDashboardStats, 
  getAppSettings,
  bulkInsertEntries,
  replaceClientEntries,
  addHistoryRecord,
  getClientEntries,
  getAllActiveEntries
} from './db/indexedDb';
import { generateFirewallTxt, generateNanoFormattedTxt, triggerDownload } from './utils/exporter';
import { getDaysSince } from './utils/validator';
import { CheckCircle2 } from 'lucide-react';

interface AppProps {
  currentUser?: string | null;
  onLogout?: () => void;
}

export default function App({ currentUser = null, onLogout }: AppProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const savedTheme = window.localStorage.getItem('guardlist-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('guardlist-sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [currentTab, setCurrentTab] = useState<
    'dashboard' | 'import' | 'client-list' | 'intelligence' | 'history' | 'clients' | 'backup'
  >('dashboard');

  const [clients, setClients] = useState<Client[]>([]);
  const [activeCounts, setActiveCounts] = useState<Record<string, number>>({});
  const [ipCounts, setIpCounts] = useState<Record<string, number>>({});
  const [cidrCounts, setCidrCounts] = useState<Record<string, number>>({});
  const [totalActiveAcrossAll, setTotalActiveAcrossAll] = useState<number>(0);
  const [totalIpsAcrossAll, setTotalIpsAcrossAll] = useState<number>(0);
  const [totalCidrsAcrossAll, setTotalCidrsAcrossAll] = useState<number>(0);
  const [totalCorrelatedIps, setTotalCorrelatedIps] = useState<number>(0);
  const [addedThisWeekCount, setAddedThisWeekCount] = useState<number>(0);
  const [allActiveEntries, setAllActiveEntries] = useState<BlocklistEntry[]>([]);

  const [settings, setSettings] = useState<AppSettings>({
    slaDays: 7,
    lastBackupDate: null,
    sortNumericallyByDefault: true
  });

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [importTargetClientId, setImportTargetClientId] = useState<string>('');

  // Modais globais
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [isTestsOpen, setIsTestsOpen] = useState(false);

  useEffect(() => {
    const handleQuickSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsQuickSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleQuickSearchShortcut);
    return () => window.removeEventListener('keydown', handleQuickSearchShortcut);
  }, []);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Carregar dados do IndexedDB
  const refreshAllData = useCallback(async () => {
    try {
      await initializeDatabaseIfEmpty();
      const loadedClients = await getAllClients();
      const stats = await getDashboardStats();
      const loadedSettings = await getAppSettings();
      const entries = await getAllActiveEntries();

      setClients(loadedClients);
      setActiveCounts(stats.activeCounts);
      setIpCounts(stats.ipCounts);
      setCidrCounts(stats.cidrCounts);
      setTotalActiveAcrossAll(stats.totalActiveAcrossAll);
      setTotalIpsAcrossAll(stats.totalIpsAcrossAll);
      setTotalCidrsAcrossAll(stats.totalCidrsAcrossAll);
      setTotalCorrelatedIps(stats.totalCorrelatedIps);
      setAddedThisWeekCount(stats.addedThisWeekCount);
      setAllActiveEntries(entries);
      setSettings(loadedSettings);

      if (!selectedClientId && loadedClients.length > 0) {
        setSelectedClientId(loadedClients[0].id);
      }
    } catch (err) {
      console.error('Erro ao inicializar dados do IndexedDB:', err);
    }
  }, [selectedClientId]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('guardlist-theme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem('guardlist-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      // Preferência opcional; ignora navegadores sem armazenamento local.
    }
  }, [sidebarCollapsed]);

  // Navegações cruzadas
  const handleNavigateToImport = (clientId: string) => {
    setImportTargetClientId(clientId);
    setCurrentTab('import');
  };

  const handleNavigateToList = (clientId: string) => {
    setSelectedClientId(clientId);
    setCurrentTab('client-list');
  };

  // Exportação rápida de .txt direto do dashboard
  const handleQuickExportTxt = async (client: Client) => {
    try {
      const entries = await getClientEntries(client.id, 'active');
      const txt = generateFirewallTxt(entries, settings.sortNumericallyByDefault);
      const today = new Date().toISOString().split('T')[0];
      triggerDownload(`${client.name}_blocklist_${today}.txt`, txt, 'text/plain;charset=utf-8');
      showToast(`Lista de ${client.name} baixada em .txt.`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickExportNanoTxt = async (client: Client) => {
    try {
      const entries = await getClientEntries(client.id, 'active');
      const txt = generateNanoFormattedTxt(entries, settings.sortNumericallyByDefault);
      const today = new Date().toISOString().split('T')[0];
      triggerDownload(`${client.name}_blocklist_nano_${today}.txt`, txt, 'text/plain;charset=utf-8');
      showToast(`Lista de ${client.name} baixada no formato NANO.`);
    } catch (err) {
      console.error(err);
    }
  };

  // Salvar lote de importação com suporte a 'append' (adicionar) ou 'replace' (substituir)
  const handleSaveImportBatch = async (
    entries: BlocklistEntry[],
    clientId: string,
    historyRecord: ImportHistoryRecord,
    todayStr: string,
    mode: 'append' | 'replace' = 'append'
  ) => {
    const currentActiveEntries = await getClientEntries(clientId, 'active');
    historyRecord.totalBefore = currentActiveEntries.length;

    if (mode === 'replace') {
      const res = await replaceClientEntries(entries, clientId, todayStr);
      historyRecord.totalAfter = entries.length;
      historyRecord.addedCount = res.added;
      historyRecord.notes = (historyRecord.notes ? historyRecord.notes + ' • ' : '') + `Modo Substituir (-${res.removed} itens arquivados)`;
    } else {
      historyRecord.totalAfter = currentActiveEntries.length + entries.length;
      await bulkInsertEntries(entries, clientId, todayStr);
    }

    await addHistoryRecord(historyRecord);
    await refreshAllData();
  };

  const handleImportSuccess = (clientId: string, addedCount: number) => {
    setSelectedClientId(clientId);
    showToast(`${addedCount} indicadores gravados na lista do cliente.`);
    setCurrentTab('client-list');
  };

  // Troca de tema com revelação circular a partir do botão (View Transitions), quando disponível.
  const handleToggleTheme = (origin?: { x: number; y: number }) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      flushSync(() => setTheme(next));
    };
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startViewTransition = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (!startViewTransition || reduceMotion) {
      apply();
      return;
    }
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement.style;
    root.setProperty('--reveal-x', `${x}px`);
    root.setProperty('--reveal-y', `${y}px`);
    root.setProperty('--reveal-r', `${radius}px`);
    startViewTransition.call(document, apply);
  };

  const daysSinceBackup = getDaysSince(settings.lastBackupDate);
  const isBackupOutdated = daysSinceBackup === null || daysSinceBackup > 7;

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} min-h-screen text-slate-100 flex flex-col font-sans`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 aria-hidden="true" />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Menu lateral */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onOpenQuickSearch={() => setIsQuickSearchOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isBackupOutdated={isBackupOutdated}
        daysSinceBackup={daysSinceBackup}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(value => !value)}
        currentUser={currentUser}
        onLogout={onLogout}
      />

      {/* Conteúdo Principal */}
      <main className="studio-main flex-1">
        <div key={currentTab} className="view-enter">
        {currentTab === 'dashboard' && (
          <DashboardView
            clients={clients}
            activeCounts={activeCounts}
            ipCounts={ipCounts}
            cidrCounts={cidrCounts}
            totalActiveAcrossAll={totalActiveAcrossAll}
            totalIpsAcrossAll={totalIpsAcrossAll}
            totalCidrsAcrossAll={totalCidrsAcrossAll}
            totalCorrelatedIps={totalCorrelatedIps}
            addedThisWeekCount={addedThisWeekCount}
            allActiveEntries={allActiveEntries}
            slaDays={settings.slaDays || 7}
            onNavigateToImport={handleNavigateToImport}
            onNavigateToList={handleNavigateToList}
            onNavigateToHistory={() => setCurrentTab('history')}
            onQuickExportTxt={handleQuickExportTxt}
            onQuickExportNanoTxt={handleQuickExportNanoTxt}
            onOpenIntelligenceTab={() => setCurrentTab('intelligence')}
          />
        )}

        {currentTab === 'intelligence' && (
          <IntelligenceView
            allEntries={allActiveEntries}
            clients={clients}
            onNavigateToClientList={handleNavigateToList}
          />
        )}

        {currentTab === 'import' && (
          <WeeklyImportView
            clients={clients}
            initialClientId={importTargetClientId || selectedClientId}
            onImportSuccess={handleImportSuccess}
            onSaveBatch={handleSaveImportBatch}
          />
        )}

        {currentTab === 'client-list' && (
          <ClientListView
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={setSelectedClientId}
            onRefreshStats={refreshAllData}
          />
        )}

        {currentTab === 'history' && (
          <HistoryView clients={clients} onStartImport={() => setCurrentTab('import')} />
        )}

        {currentTab === 'clients' && (
          <ClientManagerView
            clients={clients}
            activeCounts={activeCounts}
            onRefreshClients={refreshAllData}
          />
        )}

        {currentTab === 'backup' && (
          <BackupView
            settings={settings}
            onRefreshAll={refreshAllData}
            onUpdateSettings={setSettings}
            onOpenTests={() => setIsTestsOpen(true)}
          />
        )}
        </div>
      </main>

      {/* Modal de Consulta Rápida (Sem misturar dados) */}
      <QuickSearchModal
        isOpen={isQuickSearchOpen}
        onClose={() => setIsQuickSearchOpen(false)}
        onNavigateToClientList={handleNavigateToList}
      />

      {/* Modal de Testes Unitários da Validação (Acessível via Modo Dev em Backup) */}
      <TestRunnerModal
        isOpen={isTestsOpen}
        onClose={() => setIsTestsOpen(false)}
      />
    </div>
  );
}
