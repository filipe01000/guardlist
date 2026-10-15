import React, { useEffect, useId, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Radar,
  Settings2,
  ShieldBan,
  HardDrive,
  History,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  Radio,
  Search,
  Sun,
  FileSpreadsheet,
  KeyRound,
  ClipboardCheck,
  ShieldCheck,
  UploadCloud,
  X
} from 'lucide-react';
import { SessionUser } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './Sidebar.css';

export type AppTab = 'dashboard' | 'import' | 'client-list' | 'review' | 'intelligence' | 'history' | 'reports' | 'clients' | 'admin' | 'backup';

interface NavbarProps {
  currentTab: AppTab;
  setCurrentTab: (tab: AppTab) => void;
  onOpenQuickSearch: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  isBackupOutdated: boolean;
  daysSinceBackup: number | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentUser?: SessionUser | null;
  onLogout?: () => void;
  onChangePassword?: () => void;
  pendingApprovals?: number;
}

type NavItem = { id: AppTab; label: string; icon: React.ElementType; adminOnly?: boolean };
type NavGroup = { id: string; label: string; icon: React.ElementType; items: NavItem[] };

// Painel geral sozinho no topo; o resto em grupos de telas relacionadas.
const homeItem: NavItem = { id: 'dashboard', label: 'Painel geral', icon: LayoutDashboard };
const navGroups: NavGroup[] = [
  {
    id: 'blocks',
    label: 'Bloqueios',
    icon: ShieldBan,
    items: [
      { id: 'client-list', label: 'Listas dos clientes', icon: ListFilter },
      { id: 'import', label: 'Importação semanal', icon: UploadCloud },
      { id: 'review', label: 'Revisão de bloqueios', icon: ClipboardCheck },
      { id: 'history', label: 'Histórico semanal', icon: History }
    ]
  },
  {
    id: 'analysis',
    label: 'Análise',
    icon: Radar,
    items: [
      { id: 'intelligence', label: 'Inteligência de IPs', icon: Radio },
      { id: 'reports', label: 'Relatórios', icon: FileSpreadsheet }
    ]
  },
  {
    id: 'manage',
    label: 'Gestão',
    icon: Settings2,
    items: [
      { id: 'clients', label: 'Gerenciar clientes', icon: Building2 },
      { id: 'admin', label: 'Administração', icon: ShieldCheck, adminOnly: true },
      { id: 'backup', label: 'Backup e ajustes', icon: HardDrive }
    ]
  }
];

