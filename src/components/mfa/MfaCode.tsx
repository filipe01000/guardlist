import React, { useEffect, useRef, useState } from 'react';
import './Mfa.css';

// Seis caixas do código de verificação. Ao completar, os dígitos giram em espiral até o cadeado
// (`.gl-padlock` na mesma tela) enquanto o código é conferido; se estiver errado, voltam para as caixas.

export type VerifyResult = { ok: true } | { ok: false; error: string };

interface MfaCodeProps {
  verify: (code: string) => Promise<VerifyResult>;
  onSuccess?: () => void;
  onError?: () => void;
  // Sem animação (Minha conta, confirmação do cadastro).
  plain?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

const LENGTH = 6;
const WIND_UP_BRAKE = 'cubic-bezier(.62, -0.25, .22, 1)';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Espiral exata até o centro: o raio diminui enquanto o ângulo avança 450°.
function spiral(from: { x: number; y: number }, hub: { x: number; y: number }, reverse: boolean): Keyframe[] {
  const dx = from.x - hub.x;
  const dy = from.y - hub.y;
  const r0 = Math.hypot(dx, dy);
  const a0 = Math.atan2(dy, dx);
  const frames: Keyframe[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const r = r0 * (1 - t);
    const a = a0 + t * Math.PI * 2.5;
    frames.push({ left: `${hub.x + Math.cos(a) * r}px`, top: `${hub.y + Math.sin(a) * r}px`, opacity: 1 - t * 0.85, transform: `scale(${1 - t * 0.6})` });
  }
  return reverse ? frames.reverse() : frames;
}

export const MfaCode: React.FC<MfaCodeProps> = ({ verify, onSuccess, onError, plain = false, autoFocus = true, disabled = false }) => {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'bad'>('idle');
  const [away, setAway] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  async function fly(reverse: boolean) {
    if (plain || reduceMotion()) return;
    const lock = groupRef.current?.closest('.gl-panel__inner, .gl-mfa-scope')?.querySelector('.gl-padlock') ?? document.querySelector('.gl-padlock');
    if (!lock) return;
    const box = lock.getBoundingClientRect();
    const hub = { x: box.left + box.width / 2, y: box.top + box.height * 0.62 };
    setAway(true);
    const flights = refs.current.map((input, i) => {
      if (!input) return Promise.resolve();
      const r = input.getBoundingClientRect();
      const el = document.createElement('span');
      el.className = 'gl-mfa-fly';
      el.textContent = input.value || '•';
      document.body.appendChild(el);
      const anim = el.animate(spiral({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, hub, reverse), {
        duration: reverse ? 520 : 800,
        delay: reverse ? i * 25 : i * 55,
        easing: reverse ? 'ease-out' : WIND_UP_BRAKE,
        fill: 'forwards'
      });
      return anim.finished.then(() => el.remove(), () => el.remove());
    });
    await Promise.all(flights);
    if (reverse) setAway(false);
  }

  async function submit(code: string) {
    setState('checking');
    setError(null);
    refs.current.forEach((i) => i?.blur());
    const [result] = await Promise.all([
      verify(code).catch((e): VerifyResult => ({ ok: false, error: e instanceof Error ? e.message : 'Não foi possível conferir o código.' })),
      fly(false)
    ]);
    if (result.ok) {
      onSuccess?.();
      return;
    }
    onError?.();
    await fly(true);
    setAway(false);
    setState('bad');
    setError(result.error);
    setDigits(Array(LENGTH).fill(''));
    window.setTimeout(() => {
      setState('idle');
      refs.current[0]?.focus();
    }, 450);
  }

  function fill(text: string, from: number) {
    const incoming = text.replace(/\D/g, '').slice(0, LENGTH - from).split('');
    if (!incoming.length) return;
    const next = [...digits];
    incoming.forEach((d, k) => { next[from + k] = d; });
    setDigits(next);
    setError(null);
    const position = Math.min(from + incoming.length, LENGTH - 1);
    refs.current[position]?.focus();
    if (next.every(Boolean)) void submit(next.join(''));
  }

  const busy = disabled || state === 'checking';

  return (
    <div className="gl-mfa">
      <div ref={groupRef} className={`gl-mfa__slots${state === 'bad' ? ' is-bad' : ''}${away ? ' is-away' : ''}`} role="group" aria-label="Código de verificação">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            className={d ? 'is-filled' : ''}
            value={d}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Dígito ${i + 1}`}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              if (v) fill(v, i);
              else setDigits((cur) => cur.map((x, k) => (k === i ? '' : x)));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digits[i] && i > 0) {
                e.preventDefault();
                setDigits((cur) => cur.map((x, k) => (k === i - 1 ? '' : x)));
                refs.current[i - 1]?.focus();
              }
              if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'ArrowRight' && i < LENGTH - 1) refs.current[i + 1]?.focus();
            }}
            onPaste={(e) => {
              e.preventDefault();
              fill(e.clipboardData.getData('text'), i);
            }}
          />
        ))}
      </div>
      <p className="gl-mfa__error" role="alert">{error}</p>
      <TimerHint />
    </div>
  );
};

// Barra dos 30 segundos de vida do código.
const TimerHint: React.FC = () => {
  const [left, setLeft] = useState(() => 1 - ((Date.now() / 1000) % 30) / 30);
  useEffect(() => {
    const id = window.setInterval(() => setLeft(1 - ((Date.now() / 1000) % 30) / 30), 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="gl-mfa__hint">
      O código muda a cada 30 segundos.
      <span className="gl-mfa__timer" aria-hidden="true"><i style={{ transform: `scaleX(${left})` }} /></span>
    </p>
  );
};
