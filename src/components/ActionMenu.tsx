import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, CornerDownLeft, MoreHorizontal } from 'lucide-react';
import './ActionMenu.css';

export interface ActionMenuItem {
  type?: 'item';
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
  /** Submenu (abre ao lado, com mouse ou seta para a direita). */
  children?: ActionMenuEntry[];
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** Texto curto à direita: atalho de teclado ou "↗" para links externos. */
  hint?: string;
}

export type ActionMenuEntry =
  | { type: 'divider' }
  | { type: 'heading'; label: string; detail?: string }
  | ActionMenuItem;

const isItem = (e: ActionMenuEntry): e is ActionMenuItem => e.type !== 'divider' && e.type !== 'heading';

export type MenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'trigger'; rect: DOMRect }
  | { kind: 'side'; rect: DOMRect; parent: DOMRect };

/** choose: item escolhido · escape: Esc · tab: saiu com Tab · back: seta para a esquerda num submenu. */
export type DismissReason = 'choose' | 'escape' | 'tab' | 'back';

const OPEN_AT = 'am:open-at';
const MARGIN = 8;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

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

/** Fecha o menu ao clicar fora, rolar a página, redimensionar ou trocar de janela. */
export function useMenuDismiss(open: boolean, close: (restoreFocus: boolean) => void, triggerRef?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => {
      const el = t as Element | null;
      return Boolean(el?.closest?.('.am__menu')) || Boolean(triggerRef?.current?.contains(el as Node));
    };
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) close(false); };
    const onScroll = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.am__menu')) close(false); };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [open, close, triggerRef]);
}

interface MenuPanelProps {
  items: ActionMenuEntry[];
  label: string;
  anchor: MenuAnchor;
  onDismiss: (reason: DismissReason) => void;
  /** Foca o primeiro item ao abrir (submenus abertos pelo mouse não roubam o foco). */
  focusOnOpen?: boolean;
  id?: string;
}

/**
 * Painel do menu com placa deslizante: a placa acompanha o item ativo (mouse ou teclado),
 * fica vermelha em itens perigosos e tem um brilho que segue o ponteiro. Aceita títulos,
 * divisórias e submenus. Renderizado num portal, para não ser cortado por áreas com rolagem.
 */
