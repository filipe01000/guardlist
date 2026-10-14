import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { CornerDownLeft, MoreHorizontal } from 'lucide-react';
import './ActionMenu.css';

export type ActionMenuEntry =
  | { type: 'divider' }
  | {
      type?: 'item';
      label: string;
      icon: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      title?: string;
    };

interface ActionMenuProps {
  items: ActionMenuEntry[];
  /** Nome acessível do botão, ex.: "Ações de 45.9.20.33". */
  label: string;
  /** Selo opcional no botão (ex.: número de comentários). */
  badge?: number;
}

// Teclas → comandos, como no menu de referência.
const COMMANDS: Record<string, string> = Object.freeze({
  ArrowDown: 'move-down',
  ArrowUp: 'move-up',
  Home: 'move-first',
  End: 'move-last',
  Enter: 'confirm',
  ' ': 'activate',
  Escape: 'dismiss',
  Tab: 'traverse-focus'
});

const MENU_WIDTH = 232;
const OPEN_AT = 'am:open-at';

/**
 * Para usar no onContextMenu de uma linha: abre o menu ⋯ daquela linha na posição do cursor.
 * Com texto selecionado ou Shift pressionado, deixa o menu normal do navegador.
 */
export function openActionMenuAt(e: React.MouseEvent) {
  if (e.shiftKey || window.getSelection()?.toString()) return;
  const trigger = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('.am__trigger');
  if (!trigger) return;
  e.preventDefault();
  trigger.dispatchEvent(new CustomEvent(OPEN_AT, { detail: { x: e.clientX, y: e.clientY } }));
}

/**
 * Menu de ações "⋯" com placa deslizante: a placa acompanha o item ativo (mouse ou teclado),
 * fica vermelha em itens perigosos e tem um brilho que segue o ponteiro.
 * Renderizado num portal, para não ser cortado por tabelas com rolagem.
 */