const GROUPS_KEY = 'guardlist-nav-groups';
const groupOf = (tab: AppTab) => navGroups.find((g) => g.items.some((i) => i.id === tab))?.id;

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  onOpenQuickSearch,
  theme,
  onToggleTheme,
  isBackupOutdated,
  daysSinceBackup,
  collapsed,
  onToggleCollapsed,
  currentUser,
  onLogout,
  onChangePassword,
  pendingApprovals = 0
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const menuId = useId();
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const isAdmin = currentUser?.role === 'admin';
  // Grupos abertos: lembra a escolha; o grupo da tela atual sempre abre.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(GROUPS_KEY) || 'null') as string[] | null;
      if (Array.isArray(saved)) return new Set(saved);
    } catch {
      // Preferência opcional.
    }
    return new Set(['blocks']);
  });
  useEffect(() => {
    const group = groupOf(currentTab);
    if (group) setOpenGroups((prev) => (prev.has(group) ? prev : new Set(prev).add(group)));
  }, [currentTab]);
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPS_KEY, JSON.stringify([...openGroups]));
    } catch {
      // Preferência opcional.
    }
  }, [openGroups]);
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const displayName = currentUser?.displayName || 'Uso local';
  const roleLabel = currentUser ? (currentUser.role === 'admin' ? 'Administrador' : 'Analista') : 'Sem login ativo';
  const themeTarget = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  const backupLabel = isBackupOutdated
    ? 'Backup pendente'
    : `Backup há ${daysSinceBackup} ${daysSinceBackup === 1 ? 'dia' : 'dias'}`;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.querySelectorAll<HTMLElement>('#main-content, .studio-footer, .gl-mobilebar, .skip-link'));
    const previousInert = background.map(element => element.inert);
    document.body.style.overflow = 'hidden';
    background.forEach(element => { element.inert = true; });
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => { element.inert = previousInert[index]; });
    };
  }, [isMobile, mobileOpen]);
  const menuRef = useDialogFocus<HTMLElement>(isMobile && mobileOpen);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  useEffect(() => {
    if (!collapsed) setTip(null);
  }, [collapsed]);

  const go = (tab: AppTab) => {
    setCurrentTab(tab);
    setMobileOpen(false);
  };

  // Dicas flutuantes no modo recolhido; ficam fora da sidebar para não serem cortadas.
  const showTip = (event: React.SyntheticEvent<HTMLElement>) => {
    if (!collapsed || isMobile) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setTip({ text: target.dataset.tip || '', top: rect.top + rect.height / 2, left: rect.right + 14 });
  };
  const hideTip = () => setTip(null);

  const renderRow = ({ id, label, icon: Icon }: NavItem, nested = false) => (
    <button
      type="button"
      className={`gl-row ${nested ? 'gl-sub-row' : ''} ${currentTab === id ? 'active' : ''}`}
      onClick={() => go(id)}
      aria-current={currentTab === id ? 'page' : undefined}
      data-tip={id === 'backup' ? `${label} · ${backupLabel}` : label}
      aria-label={id === 'backup' ? `${label}. ${backupLabel}` : label}
    >
      <Icon aria-hidden="true" />
      <span className="label">{label}</span>
      {id === 'backup' && isBackupOutdated && <span className="nav-status-dot" aria-hidden="true" />}
      {id === 'admin' && pendingApprovals > 0 && (
        <span className="nav-badge" aria-label={`${pendingApprovals} aprovações pendentes`}>{pendingApprovals}</span>
      )}
    </button>
  );

  return (
    <>
      <div className="gl-mobilebar">
        <button type="button" className="gl-icon-btn" onClick={() => setMobileOpen(true)} aria-label="Abrir menu" aria-expanded={mobileOpen} aria-controls={menuId}>
          <Menu aria-hidden="true" />
        </button>
        <span className="gl-mobilebar__brand">
          <img src="/brand/guardlist-mark.png" alt="" />
          GuardList
        </span>
        <button type="button" className="gl-icon-btn" onClick={onOpenQuickSearch} aria-label="Consultar IP">
          <Search aria-hidden="true" />
        </button>
      </div>

      <div
        className={`gl-sidebar-backdrop ${mobileOpen ? 'is-open' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        id={menuId}
        ref={menuRef}
        tabIndex={-1}
        role={isMobile && mobileOpen ? 'dialog' : undefined}
        aria-modal={isMobile && mobileOpen ? true : undefined}
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
        inert={isMobile && !mobileOpen}
        className={`gl-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'is-open' : ''}`}
        aria-label="Menu principal"
        onMouseOver={showTip}
        onFocus={showTip}
        onMouseOut={hideTip}
        onBlur={hideTip}
      >
        <div className="gl-sidebar-inner">
          <div className="gl-brand">
            <span className="gl-brand-mark">
              <img src="/brand/guardlist-mark.png" alt="" />
            </span>
            <span className="gl-brand-name label">GuardList</span>
          </div>

          <button
            type="button"
            className="gl-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!collapsed}
          >
            <PanelLeft aria-hidden="true" />
          </button>
          <button type="button" className="gl-close-btn" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
            <X aria-hidden="true" />
          </button>

          <hr className="gl-divider" />

          <button
            type="button"
            className="gl-profile"
            data-tip={`${displayName} · minha conta`}
            aria-label={`${displayName}, ${roleLabel}. Minha conta`}
            onClick={() => { setMobileOpen(false); onChangePassword?.(); }}
            disabled={!onChangePassword}
          >
            <span className="gl-avatar" aria-hidden="true">{initials(displayName)}</span>
            <span className="gl-profile-text label">
              <span className="gl-profile-name">{displayName}</span>
              <span className="gl-profile-role">{roleLabel}</span>
            </span>
            <KeyRound className="gl-profile-key label" aria-hidden="true" />
          </button>

          <nav className="gl-nav" aria-label="Seções">
            {renderRow(homeItem)}
            {navGroups.map((group) => {
              const items = group.items.filter((i) => !i.adminOnly || isAdmin);
              const isOpen = openGroups.has(group.id);
              const hasActive = items.some((i) => i.id === currentTab);
              const approvals = items.some((i) => i.id === 'admin') ? pendingApprovals : 0;
              const backupWarn = items.some((i) => i.id === 'backup') && isBackupOutdated;
              const GroupIcon = group.icon;
              const listId = `${menuId}-${group.id}`;
              return (
                <div key={group.id} className={`gl-group ${isOpen ? 'is-open' : ''} ${hasActive ? 'has-active' : ''}`}>
                  <button
                    type="button"
                    className="gl-row gl-group-head"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                    aria-controls={listId}
                  >
                    <GroupIcon aria-hidden="true" />
                    <span className="label">{group.label}</span>
                    {!isOpen && approvals > 0 && <span className="nav-badge" aria-label={`${approvals} aprovações pendentes`}>{approvals}</span>}
                    {!isOpen && !approvals && backupWarn && <span className="nav-status-dot" aria-hidden="true" />}
                    <ChevronDown className="gl-chev label" aria-hidden="true" />
                  </button>
                  <div className="gl-sub-wrap">
                    <ul className="gl-sub" id={listId}>
                      {items.map((item) => <li key={item.id}>{renderRow(item, true)}</li>)}
                    </ul>
                  </div>
                </div>
              );
            })}
          </nav>

          <hr className="gl-divider" />

          {/* O rótulo mostra o tema de destino: no escuro oferece "Modo claro" e vice-versa. */}
          <button
            type="button"
            className="gl-row gl-theme-toggle"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onToggleTheme({ x: rect.left + 36, y: rect.top + rect.height / 2 });
            }}
            data-tip={themeTarget}
            aria-label={`Mudar para ${themeTarget.toLowerCase()}`}
          >
            <span className="gl-theme-icon" aria-hidden="true">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </span>
            <span className="label">{themeTarget}</span>
          </button>

          {onLogout && <hr className="gl-divider gl-divider--tight" />}

          {onLogout && (
            <button type="button" className="gl-row gl-logout" onClick={onLogout} data-tip="Sair" aria-label="Sair">
              <LogOut aria-hidden="true" />
              <span className="label">Sair</span>
            </button>
          )}
        </div>
      </aside>

      {tip && (
        <div className="gl-tooltip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </div>
      )}
    </>
  );
};
