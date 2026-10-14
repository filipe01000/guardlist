import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Compass,
  Copy,
  Download,
  FileSignature,
  FileText,
  Globe,
  HardDrive,
  History,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Moon,
  Radio,
  RefreshCw,
  ScanSearch,
  Search,
  ShieldCheck,
  ShieldOff,
  ShieldPlus,
  Sparkles,
  Sun,
  Upload,
  Users
} from 'lucide-react';
import type { Client } from '../types';
import type { ShowToast } from '../App';
import type { AppTab } from './Navbar';
import { MenuPanel, useMenuDismiss, type ActionMenuEntry, type DismissReason, type MenuAnchor } from './ActionMenu';
import { detectEntity, externalLookupEntries, TYPE_LABEL, type ContextEntity, type IndicatorAction } from './contextActions';

export const PAGES: Array<{ tab: AppTab; label: string; icon: typeof Search; key?: string; adminOnly?: boolean }> = [
  { tab: 'dashboard', label: 'Painel geral', icon: LayoutDashboard, key: 'D' },
  { tab: 'intelligence', label: 'Inteligência de IPs', icon: Radio, key: 'T' },
  { tab: 'import', label: 'Importação semanal', icon: Upload, key: 'I' },
  { tab: 'client-list', label: 'Listas dos clientes', icon: ListChecks, key: 'L' },
  { tab: 'review', label: 'Revisão de bloqueios', icon: ClipboardCheck, key: 'R' },
  { tab: 'history', label: 'Histórico semanal', icon: History, key: 'H' },
  { tab: 'reports', label: 'Relatórios', icon: BarChart3, key: 'P' },
  { tab: 'clients', label: 'Gerenciar clientes', icon: Users },
  { tab: 'admin', label: 'Administração', icon: ShieldCheck, key: 'A', adminOnly: true },
  { tab: 'backup', label: 'Backup e ajustes', icon: HardDrive }
];

interface Props {
  clients: Client[];
  isAdmin: boolean;
  currentTab: AppTab;
  previousTab: AppTab;
  theme: 'dark' | 'light';
  showToast: ShowToast;
  onNavigate: (tab: AppTab) => void;
  onOpenList: (clientId: string) => void;
  onImport: (clientId: string) => void;
  onExportTxt: (client: Client) => void;
  onExportNano: (client: Client) => void;
  onRefresh: () => void;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onOpenShortcuts: () => void;
  onQuickSearch: (seed?: string) => void;
  onIndicatorAction: (action: IndicatorAction, indicator: string) => void;
  aiEnabled: boolean;
  onOpenAssistant: () => void;
  onOpenCaseBuilder: (indicators?: string[]) => void;
}

/**
 * Menu de contexto do aplicativo inteiro (botão direito), no estilo de consoles SIEM:
 * reconhece o que está sob o cursor — IP, CIDR, domínio ou cliente — e oferece as ações
 * daquilo; em área vazia, oferece as ações da página. Linhas de tabela com menu próprio
 * (⋯) continuam usando o delas.
 */