export default function ActionMenu({ items, label, badge }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  const activeIndex = useRef(-1);
  const menuId = useId();

  const rows = items.filter((e): e is Exclude<ActionMenuEntry, { type: 'divider' }> => e.type !== 'divider');

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    activeIndex.current = -1;
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const movePlate = (row: HTMLElement) => {
    const plate = plateRef.current;
    if (!plate) return;
    const s = plate.style;
    s.setProperty('--am-plate-y', `${row.offsetTop}px`);
    s.setProperty('--am-plate-h', `${row.offsetHeight}px`);
    plate.classList.toggle('is-danger', row.classList.contains('am__item--danger'));
    plate.classList.add('is-visible');
  };

  const setActive = (index: number, focus: boolean) => {
    const list = itemRefs.current;
    const row = list[index];
    if (!row) return;
    list.forEach((el) => el?.classList.remove('is-active'));
    activeIndex.current = index;
    row.classList.add('is-active');
    movePlate(row);
    if (focus) row.focus({ preventScroll: true });
  };

  const moveActive = (delta: number) => {
    const n = itemRefs.current.length;
    if (!n) return;
    let next = activeIndex.current;
    // Pula itens desativados.
    for (let i = 0; i < n; i++) {
      next = (next + delta + n) % n;
      if (!rows[next]?.disabled) break;
    }
    setActive(next, true);
  };

  const chooseItem = (index: number) => {
    const entry = rows[index];
    if (!entry || entry.disabled) return;
    closeMenu(true);
    entry.onSelect();
  };

  // Posiciona o menu junto ao botão (abre para cima se faltar espaço embaixo).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const height = menuRef.current?.offsetHeight ?? 200;
    if (point) {
      // Aberto pelo botão direito: nasce no cursor, sem sair da tela.
      const up = point.y + height + 8 > window.innerHeight && point.y - height > 8;
      const left = Math.min(Math.max(8, point.x), window.innerWidth - MENU_WIDTH - 8);
      setPos({ top: up ? point.y - height : point.y, left, up });
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    const up = r.bottom + height + 12 > window.innerHeight && r.top - height - 12 > 0;
    const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPos({ top: up ? r.top - height - 6 : r.bottom + 6, left, up });
  }, [open, point]);

  // Pedido de abertura vindo do botão direito na linha (openActionMenuAt).
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const onOpenAt = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      setPoint({ x, y });
      setOpen(true);
    };
    trigger.addEventListener(OPEN_AT, onOpenAt);
    return () => trigger.removeEventListener(OPEN_AT, onOpenAt);
  }, []);

  // Ao abrir pelo teclado ou mouse, o primeiro item habilitado recebe o foco.
  useEffect(() => {
    if (!open || !pos) return;
    const first = rows.findIndex((r) => !r.disabled);
    if (first >= 0) setActive(first, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos !== null]);

  // Fecha ao clicar fora, rolar a página ou redimensionar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) closeMenu(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu(false);
    };
    const onResize = () => closeMenu(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      setPoint(null);
    }
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = COMMANDS[e.key];
    if (!key) return;
    if (key === 'traverse-focus') {
      closeMenu(false);
      return;
    }
    const actions: Record<string, () => void> = {
      'move-down': () => moveActive(1),
      'move-up': () => moveActive(-1),
      'move-first': () => { activeIndex.current = -1; moveActive(1); },
      'move-last': () => { activeIndex.current = 0; moveActive(-1); },
      confirm: () => chooseItem(activeIndex.current),
      activate: () => chooseItem(activeIndex.current),
      dismiss: () => closeMenu(true)
    };
    e.preventDefault();
    e.stopPropagation(); // não deixa o Esc fechar a janela de trás nem disparar atalhos globais
    actions[key]();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const plate = plateRef.current;
    if (!plate) return;
    const { left } = plate.getBoundingClientRect();
    plate.style.setProperty('--am-glow-x', `${Math.round(e.clientX - left)}px`);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  itemRefs.current = [];
  let rowIndex = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`am__trigger${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title="Ações"
        onClick={(e) => {
          e.stopPropagation();
          setPoint(null);
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
      >
        <MoreHorizontal aria-hidden="true" />
        {badge ? <span className="am__badge">{badge}</span> : null}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className={`am__menu${pos ? ' is-placed' : ''}${pos?.up ? ' is-up' : ''}${point ? ' is-at-point' : ''}`}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
            onKeyDown={onKeyDown}
            onPointerMove={onPointerMove}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="am__sheet" role="presentation">
              <div ref={plateRef} className="am__plate" aria-hidden="true">
                <span className="am__tone am__tone--accent" />
                <span className="am__tone am__tone--danger" />
                <span className="am__glow" />
                <span className="am__hint"><CornerDownLeft /></span>
              </div>
              <div className="am__list" role="presentation">
                {items.map((entry, i) => {
                  if (entry.type === 'divider') {
                    return <div key={`d-${i}`} className="am__divider" role="separator" style={{ '--am-i': i } as React.CSSProperties} />;
                  }
                  const idx = ++rowIndex;
                  const Icon = entry.icon;
                  return (
                    <button
                      key={entry.label}
                      ref={(el) => { if (el) itemRefs.current[idx] = el; }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      disabled={entry.disabled}
                      aria-disabled={entry.disabled || undefined}
                      title={entry.title}
                      className={`am__item${entry.danger ? ' am__item--danger' : ''}`}
                      style={{ '--am-i': i } as React.CSSProperties}
                      onPointerEnter={() => {
                        if (idx === activeIndex.current || entry.disabled) return;
                        const keyboard = itemRefs.current.includes(document.activeElement as HTMLButtonElement);
                        setActive(idx, keyboard);
                      }}
                      onPointerDown={() => plateRef.current?.classList.add('is-pressed')}
                      onPointerUp={() => plateRef.current?.classList.remove('is-pressed')}
                      onPointerLeave={() => plateRef.current?.classList.remove('is-pressed')}
                      onClick={() => chooseItem(idx)}
                    >
                      <span className="am__icon"><Icon aria-hidden="true" /></span>
                      <span className="am__label">{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
