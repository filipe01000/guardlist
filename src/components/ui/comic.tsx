import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * StreamUI Comic Speech Bubble:
 * Balão de fala em estilo quadrinhos anos 90 com borda grossa, sombra dura e cauda apontadora.
 */
export function ComicSpeechBubble({
  children,
  speaker,
  tone = 'yellow',
  tailDirection = 'left',
  className,
}: {
  children: React.ReactNode;
  speaker?: string;
  tone?: 'yellow' | 'white' | 'pink' | 'sky' | 'mint' | 'danger';
  tailDirection?: 'left' | 'top' | 'none';
  className?: string;
}) {
  const toneClasses: Record<string, string> = {
    yellow: 'bg-[#FEF08A] text-[#09090B]',
    white: 'bg-white dark:bg-slate-900 text-foreground',
    pink: 'bg-[#FCE7F3] text-[#09090B]',
    sky: 'bg-[#E0F2FE] text-[#09090B]',
    mint: 'bg-[#DCFCE7] text-[#09090B]',
    danger: 'bg-[#FEE2E2] text-[#7F1D1D]',
  };

  return (
    <div
      className={cn(
        'relative rounded-2xl border-3 border-border p-4 shadow-shadow animate-comic-pop',
        toneClasses[tone],
        className
      )}
    >
      {tailDirection === 'left' && (
        <div
          aria-hidden="true"
          className="hidden sm:block absolute -left-3.5 top-6 w-4 h-4 rotate-45 border-l-3 border-b-3 border-border bg-inherit"
        />
      )}
      {tailDirection === 'top' && (
        <div
          aria-hidden="true"
          className="
            absolute -top-3.5 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-l-3 border-t-3 border-border bg-inherit
          "
        />
      )}
      {speaker && (
        <div className="font-display text-[11px] font-black uppercase tracking-wider text-[#FF5CA8] mb-1">
          💬 {speaker} DIZ:
        </div>
      )}
      <div className="text-xs sm:text-sm font-bold leading-relaxed">
        {children}
      </div>
    </div>
  );
}

/**
 * StreamUI Comic Action Callout ("WOO-HOO!", "POW!", "D'OH!", "BLINDADO!")
 * Selo inclinado de quadrinhos com contorno preto grosso e sombra deslocada.
 */
export function ComicActionCallout({
  text,
  tone = 'yellow',
  className,
}: {
  text: string;
  tone?: 'yellow' | 'pink' | 'sky' | 'emerald' | 'danger';
  className?: string;
}) {
  const colors = {
    yellow: 'bg-[#FFD90F] text-[#09090B]',
    pink: 'bg-[#FF5CA8] text-white',
    sky: 'bg-[#38BDF8] text-[#09090B]',
    emerald: 'bg-emerald-400 text-[#09090B]',
    danger: 'bg-rose-500 text-white',
  };

  return (
    <span
      className={cn(
        'inline-block px-3 py-1 font-display font-black text-xs uppercase tracking-wider border-3 border-border shadow-[3px_3px_0px_0px_var(--border)] -rotate-2 select-none whitespace-nowrap',
        colors[tone],
        className
      )}
    >
      {text}
    </span>
  );
}

export interface ComicToastMessage {
  id: string;
  burst: string; // Ex: "WOO-HOO!", "ZAP!", "COPIADO!", "D'OH!"
  title: string;
  description?: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
}

/**
 * StreamUI Comic Notification Toast:
 * Notificação estilo tirinha de quadrinhos para feedback de ações no cofre.
 */
export function ComicToastOverlay({
  toast,
  onDismiss,
}: {
  toast: ComicToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  const bgMap = {
    success: 'bg-emerald-300 text-[#09090B]',
    info: 'bg-[#38BDF8] text-[#09090B]',
    warning: 'bg-[#FFD90F] text-[#09090B]',
    danger: 'bg-rose-500 text-white',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 max-w-sm w-full animate-comic-pop"
    >
      <div className="bg-secondary-background text-foreground border-4 border-border rounded-2xl p-4 shadow-[6px_6px_0px_0px_var(--border)] flex items-start gap-3">
        <span
          className={cn(
            'px-2.5 py-1 font-display font-black text-xs uppercase border-2 border-border shadow-[2px_2px_0px_0px_var(--border)] -rotate-3 shrink-0',
            bgMap[toast.tone]
          )}
        >
          {toast.burst}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-extrabold text-sm leading-snug">
            {toast.title}
          </p>
          {toast.description && (
            <p className="text-xs text-stone-600 dark:text-slate-300 mt-0.5">
              {toast.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar notificação"
          className="p-1 rounded-lg border-2 border-border bg-stone-100 dark:bg-slate-800 hover:bg-rose-500 hover:text-white cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
