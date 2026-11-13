import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// Avisos no padrão de vidro. Os nomes e as propriedades vêm do visual antigo de quadrinhos e foram
// mantidos para não mexer nas telas; o tom aparece numa faixa lateral e na cor do rótulo.

type Tone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger';

const toneBar: Record<Tone, string> = {
  accent: 'border-l-main',
  neutral: 'border-l-line-strong',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
};

const toneText: Record<Tone, string> = {
  accent: 'text-accent',
  neutral: 'text-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Aviso com rótulo opcional de quem fala. */
export function ComicSpeechBubble({
  children,
  speaker,
  tone = 'yellow',
  className,
}: {
  children: React.ReactNode;
  speaker?: string;
  tone?: 'yellow' | 'white' | 'pink' | 'sky' | 'mint' | 'danger';
  /** Sem efeito no visual novo; mantido para não mexer nas chamadas. */
  tailDirection?: 'left' | 'top' | 'none';
  className?: string;
}) {
  const mapped: Tone =
    tone === 'danger' ? 'danger' : tone === 'mint' ? 'success' : tone === 'yellow' ? 'accent' : 'neutral';

  return (
    <div
      className={cn(
        'glass rounded-surface border-l-[3px] p-4 text-foreground',
        toneBar[mapped],
        className
      )}
    >
      {speaker && (
        <div className={cn('text-xs font-semibold mb-1', toneText[mapped])}>{speaker}</div>
      )}
      <div className="text-xs sm:text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/** Etiqueta curta de estado, em pílula. */
export function ComicActionCallout({
  text,
  tone = 'yellow',
  className,
}: {
  text: string;
  tone?: 'yellow' | 'pink' | 'sky' | 'emerald' | 'danger';
  className?: string;
}) {
  const mapped: Tone =
    tone === 'danger' ? 'danger' : tone === 'emerald' ? 'success' : tone === 'yellow' ? 'accent' : 'neutral';

  return (
    <span
      className={cn(
        'inline-block rounded-full border border-current px-2.5 py-0.5 text-xs font-semibold select-none whitespace-nowrap',
        toneText[mapped],
        className
      )}
    >
      {text}
    </span>
  );
}

export interface ComicToastMessage {
  id: string;
  burst: string; // Rótulo curto do aviso. Ex.: "COPIADO!"
  title: string;
  description?: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
}

/** Notificação no canto da tela para o resultado de ações no cofre. */
export function ComicToastOverlay({
  toast,
  onDismiss,
}: {
  toast: ComicToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  const mapped: Tone = toast.tone === 'info' ? 'accent' : toast.tone;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 left-5 sm:left-auto z-50 sm:max-w-sm sm:w-full animate-comic-pop"
    >
      <div
        className={cn(
          'glass-strong rounded-surface border-l-[3px] p-4 text-foreground flex items-start gap-3',
          toneBar[mapped]
        )}
      >
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs font-semibold', toneText[mapped])}>{toast.burst}</p>
          <p className="font-semibold text-sm leading-snug">{toast.title}</p>
          {toast.description && (
            <p className="text-xs text-muted mt-0.5">{toast.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar notificação"
          className="p-1 rounded-base text-muted hover:bg-accent-soft hover:text-foreground cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
