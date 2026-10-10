import React from 'react';
import {
  AlertTriangle,
  Building2,
  HardDrive,
  HardDriveDownload,
  History,
  LayoutDashboard,
  LogOut,
  ListFilter,
  Radio,
  Search,
  Moon,
  Sun,
  UploadCloud
} from 'lucide-react';

type AppTab = 'dashboard' | 'import' | 'client-list' | 'intelligence' | 'history' | 'clients' | 'backup';

interface NavbarProps {
  currentTab: AppTab;
  setCurrentTab: (tab: AppTab) => void;
  onOpenQuickSearch: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isBackupOutdated: boolean;
  daysSinceBackup: number | null;
  currentUser?: string | null;
  onLogout?: () => void;
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

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  onOpenQuickSearch,
  theme,
  onToggleTheme,
  isBackupOutdated,
  daysSinceBackup,
  currentUser,
  onLogout
}) => {
  return (
    <header className="studio-header text-white">
      <div className="studio-header__inner">
        <button
          type="button"
          onClick={() => setCurrentTab('dashboard')}
          className="studio-brand"
          aria-label="Ir para o painel geral"
        >
          <span className="studio-brand__mark">
            <img src="/brand/guardlist-mark.png" alt="" aria-hidden="true" />
          </span>
          <span className="studio-brand__copy">
            <strong>GuardList</strong>
          </span>
        </button>

        <div className="studio-header__tools">
          <button type="button" onClick={onOpenQuickSearch} className="studio-search" aria-label="Consultar IP">
            <Search aria-hidden="true" />
            <span>Consultar IP</span>
            <kbd>Ctrl/⌘ K</kbd>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="studio-theme-toggle"
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </div>

        {isBackupOutdated && (
          <button type="button" onClick={() => setCurrentTab('backup')} className="studio-backup-alert">
            <AlertTriangle aria-hidden="true" />
            <span>
              <strong>Backup pendente</strong>
              <small>{daysSinceBackup === null ? 'Nenhuma cópia exportada' : `Última cópia há ${daysSinceBackup} dias`}</small>
            </span>
          </button>
        )}

        <nav className="studio-nav" aria-label="Navegação principal">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCurrentTab(id)}
              className={`studio-nav__item ${currentTab === id ? 'is-active' : ''}`}
              aria-current={currentTab === id ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="studio-sidebar-meta">
          <button type="button" onClick={() => setCurrentTab('backup')} className="studio-backup-state">
            <HardDriveDownload aria-hidden="true" />
            <span>
              <small>Último backup</small>
              <strong>{daysSinceBackup === null ? 'Pendente' : `há ${daysSinceBackup} dias`}</strong>
            </span>
          </button>
          {onLogout && (
            <button type="button" onClick={onLogout} className="studio-download" title={currentUser ? `Conectado como ${currentUser}` : undefined}>
              <LogOut aria-hidden="true" />
              <span>Sair{currentUser ? ` (${currentUser})` : ''}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
