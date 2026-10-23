import React, { useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, User } from 'lucide-react';
import { SessionUser } from '../types';
import './Login.css';

interface LoginProps {
  onLogin: (user: SessionUser) => void;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, reduceMotion() ? 0 : ms));

// Corte diagonal dos cantos do cartão (superior esquerdo e inferior direito), em px.
const CUT = 34;

// Fundo da tela de entrada: faixas de luz azuis e ciano em movimento lento.
const LightStreaks: React.FC = () => (
  <div className="gl-streaks" aria-hidden="true">
    <span className="gl-streak gl-streak--1" />
    <span className="gl-streak gl-streak--2" />
    <span className="gl-streak gl-streak--3" />
    <span className="gl-streak gl-streak--4" />
    <span className="gl-streak gl-streak--line gl-streak--5" />
    <span className="gl-streak gl-streak--line gl-streak--6" />
  </div>
);

// Borda do vidro desenhada em SVG, para acompanhar os cantos cortados.
const GlassFrame: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  if (!width || !height) return null;
  const w = width - 1;
  const h = height - 1;
  const points = `${CUT},0.5 ${w},0.5 ${w},${h - CUT} ${w - CUT},${h} 0.5,${h} 0.5,${CUT}`;
  return (
    <svg className="gl-glass__frame" width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id="gl-frame-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--gl-frame-a)" />
          <stop offset="0.45" stopColor="var(--gl-frame-b)" />
          <stop offset="1" stopColor="var(--gl-frame-a)" />
        </linearGradient>
      </defs>
      <polygon points={points} fill="none" stroke="url(#gl-frame-stroke)" strokeWidth="1.2" />
    </svg>
  );
};

export type LockState = 'open' | 'locked' | 'shake';

// Cadeado de vidro: aberto até a senha ser aceita; tranca com brilho ciano, ou treme no erro.
export const Padlock: React.FC<{ state: LockState }> = ({ state }) => (
  <div className={`gl-padlock is-${state}`} aria-hidden="true">
    <svg viewBox="0 0 64 76">
      <defs>
        <linearGradient id="gl-lock-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--gl-lock-top)" />
          <stop offset="1" stopColor="var(--gl-lock-bottom)" />
        </linearGradient>
      </defs>
      <path className="gl-padlock__shackle" d="M18 38 V24 a14 14 0 0 1 28 0 V38" />
      <rect className="gl-padlock__body" x="7" y="34" width="50" height="38" rx="11" fill="url(#gl-lock-body)" />
      <g className="gl-padlock__keyhole">
        <circle cx="32" cy="50" r="5" />
        <rect x="29.6" y="52" width="4.8" height="10" rx="2.4" />
      </g>
    </svg>
  </div>
);

// Moldura comum das telas de entrada: fundo de luz, cadeado e cartão de vidro com os cantos cortados.
export const GlassShell: React.FC<{ lock?: LockState; leaving?: boolean; labelledBy?: string; children: React.ReactNode }> = ({ lock = 'open', leaving = false, labelledBy, children }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    // Antes do login o App ainda não aplicou o tema: usa o que ficou salvo neste navegador.
    if (!document.documentElement.dataset.theme) {
      try {
        const saved = window.localStorage.getItem('guardlist-theme');
        if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
      } catch { /* preferência opcional */ }
    }
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="gl-login-page">
      <LightStreaks />
      <section className={`gl-glass-wrap${leaving ? ' is-leaving' : ''}`} aria-labelledby={labelledBy}>
        <Padlock state={lock} />
        <span className="gl-glass__corner gl-glass__corner--tl" aria-hidden="true" />
        <span className="gl-glass__corner gl-glass__corner--br" aria-hidden="true" />
        <div className="gl-glass" ref={cardRef}>
          {children}
          <GlassFrame width={size.width} height={size.height} />
        </div>
      </section>
    </main>
  );
};

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lock, setLock] = useState<LockState>('open');
  const [leaving, setLeaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Não foi possível entrar.');
      // Senha aceita: o cadeado tranca, o cartão se desfaz e o app abre.
      setLock('locked');
      await wait(850);
      setLeaving(true);
      await wait(380);
      onLogin(body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setPassword('');
      setSubmitting(false);
      setLock('shake');
      await wait(560);
      setLock('open');
    }
  };

  return (
    <GlassShell lock={lock} leaving={leaving} labelledBy="gl-login-title">
      <form className="gl-form" onSubmit={handleSubmit}>
        <div className="gl-form__head">
          <span className="gl-form__brand">
            <img src="/brand/guardlist-mark.png" alt="" />
            GuardList
          </span>
          <h1 id="gl-login-title">Entrar no <span>GuardList</span></h1>
          <p>Acesso restrito à equipe autorizada.</p>
        </div>

        <label className="gl-field">
          <span>Usuário</span>
          <span className="gl-field__box">
            <User aria-hidden="true" className="gl-field__icon" />
            <input
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="seu.usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </span>
        </label>

        <label className="gl-field">
          <span>Senha</span>
          <span className="gl-field__box">
            <LockKeyhole aria-hidden="true" className="gl-field__icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="gl-field__toggle"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </span>
        </label>

        <p className="gl-form__error" role="alert">{error}</p>

        <button type="submit" className="gl-submit" disabled={submitting}>
          {submitting && lock !== 'locked' ? <Loader2 className="gl-spin" aria-hidden="true" /> : null}
          {lock === 'locked' ? 'Acesso liberado' : submitting ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </GlassShell>
  );
};
