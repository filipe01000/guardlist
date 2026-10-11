import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  HardDrive,
  HardDriveDownload,
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
  KeyRound,
  Users as UsersIcon,
  UploadCloud,
  X
} from 'lucide-react';
import { SessionUser } from '../types';
import './Sidebar.css';

export type AppTab = 'dashboard' | 'import' | 'client-list' | 'intelligence' | 'history' | 'clients' | 'users' | 'backup';

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
}

const navItems: Array<{ id: AppTab; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Painel geral', icon: LayoutDashboard },
  { id: 'intelligence', label: 'Inteligência de IPs', icon: Radio },
  { id: 'import', label: 'Importação semanal', icon: UploadCloud },
  { id: 'client-list', label: 'Listas dos clientes', icon: ListFilter },
  { id: 'history', label: 'Histórico semanal', icon: History },
  { id: 'clients', label: 'Gerenciar clientes', icon: Building2 },
  { id: 'backup', label: 'Backup e ajustes', icon: HardDrive }
];

const usersItem = { id: 'users' as AppTab, label: 'Usuários', icon: UsersIcon };

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
  onChangePassword
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  // Usuários aparece só para administradores, antes de Backup e ajustes.
  const visibleItems = currentUser?.role === 'admin' ? [...navItems.slice(0, -1), usersItem, navItems[navItems.length - 1]] : navItems;
  const activeRow = Math.max(0, visibleItems.findIndex((item) => item.id === currentTab));
  const displayName = currentUser?.displayName || 'Uso local';
  const roleLabel = currentUser ? (currentUser.role === 'admin' ? 'Administrador' : 'Analista') : 'Sem login ativo';
  const themeTarget = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  const backupLabel = isBackupOutdated
    ? 'Backup pendente'
    : `Backup há ${daysSinceBackup} ${daysSinceBackup === 1 ? 'dia' : 'dias'}`;

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
    if (!collapsed) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setTip({ text: target.dataset.tip || '', top: rect.top + rect.height / 2, left: rect.right + 14 });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <div className="gl-mobilebar">
        <button type="button" className="gl-icon-btn" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
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
            data-tip={`${displayName} · alterar senha`}
            aria-label={`${displayName}, ${roleLabel}. Alterar senha`}
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

          <button type="button" className="gl-row gl-search" onClick={onOpenQuickSearch} data-tip="Consultar IP (Ctrl/⌘ K)" aria-label="Consultar IP">
            <Search aria-hidden="true" />
            <span className="label">Consultar IP</span>
            <kbd className="label">Ctrl K</kbd>
          </button>

          <ul className="gl-nav" style={{ '--active-row': activeRow } as React.CSSProperties}>
            <li className="gl-indicator" aria-hidden="true" />
            {visibleItems.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  className={`gl-row ${currentTab === id ? 'active' : ''}`}
                  onClick={() => go(id)}
                  aria-current={currentTab === id ? 'page' : undefined}
                  data-tip={label}
                  aria-label={label}
                >
                  <Icon aria-hidden="true" />
                  <span className="label">{label}</span>
                </button>
              </li>
            ))}
          </ul>

          <hr className="gl-divider" />

          <button
            type="button"
            className={`gl-row gl-backup ${isBackupOutdated ? 'is-warning' : ''}`}
            onClick={() => go('backup')}
            data-tip={backupLabel}
            aria-label={backupLabel}
          >
            {isBackupOutdated ? <AlertTriangle aria-hidden="true" /> : <HardDriveDownload aria-hidden="true" />}
            <span className="label">{backupLabel}</span>
          </button>

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
