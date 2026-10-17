import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Navbar, type AppTab } from './components/Navbar';
import { PageBoundary } from './components/PageBoundary';
import { AccountModal } from './components/AccountModal';
import { DashboardView } from './components/DashboardView';
import { QuickSearchModal } from './components/QuickSearchView';
import { TestRunnerModal } from './components/TestRunnerModal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { ContextMenuHost } from './components/ContextMenuHost';
import { IndicatorActionModal, type IndicatorActionMode } from './components/IndicatorActionModal';
import { IpDossierModal } from './components/IpDossierModal';
import { INDICATOR_ACTION_EVENT, OPEN_CASE_EVENT, OPEN_IMPORT_REPORT_EVENT, aiAvailability, type IndicatorAction } from './components/contextActions';
import { CaseBuilderModal } from './components/CaseBuilderModal';
import { TopBar } from './components/TopBar';
import { ImportReportModal } from './components/ImportReportModal';
import { AiAssistant, type AiRequest } from './components/AiAssistant';
import { Client, AppSettings, ImportOutcome, SessionUser, DashboardStats, BlocklistEntry } from './types';
import {
  getAllClients,
  getDashboardStats,
  getAppSettings,
  getClientEntries,
  getIndicatorEntries,
  getAiStatus,
  getNotifications,
  importBatch,
  undoImport,
  type ImportBatchPayload
} from './db/store';
import { generateFirewallTxt, generateNanoFormattedTxt, triggerDownload } from './utils/exporter';
import { getDaysSince } from './utils/validator';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

