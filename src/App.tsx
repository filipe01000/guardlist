import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Navbar, type AppTab } from './components/Navbar';
import { AdminView } from './components/AdminView';
import { ReportsView } from './components/ReportsView';
import { AccountModal } from './components/AccountModal';
import { DashboardView } from './components/DashboardView';
import { WeeklyImportView } from './components/WeeklyImportView';
import { ClientListView } from './components/ClientListView';
import { IntelligenceView } from './components/IntelligenceView';
import { HistoryView } from './components/HistoryView';
import { ClientManagerView } from './components/ClientManagerView';
import { BackupView } from './components/BackupView';
import { ReviewView } from './components/ReviewView';
import { QuickSearchModal } from './components/QuickSearchView';
import { TestRunnerModal } from './components/TestRunnerModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Client, AppSettings, BlocklistEntry, ImportOutcome, SessionUser } from './types';
import {
  getAllClients,
  getDashboardStats,
  getAppSettings,
  getClientEntries,
  getAllActiveEntries,
  getNotifications,
  importBatch,
  undoImport,
  type ImportBatchPayload
} from './db/store';
import { generateFirewallTxt, generateNanoFormattedTxt, triggerDownload } from './utils/exporter';
import { getDaysSince } from './utils/validator';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface AppProps {
  currentUser: SessionUser;
  onLogout: () => void;
  onUserChange: (user: SessionUser) => void;
}

const LIVE_REFRESH_MS = 60_000;

export interface ToastOptions {
  type?: 'success' | 'info' | 'warn';
  action?: { label: string; onClick: () => void | Promise<void> };
  durationMs?: number;
}
export type ShowToast = (text: string, options?: ToastOptions | 'success' | 'info' | 'warn') => void;

