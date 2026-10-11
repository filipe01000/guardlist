import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// Janela padrão: fecha com Esc, clique fora ou botão; mantém o foco dentro enquanto aberta.
export const Modal: React.FC<ModalProps> = ({ open, title, subtitle, onClose, size = 'md', children, footer }) => {
  const ref = useDialogFocus(open);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Portal no body: a janela não fica presa a containers animados (transform) da página.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`gl-modal gl-modal--${size} modal-panel`}>
        <header className="gl-modal__header">
          <div className="min-w-0">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={onClose} aria-label="Fechar">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="gl-modal__body">{children}</div>
        {footer && <footer className="gl-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
};