const AdminView = lazy(() => import('./components/AdminView').then(m => ({ default: m.AdminView })));
const ReportsView = lazy(() => import('./components/ReportsView').then(m => ({ default: m.ReportsView })));
const WeeklyImportView = lazy(() => import('./components/WeeklyImportView').then(m => ({ default: m.WeeklyImportView })));
const ClientListView = lazy(() => import('./components/ClientListView').then(m => ({ default: m.ClientListView })));
const IntelligenceView = lazy(() => import('./components/IntelligenceView').then(m => ({ default: m.IntelligenceView })));
const HistoryView = lazy(() => import('./components/HistoryView').then(m => ({ default: m.HistoryView })));
const ClientManagerView = lazy(() => import('./components/ClientManagerView').then(m => ({ default: m.ClientManagerView })));
const BackupView = lazy(() => import('./components/BackupView').then(m => ({ default: m.BackupView })));
const ReviewView = lazy(() => import('./components/ReviewView').then(m => ({ default: m.ReviewView })));

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
    try {
      const savedTheme = window.localStorage.getItem('guardlist-theme');
      if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
    } catch { /* Preferência opcional. */ }
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
  const [recurring, setRecurring] = useState<DashboardStats['recurring']>([]);
  const [notifications, setNotifications] = useState<{ pendingApprovals: number; failedJobs: string[] }>({ pendingApprovals: 0, failedJobs: [] });
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [dataLoadError, setDataLoadError] = useState(false);
  const refreshVersion = useRef(0);

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
  const [quickSearchSeed, setQuickSearchSeed] = useState('');
  // Ações sobre um indicador pedidas pelo menu de contexto (de qualquer tela).
  const [dossier, setDossier] = useState<{ indicator: string; entries: BlocklistEntry[] } | null>(null);
  const [indicatorAction, setIndicatorAction] = useState<{ indicator: string; mode: IndicatorActionMode } | null>(null);
  // Assistente de IA: só aparece se o servidor tiver um servidor de IA configurado.
  const [ai, setAi] = useState<{ configured: boolean; model: string | null }>({ configured: false, model: null });
  const [isAiOpen, setIsAiOpen] = useState(false);
  // Relatório detalhado de uma importação (aberto do histórico, dos relatórios ou depois de gravar).
  const [importReportId, setImportReportId] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setImportReportId((e as CustomEvent<{ historyId: string }>).detail.historyId);
    window.addEventListener(OPEN_IMPORT_REPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IMPORT_REPORT_EVENT, onOpen);
  }, []);

  // Gerador do texto do caso enviado ao cliente.
  const [caseBuilder, setCaseBuilder] = useState<{ text: string; clientId?: string } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string; clientId?: string }>).detail;
      setCaseBuilder({ text: detail?.text ?? '', clientId: detail?.clientId });
    };
    window.addEventListener(OPEN_CASE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CASE_EVENT, onOpen);
  }, []);
  const [aiRequest, setAiRequest] = useState<AiRequest | null>(null);
  const aiEnabledRef = useRef(false);
  useEffect(() => {
    getAiStatus()
      .then((status) => {
        setAi(status);
        aiEnabledRef.current = status.configured;
        aiAvailability.enabled = status.configured;
      })
      .catch(() => undefined);
  }, []);
  const askAi = useCallback((request: { kind: 'question'; text: string } | { kind: 'indicator'; indicator: string }) => {
    setIsAiOpen(true);
    setAiRequest({ ...request, id: Date.now() } as AiRequest);
  }, []);
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
  useEffect(() => () => { window.clearTimeout(toastTimer.current); }, []);

  // Carrega a base compartilhada da equipe.
  const refreshAllData = useCallback(async () => {
    const version = ++refreshVersion.current;
    setIsRefreshing(true);
    try {
      const [loadedClients, stats, loadedSettings, notes] = await Promise.all([
        getAllClients(),
        getDashboardStats(),
        getAppSettings(),
        getNotifications().catch(() => null)
      ]);
      if (version !== refreshVersion.current) return;

      setClients(loadedClients);
      setActiveCounts(stats.activeCounts);
      setIpCounts(stats.ipCounts);
      setCidrCounts(stats.cidrCounts);
      setTotalActiveAcrossAll(stats.totalActiveAcrossAll);
      setTotalIpsAcrossAll(stats.totalIpsAcrossAll);
      setTotalCidrsAcrossAll(stats.totalCidrsAcrossAll);
      setTotalCorrelatedIps(stats.totalCorrelatedIps);
      setAddedThisWeekCount(stats.addedThisWeekCount);
      setRecurring(stats.recurring);
      setSettings(loadedSettings);
      if (notes) setNotifications(notes);

      setSelectedClientId((current) => loadedClients.some(c => c.id === current)
        ? current : loadedClients.find(c => !c.isArchived)?.id || '');
      setHasLoadedData(true);
      setDataLoadError(false);
    } catch (err) {
      if (version !== refreshVersion.current) return;
      setDataLoadError(true);
      console.error('Erro ao carregar os dados da equipe:', err);
    } finally {
      if (version === refreshVersion.current) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshAllData();
    return () => { refreshVersion.current += 1; };
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
    try { window.localStorage.setItem('guardlist-theme', theme); } catch { /* Preferência opcional. */ }
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
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j' && aiEnabledRef.current) {
        event.preventDefault();
        setIsAiOpen((v) => !v);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickSearchSeed('');
        setIsQuickSearchOpen(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
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

  const openQuickSearch = useCallback((seed?: string) => {
    setQuickSearchSeed(seed ?? '');
    setIsQuickSearchOpen(true);
  }, []);

  const handleIndicatorAction = useCallback(async (action: IndicatorAction, indicator: string) => {
    if (action === 'where') {
      openQuickSearch(indicator);
    } else if (action === 'ai') {
      if (aiEnabledRef.current) askAi({ kind: 'indicator', indicator });
    } else if (action === 'dossier') {
      const entries = await getIndicatorEntries(indicator).catch(() => [] as BlocklistEntry[]);
      setDossier({ indicator, entries });
    } else {
      setIndicatorAction({ indicator, mode: action });
    }
  }, [openQuickSearch, askAi]);

  // Pedidos vindos dos menus das linhas (ex.: "Bloquear em outros clientes").
  useEffect(() => {
    const onAction = (e: Event) => {
      const { action, indicator } = (e as CustomEvent<{ action: IndicatorAction; indicator: string }>).detail;
      void handleIndicatorAction(action, indicator);
    };
    window.addEventListener(INDICATOR_ACTION_EVENT, onAction);
    return () => window.removeEventListener(INDICATOR_ACTION_EVENT, onAction);
  }, [handleIndicatorAction]);

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
      showToast('Não foi possível exportar a lista. Verifique a conexão e tente novamente.', 'warn');
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
      showToast('Não foi possível exportar a lista NANO. Verifique a conexão e tente novamente.', 'warn');
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
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
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
                window.clearTimeout(toastTimer.current);
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
      <main id="main-content" tabIndex={-1} className="studio-main flex-1">
        <TopBar
          onSearch={openQuickSearch}
          onOpenCaseBuilder={() => setCaseBuilder({ text: '' })}
          onOpenAssistant={ai.configured ? () => setIsAiOpen((v) => !v) : undefined}
          isAssistantOpen={isAiOpen}
        />
        {dataLoadError && (
          <div className="banner" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{hasLoadedData
              ? 'Não foi possível atualizar os dados. Os valores exibidos são da última atualização.'
              : 'Não foi possível carregar os dados da equipe. Verifique a conexão e tente novamente.'}</span>
            <button type="button" className="btn btn--sm" disabled={isRefreshing} onClick={() => void refreshAllData()}>
              {isRefreshing ? 'Tentando…' : 'Tentar novamente'}
            </button>
          </div>
        )}
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

        {!hasLoadedData && !dataLoadError && (
          <div className="app-loading" role="status"><Loader2 className="gl-spin" aria-hidden="true" />Carregando dados da equipe…</div>
        )}
        {hasLoadedData && <PageBoundary key={currentTab}><Suspense fallback={<div className="app-loading" role="status"><Loader2 className="gl-spin" aria-hidden="true" />Abrindo página…</div>}>
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
            recurring={recurring}
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
            onManageClients={() => setCurrentTab('clients')}
          />
        )}

        {currentTab === 'intelligence' && (
          <IntelligenceView
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
        </Suspense></PageBoundary>}
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
        initialQuery={quickSearchSeed}
        onClose={() => { setIsQuickSearchOpen(false); setQuickSearchSeed(''); }}
        onNavigateToClientList={handleNavigateToList}
      />

      {/* Menu do botão direito em todo o aplicativo */}
      <ContextMenuHost
        clients={clients}
        isAdmin={isAdmin}
        currentTab={currentTab}
        previousTab={previousTab}
        theme={theme}
        showToast={showToast}
        onNavigate={setCurrentTab}
        onOpenList={handleNavigateToList}
        onImport={handleNavigateToImport}
        onExportTxt={handleQuickExportTxt}
        onExportNano={handleQuickExportNanoTxt}
        onRefresh={() => { void refreshAllData().then(() => showToast('Dados atualizados.', 'info')); }}
        onToggleTheme={handleToggleTheme}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onQuickSearch={openQuickSearch}
        onIndicatorAction={(action, indicator) => { void handleIndicatorAction(action, indicator); }}
        aiEnabled={ai.configured}
        onOpenAssistant={() => setIsAiOpen(true)}
        onOpenCaseBuilder={(indicators) => setCaseBuilder({ text: (indicators ?? []).join('\n') })}
      />

      <ImportReportModal historyId={importReportId} onClose={() => setImportReportId(null)} />

      <CaseBuilderModal
        open={caseBuilder !== null}
        initialText={caseBuilder?.text}
        initialClientId={caseBuilder?.clientId ?? (currentTab === 'client-list' ? selectedClientId : undefined)}
        clients={clients}
        onEntriesChanged={refreshAllData}
        onClose={() => setCaseBuilder(null)}
        currentUser={currentUser}
        aiEnabled={ai.configured}
        showToast={showToast}
      />

      {ai.configured && <AiAssistant open={isAiOpen} onClose={() => setIsAiOpen(false)} model={ai.model} request={aiRequest} />}

      <IpDossierModal
        indicator={dossier?.indicator ?? null}
        allEntries={dossier?.entries ?? []}
        clients={clients}
        onClose={() => setDossier(null)}
      />

      <IndicatorActionModal
        request={indicatorAction}
        clients={clients}
        isAdmin={isAdmin}
        onClose={() => setIndicatorAction(null)}
        onDone={refreshAllData}
        showToast={showToast}
      />

      {/* Modal de Testes Unitários da Validação (Acessível via Modo Dev em Backup) */}
      <TestRunnerModal
        isOpen={isTestsOpen}
        onClose={() => setIsTestsOpen(false)}
      />
    </div>
  );
}