// Atalhos de navegação (tecla única, fora de campos de texto).
const NAV_SHORTCUTS: Record<string, AppTab> = {
  d: 'dashboard',
  i: 'import',
  l: 'client-list',
  r: 'review',
  h: 'history',
  t: 'intelligence',
  p: 'reports'
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export default function App({ currentUser, onLogout, onUserChange }: AppProps) {
  const isAdmin = currentUser.role === 'admin';
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
  const [currentTab, setCurrentTab] = useState<AppTab>('dashboard');
  // Tela anterior, para o botão Voltar da importação.
  const [previousTab, setPreviousTab] = useState<AppTab>('dashboard');
  const tabRef = useRef<AppTab>('dashboard');
  useEffect(() => {
    if (tabRef.current === currentTab) return;
    setPreviousTab(tabRef.current);
    tabRef.current = currentTab;
  }, [currentTab]);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

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
  const [notifications, setNotifications] = useState<{ pendingApprovals: number; failedJobs: string[] }>({ pendingApprovals: 0, failedJobs: [] });

  const [settings, setSettings] = useState<AppSettings>({
    slaDays: 7,
    lastBackupDate: null,
    sortNumericallyByDefault: true
  });

  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [importTargetClientId, setImportTargetClientId] = useState<string>('');
  const [adminTab, setAdminTab] = useState<'users' | 'approvals' | 'audit' | 'status'>('users');

  // Modais globais
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [isTestsOpen, setIsTestsOpen] = useState(false);

  // Aviso (toast), com ação opcional como "Desfazer".
  const [toast, setToast] = useState<{ id: number; text: string; type: 'success' | 'info' | 'warn'; action?: ToastOptions['action']; durationMs: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast: ShowToast = useCallback((text, options) => {
    const opts: ToastOptions = typeof options === 'string' ? { type: options } : options || {};
    const durationMs = opts.durationMs ?? (opts.action ? 8000 : 3500);
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, type: opts.type || 'success', action: opts.action, durationMs });
    toastTimer.current = window.setTimeout(() => setToast(null), durationMs);
  }, []);

  // Carrega a base compartilhada da equipe.
  const refreshAllData = useCallback(async () => {
    try {
      const [loadedClients, stats, loadedSettings, entries, notes] = await Promise.all([
        getAllClients(),
        getDashboardStats(),
        getAppSettings(),
        getAllActiveEntries(),
        getNotifications().catch(() => null)
      ]);

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
      if (notes) setNotifications(notes);

      setSelectedClientId((current) => current || loadedClients.find((c) => !c.isArchived)?.id || '');
    } catch (err) {
      console.error('Erro ao carregar os dados da equipe:', err);
    }
  }, []);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // Mantém a tela em dia com o que os colegas alteram: ao voltar para a aba e a cada minuto.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshAllData();
    };
    const timer = window.setInterval(refreshIfVisible, LIVE_REFRESH_MS);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
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

  // Atalhos globais: Ctrl/⌘ K ou / consulta; ? mostra a lista; letras navegam.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsQuickSearchOpen(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.key === '/') {
        event.preventDefault();
        setIsQuickSearchOpen(true);
      } else if (event.key === '?') {
        setIsShortcutsOpen(true);
      } else if (NAV_SHORTCUTS[event.key]) {
        setCurrentTab(NAV_SHORTCUTS[event.key]);
      } else if (event.key === 'a' && isAdmin) {
        setCurrentTab('admin');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAdmin]);

  // Navegações cruzadas
  const handleNavigateToImport = (clientId: string) => {
    setImportTargetClientId(clientId);
    setCurrentTab('import');
  };

  const handleNavigateToList = (clientId: string) => {
    setSelectedClientId(clientId);
    setCurrentTab('client-list');
  };

  const openApprovals = () => {
    setAdminTab('approvals');
    setCurrentTab('admin');
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

  // Grava o lote (ou envia para aprovação) e atualiza a tela.
  const handleSaveImportBatch = async (payload: ImportBatchPayload): Promise<ImportOutcome> => {
    const outcome = await importBatch(payload);
    await refreshAllData();
    return outcome;
  };

  const handleImportSuccess = (clientId: string, outcome: ImportOutcome) => {
    setSelectedClientId(clientId);
    if (outcome.status === 'pending') {
      showToast('Importação enviada para aprovação de um administrador. Você verá o resultado em Histórico quando for aprovada.', { type: 'info', durationMs: 6000 });
      return;
    }
    const parts = [`${outcome.added} indicadores gravados.`];
    if (outcome.retired > 0) parts.push(`${outcome.retired} retirados por repetição, CIDR ou exceção.`);
    if (outcome.blockedByException > 0) parts.push(`${outcome.blockedByException} recusados pelas exceções.`);
    showToast(parts.join(' '), {
      action: outcome.snapshotId
        ? {
            label: 'Desfazer',
            onClick: async () => {
              await undoImport(outcome.snapshotId!, outcome.historyId);
              await refreshAllData();
              showToast('Importação desfeita. A lista voltou ao que era antes.', 'info');
            }
          }
        : undefined
    });
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
  const ToastIcon = toast?.type === 'warn' ? AlertTriangle : toast?.type === 'info' ? Info : CheckCircle2;

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} min-h-screen text-slate-100 flex flex-col font-sans`}>
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.type}`} role="status" aria-live="polite">
          <ToastIcon aria-hidden="true" />
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={async () => {
                const action = toast.action!;
                setToast(null);
                try {
                  await action.onClick();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Não foi possível desfazer.', 'info');
                }
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.action && <i className="toast__timer" style={{ animationDuration: `${toast.durationMs}ms` }} aria-hidden="true" />}
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
        onChangePassword={() => setIsAccountOpen(true)}
        pendingApprovals={isAdmin ? notifications.pendingApprovals : 0}
      />

      {/* Conteúdo Principal */}
      <main className="studio-main flex-1">
        {isAdmin && notifications.failedJobs.length > 0 && currentTab !== 'admin' && (
          <div className="banner" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>
              Uma rotina automática falhou ({notifications.failedJobs.map((j) => (j === 'backup' ? 'backup diário' : 'relatório mensal')).join(', ')}).
            </span>
            <button type="button" className="btn btn--sm" onClick={() => { setAdminTab('status'); setCurrentTab('admin'); }}>Ver status</button>
          </div>
        )}
        {isAdmin && notifications.pendingApprovals > 0 && currentTab === 'dashboard' && (
          <div className="banner" role="status">
            <Info aria-hidden="true" />
            <span>
              {notifications.pendingApprovals === 1 ? '1 importação aguarda' : `${notifications.pendingApprovals} importações aguardam`} sua aprovação.
            </span>
            <button type="button" className="btn btn--sm" onClick={openApprovals}>Revisar</button>
          </div>
        )}

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
            onRefresh={refreshAllData}
            showToast={showToast}
            onOpenReview={() => setCurrentTab('review')}
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
            onBack={() => setCurrentTab(previousTab === 'import' ? 'dashboard' : previousTab)}
            isAdmin={isAdmin}
            settings={settings}
          />
        )}

        {currentTab === 'client-list' && (
          <ClientListView
            clients={clients}
            selectedClientId={selectedClientId}
            onSelectClient={setSelectedClientId}
            onRefreshStats={refreshAllData}
            onAddIndicators={handleNavigateToImport}
            showToast={showToast}
            isAdmin={isAdmin}
          />
        )}

        {currentTab === 'review' && (
          <ReviewView clients={clients} showToast={showToast} onRefresh={refreshAllData} onOpenList={handleNavigateToList} />
        )}

        {currentTab === 'history' && (
          <HistoryView clients={clients} onStartImport={() => setCurrentTab('import')} />
        )}

        {currentTab === 'clients' && (
          <ClientManagerView
            clients={clients}
            activeCounts={activeCounts}
            onRefreshClients={refreshAllData}
            isAdmin={isAdmin}
          />
        )}

        {currentTab === 'reports' && <ReportsView clients={clients} />}

        {currentTab === 'admin' && isAdmin && (
          <AdminView
            currentUser={currentUser}
            tab={adminTab}
            onTabChange={setAdminTab}
            onChanged={refreshAllData}
            showToast={showToast}
          />
        )}

        {currentTab === 'backup' && (
          <BackupView
            settings={settings}
            onRefreshAll={refreshAllData}
            onUpdateSettings={setSettings}
            onOpenTests={() => setIsTestsOpen(true)}
            isAdmin={isAdmin}
          />
        )}
        </div>
      </main>

      <AccountModal
        open={isAccountOpen}
        currentUser={currentUser}
        onClose={() => setIsAccountOpen(false)}
        onPasswordChanged={(user) => {
          setIsAccountOpen(false);
          onUserChange(user);
          showToast('Senha alterada. As outras sessões foram encerradas.');
        }}
      />

      <ShortcutsModal open={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} isAdmin={isAdmin} />

      {/* Consulta de um ou vários indicadores em todas as listas */}
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
