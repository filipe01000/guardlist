import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(isOpen: boolean) {
  const dialogRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert], [hidden], [aria-hidden="true"]'));

    const preferred = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    const initialTarget = preferred || getFocusable()[0] || dialog;
    const frame = requestAnimationFrame(() => initialTarget.focus());

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', trapFocus);
    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener('keydown', trapFocus);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