export function ContextMenuHost(props: Props) {
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; label: string; items: ActionMenuEntry[] } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) returnFocus.current?.focus?.({ preventScroll: true });
  }, []);
  useMenuDismiss(menu !== null, close);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented || e.shiftKey) return;
      // Ícones (SVG) contam como o elemento HTML que os contém.
      let target = e.target as Element | null;
      while (target && !(target instanceof HTMLElement)) target = target.parentElement;
      if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable="true"], .am__menu')) return;
      const p = latest.current;
      const inModal = Boolean(target.closest('[aria-modal="true"]'));
      const entity = detectEntity(e, target, p.clients);
      if (entity === 'native') return;
      const built = entity ? entityMenu(entity, inModal) : inModal ? null : pageMenu(e);
      if (!built) return;
      e.preventDefault();
      // Tecla de menu / Shift+F10: abre junto do elemento com foco.
      let { clientX: x, clientY: y } = e;
      if (x === 0 && y === 0) {
        const r = target.getBoundingClientRect();
        x = r.left + 12;
        y = r.bottom;
      }
      returnFocus.current = document.activeElement as HTMLElement | null;
      setMenu({ anchor: { kind: 'point', x, y }, ...built });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => latest.current.showToast(`${what} copiado.`, 'info'),
      () => latest.current.showToast('Não foi possível copiar.', 'warn')
    );
  };

  const entityMenu = (entity: ContextEntity, inModal: boolean): { label: string; items: ActionMenuEntry[] } => {
    const p = latest.current;
    if (entity.kind === 'client') {
      const c = entity.client;
      return {
        label: `Ações do cliente ${c.name}`,
        items: [
          { type: 'heading', label: c.name, detail: 'Cliente' },
          { label: 'Abrir lista do cliente', icon: ListChecks, onSelect: () => p.onOpenList(c.id) },
          { label: 'Importar lista da semana', icon: Upload, onSelect: () => p.onImport(c.id) },
          { type: 'divider' },
          { label: 'Baixar .txt', icon: Download, onSelect: () => p.onExportTxt(c) },
          { label: 'Baixar .txt NANO', icon: FileText, onSelect: () => p.onExportNano(c) },
          { type: 'divider' },
          { label: 'Copiar nome', icon: Copy, onSelect: () => copy(c.name, 'Nome do cliente') }
        ]
      };
    }
    const { value, type } = entity;
    const lookups: ActionMenuEntry = { label: 'Consultar fora', icon: Globe, children: externalLookupEntries(value, type) };
    const items: ActionMenuEntry[] = [{ type: 'heading', label: value, detail: TYPE_LABEL[type] }];
    if (!inModal) {
      if (p.aiEnabled) items.push({ label: 'Perguntar à IA', icon: Sparkles, title: 'Resumo, reputação e recomendação', onSelect: () => p.onIndicatorAction('ai', value) });
      items.push(
        { label: 'Abrir dossiê do indicador', icon: ScanSearch, onSelect: () => p.onIndicatorAction('dossier', value) },
        { label: 'Onde está bloqueado?', icon: Search, hint: 'Ctrl K', onSelect: () => p.onQuickSearch(value) },
        { type: 'divider' },
        { label: 'Bloquear em clientes…', icon: ShieldPlus, onSelect: () => p.onIndicatorAction('block', value) },
        { label: 'Gerar caso para o cliente…', icon: FileSignature, onSelect: () => p.onOpenCaseBuilder([value]) }
      );
      if (p.isAdmin) {
        items.push({ label: 'Adicionar exceção…', icon: ShieldOff, title: 'Nunca bloquear nos clientes escolhidos', onSelect: () => p.onIndicatorAction('exception', value) });
      }
      items.push({ type: 'divider' });
    }
    items.push(lookups, { label: 'Copiar', icon: Copy, onSelect: () => copy(value, 'Indicador') });
    return { label: `Ações de ${value}`, items };
  };

  const pageMenu = (e: MouseEvent): { label: string; items: ActionMenuEntry[] } => {
    const p = latest.current;
    const page = PAGES.find((x) => x.tab === p.currentTab);
    const items: ActionMenuEntry[] = [
      { type: 'heading', label: page?.label ?? 'GuardList', detail: 'Página' },
      { label: 'Consultar IPs…', icon: Search, hint: 'Ctrl K', onSelect: () => p.onQuickSearch() },
      ...(p.aiEnabled ? [{ label: 'Assistente IA', icon: Sparkles, hint: 'Ctrl J', onSelect: () => p.onOpenAssistant() }] : []),
      { label: 'Gerar caso para o cliente…', icon: FileSignature, onSelect: () => p.onOpenCaseBuilder() },
      { label: 'Atualizar dados', icon: RefreshCw, onSelect: () => p.onRefresh() }
    ];
    if (p.previousTab !== p.currentTab) {
      const prev = PAGES.find((x) => x.tab === p.previousTab);
      if (prev) items.push({ label: `Voltar para ${prev.label}`, icon: ArrowLeft, onSelect: () => p.onNavigate(prev.tab) });
    }
    items.push(
      {
        label: 'Ir para',
        icon: Compass,
        children: PAGES.filter((x) => !x.adminOnly || p.isAdmin).map((x) => ({
          label: x.label,
          icon: x.icon,
          hint: x.key,
          disabled: x.tab === p.currentTab,
          onSelect: () => p.onNavigate(x.tab)
        }))
      },
      { type: 'divider' },
      {
        label: p.theme === 'dark' ? 'Modo claro' : 'Modo escuro',
        icon: p.theme === 'dark' ? Sun : Moon,
        onSelect: () => p.onToggleTheme({ x: e.clientX, y: e.clientY })
      },
      { label: 'Atalhos do teclado', icon: Keyboard, hint: '?', onSelect: () => p.onOpenShortcuts() }
    );
    return { label: `Ações da página ${page?.label ?? ''}`.trim(), items };
  };

  if (!menu) return null;
  return (
    <MenuPanel
      items={menu.items}
      label={menu.label}
      anchor={menu.anchor}
      onDismiss={(reason: DismissReason) => close(reason === 'escape')}
    />
  );
}