export function MenuPanel({ items, label, anchor, onDismiss, focusOnOpen = true, id }: MenuPanelProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = useRef(-1);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  const [sub, setSub] = useState<{ index: number; anchor: MenuAnchor; focus: boolean } | null>(null);
  const rows = items.filter(isItem);
  const isSub = anchor.kind === 'side';

  // Posição: no cursor, abaixo do botão ⋯ ou ao lado do item pai; nunca fora da tela.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (anchor.kind === 'point') {
      const up = anchor.y + h + MARGIN > vh && anchor.y - h > MARGIN;
      const left = anchor.x + w + MARGIN > vw ? Math.max(MARGIN, anchor.x - w) : anchor.x;
      setPos({ top: up ? anchor.y - h : clamp(anchor.y, MARGIN, vh - h - MARGIN), left, origin: `${left < anchor.x ? 'right' : 'left'} ${up ? 'bottom' : 'top'}` });
    } else if (anchor.kind === 'trigger') {
      const r = anchor.rect;
      const up = r.bottom + h + 12 > vh && r.top - h - 12 > 0;
      setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left: clamp(r.right - w, MARGIN, vw - w - MARGIN), origin: `right ${up ? 'bottom' : 'top'}` });
    } else {
      const { rect, parent } = anchor;
      const right = parent.right + w - 2 <= vw - MARGIN;
      setPos({
        top: clamp(rect.top - 6, MARGIN, vh - h - MARGIN),
        left: right ? parent.right - 2 : Math.max(MARGIN, parent.left - w + 2),
        origin: `${right ? 'left' : 'right'} top`
      });
    }
  }, [anchor]);

  useEffect(() => {
    setSub(null);
  }, [anchor]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const movePlate = (row: HTMLElement) => {
    const plate = plateRef.current;
    if (!plate) return;
    plate.style.setProperty('--am-plate-y', `${row.offsetTop}px`);
    plate.style.setProperty('--am-plate-h', `${row.offsetHeight}px`);
    plate.classList.toggle('is-danger', row.classList.contains('am__item--danger'));
    plate.classList.toggle('no-hint', row.hasAttribute('data-has-extra'));
    plate.classList.add('is-visible');
  };

  const setActive = (index: number, focus: boolean) => {
    const row = itemRefs.current[index];
    if (!row) return;
    itemRefs.current.forEach((el) => el?.classList.remove('is-active'));
    activeIndex.current = index;
    row.classList.add('is-active');
    movePlate(row);
    if (focus) row.focus({ preventScroll: true });
  };

  const moveActive = (delta: number) => {
    const n = rows.length;
    if (!n) return;
    let next = activeIndex.current;
    for (let i = 0; i < n; i++) {
      next = (next + delta + n) % n;
      if (!rows[next]?.disabled) break;
    }
    setActive(next, true);
  };

  const openSub = (index: number, focus: boolean) => {
    const row = itemRefs.current[index];
    const panel = menuRef.current;
    if (!row || !panel || !rows[index]?.children || rows[index].disabled) return;
    setSub({ index, focus, anchor: { kind: 'side', rect: row.getBoundingClientRect(), parent: panel.getBoundingClientRect() } });
  };

  const chooseItem = (index: number) => {
    const entry = rows[index];
    if (!entry || entry.disabled) return;
    if (entry.children) {
      openSub(index, true);
      return;
    }
    onDismiss('choose');
    entry.onSelect?.();
  };

  // Ao abrir, o primeiro item habilitado fica ativo (e recebe o foco, se pedido).
  useEffect(() => {
    if (!pos || !focusOnOpen) return;
    const first = rows.findIndex((r) => !r.disabled);
    if (first >= 0) setActive(first, true);
    else menuRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos !== null]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.stopPropagation();
      onDismiss('tab');
      return;
    }
    const a = activeIndex.current;
    const actions: Record<string, () => void> = {
      ArrowDown: () => moveActive(1),
      ArrowUp: () => moveActive(-1),
      Home: () => { activeIndex.current = -1; moveActive(1); },
      End: () => { activeIndex.current = 0; moveActive(-1); },
      Enter: () => chooseItem(a),
      ' ': () => chooseItem(a),
      ArrowRight: () => { if (rows[a]?.children) openSub(a, true); },
      ArrowLeft: () => { if (isSub) onDismiss('back'); },
      Escape: () => onDismiss(isSub ? 'back' : 'escape')
    };
    const run = actions[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation(); // não deixa o Esc fechar a janela de trás nem disparar atalhos globais
    run();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const plate = plateRef.current;
    if (!plate) return;
    plate.style.setProperty('--am-glow-x', `${Math.round(e.clientX - plate.getBoundingClientRect().left)}px`);
  };

  const onSubDismiss = (reason: DismissReason) => {
    const parentIndex = sub?.index ?? -1;
    setSub(null);
    if (reason === 'back') setActive(parentIndex, true);
    else onDismiss(reason);
  };

  itemRefs.current = [];
  let rowIndex = -1;

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          className={`am__menu${pos ? ' is-placed' : ''}${isSub ? ' is-sub' : ''}`}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, transformOrigin: pos?.origin }}
          onKeyDown={onKeyDown}
          onPointerMove={onPointerMove}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
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
                if (entry.type === 'heading') {
                  return (
                    <div key={`h-${i}`} className="am__heading" role="presentation" style={{ '--am-i': i } as React.CSSProperties}>
                      <span>{entry.label}</span>
                      {entry.detail && <small>{entry.detail}</small>}
                    </div>
                  );
                }
                const idx = ++rowIndex;
                const Icon = entry.icon;
                const hasChildren = Boolean(entry.children);
                return (
                  <button
                    key={`${entry.label}-${i}`}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={entry.disabled}
                    aria-disabled={entry.disabled || undefined}
                    aria-haspopup={hasChildren ? 'menu' : undefined}
                    aria-expanded={hasChildren ? sub?.index === idx : undefined}
                    title={entry.title}
                    data-has-extra={hasChildren || entry.hint ? '' : undefined}
                    className={`am__item${entry.danger ? ' am__item--danger' : ''}${sub?.index === idx ? ' is-expanded' : ''}`}
                    style={{ '--am-i': i } as React.CSSProperties}
                    onPointerEnter={() => {
                      window.clearTimeout(hoverTimer.current);
                      if (entry.disabled) return;
                      if (idx !== activeIndex.current) {
                        const keyboard = itemRefs.current.includes(document.activeElement as HTMLButtonElement);
                        setActive(idx, keyboard);
                      }
                      if (hasChildren) {
                        if (sub?.index !== idx) hoverTimer.current = window.setTimeout(() => openSub(idx, false), 130);
                      } else if (sub) {
                        hoverTimer.current = window.setTimeout(() => setSub(null), 160);
                      }
                    }}
                    onPointerDown={() => plateRef.current?.classList.add('is-pressed')}
                    onPointerUp={() => plateRef.current?.classList.remove('is-pressed')}
                    onPointerLeave={() => plateRef.current?.classList.remove('is-pressed')}
                    onClick={() => chooseItem(idx)}
                  >
                    <span className="am__icon"><Icon aria-hidden="true" /></span>
                    <span className="am__label">{entry.label}</span>
                    {entry.hint && <span className="am__kbd">{entry.hint}</span>}
                    {hasChildren && <ChevronRight className="am__chev" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
      {sub && rows[sub.index]?.children && (
        <MenuPanel
          items={rows[sub.index].children!}
          label={rows[sub.index].label}
          anchor={sub.anchor}
          focusOnOpen={sub.focus}
          onDismiss={onSubDismiss}
        />
      )}
    </>
  );
}

interface ActionMenuProps {
  items: ActionMenuEntry[];
  /** Nome acessível do botão, ex.: "Ações de 45.9.20.33". */
  label: string;
  /** Selo opcional no botão (ex.: número de comentários). */
  badge?: number;
}

/** Botão "⋯" de uma linha. Também abre pelo botão direito na linha (openActionMenuAt). */
export default function ActionMenu({ items, label, badge }: ActionMenuProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const open = anchor !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useMenuDismiss(open, close, triggerRef);

  // Pedido de abertura vindo do botão direito na linha.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const onOpenAt = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      setAnchor({ kind: 'point', x, y });
    };
    trigger.addEventListener(OPEN_AT, onOpenAt);
    return () => trigger.removeEventListener(OPEN_AT, onOpenAt);
  }, []);

  const openFromTrigger = () => {
    if (triggerRef.current) setAnchor({ kind: 'trigger', rect: triggerRef.current.getBoundingClientRect() });
  };

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
        title="Ações (ou botão direito na linha)"
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else openFromTrigger();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openFromTrigger();
          }
        }}
      >
        <MoreHorizontal aria-hidden="true" />
        {badge ? <span className="am__badge">{badge}</span> : null}
      </button>
      {anchor && (
        <MenuPanel
          id={menuId}
          items={items}
          label={label}
          anchor={anchor}
          onDismiss={(reason) => close(reason === 'escape' || reason === 'choose')}
        />
      )}
    </>
  );
}
