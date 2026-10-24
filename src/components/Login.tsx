import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, User } from 'lucide-react';
import { SessionUser } from '../types';
import { PerimeterCanvas, PerimeterEvent } from './PerimeterCanvas';
import './Login.css';

interface LoginProps {
  onLogin: (user: SessionUser) => void;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, reduceMotion() ? 0 : ms));

const FEED_SIZE = 7;
const HEADLINE = ['Cada', 'cliente', 'tem', null, 'seu', 'perímetro.'] as const;

export type LockState = 'open' | 'locked' | 'shake';

// Cadeado do formulário: aberto até a senha ser aceita; tranca com brilho ciano, ou treme no erro.
export const Padlock: React.FC<{ state: LockState }> = ({ state }) => (
  <div className={`gl-padlock is-${state}`} aria-hidden="true">
    <svg viewBox="0 0 64 76">
      <path className="gl-padlock__shackle" d="M18 38 V24 a14 14 0 0 1 28 0 V38" />
      <rect className="gl-padlock__body" x="7" y="34" width="50" height="38" rx="11" />
      <g className="gl-padlock__keyhole">
        <circle cx="32" cy="50" r="5" />
        <rect x="29.6" y="52" width="4.8" height="10" rx="2.4" />
      </g>
    </svg>
  </div>
);

interface FeedItem extends PerimeterEvent {
  id: number;
}

let feedId = 0;

// Lado esquerdo das telas de entrada: frase, perímetro animado e a lista de bloqueios simulados.
const PerimeterStage: React.FC<{ alarmKey: number; sealing: boolean }> = ({ alarmKey, sealing }) => {
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const handleEvent = useCallback((event: PerimeterEvent) => {
    setFeed((items) => [{ ...event, id: ++feedId }, ...items].slice(0, FEED_SIZE));
  }, []);

  return (
    <section className="gl-stage" aria-label="GuardList">
      <PerimeterCanvas alarmKey={alarmKey} sealing={sealing} onEvent={handleEvent} />
      <span className="gl-stage__edge" aria-hidden="true" />
      <div className="gl-stage__brand">
        <img src="/brand/guardlist-mark.svg" alt="" />
        GuardList
      </div>
      <div className="gl-stage__copy">
        <p className="gl-stage__title">
          {HEADLINE.map((word, i) => word === null
            ? <br key={i} />
            : (
              <React.Fragment key={i}>
                <span className={`gl-word${word === 'perímetro.' ? ' gl-word--hl' : ''}`} style={{ animationDelay: `${0.15 + i * 0.1}s` }}>{word}</span>{' '}
              </React.Fragment>
            ))}
        </p>
        <p className="gl-stage__text">Importe, revise e investigue bloqueios com as listas de cada cliente sempre separadas.</p>
      </div>
      <div className="gl-feed" aria-hidden="true">
        <div className="gl-feed__head">
          <i className="gl-feed__dot" />
          Perímetro em ação
          <em>simulação</em>
        </div>
        <ul className="gl-feed__list">
          {feed.map((item) => (
            <li key={item.id}>
              <b>{item.address}</b>
              <span className={`gl-feed__tag${item.blocked ? '' : ' is-pass'}`}>{item.blocked ? 'BLOQUEADO' : 'LIBERADO'}</span>
              <span className="gl-feed__why">{item.reason}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="gl-stage__foot">Gestão de IPs e redes CIDR</div>
    </section>
  );
};

// Moldura comum das telas de entrada (login, primeiro acesso, verificação de sessão).
export const GlassShell: React.FC<{
  lock?: LockState;
  alarmKey?: number;
  sealing?: boolean;
  sealed?: boolean;
  labelledBy?: string;
  children: React.ReactNode;
}> = ({ lock = 'open', alarmKey = 0, sealing = false, sealed = false, labelledBy, children }) => {
  useLayoutEffect(() => {
    // Antes do login o App ainda não aplicou o tema: usa o que ficou salvo neste navegador.
    if (!document.documentElement.dataset.theme) {
      try {
        const saved = window.localStorage.getItem('guardlist-theme');
        if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
      } catch { /* preferência opcional */ }
    }
  }, []);

  return (
    <main className="gl-entry">
      <PerimeterStage alarmKey={alarmKey} sealing={sealing} />
      <section className="gl-panel" aria-labelledby={labelledBy}>
        <div className="gl-panel__inner">
          <Padlock state={lock} />
          {children}
        </div>
      </section>
      <div className={`gl-sealed${sealed ? ' is-on' : ''}`} aria-hidden="true">
        <p>Perímetro selado</p>
      </div>
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
  const [alarmKey, setAlarmKey] = useState(0);
  const [sealing, setSealing] = useState(false);
  const [sealed, setSealed] = useState(false);

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
      // Senha aceita: o cadeado tranca, os anéis fecham o perímetro e o app abre.
      setLock('locked');
      setSealing(true);
      await wait(1300);
      setSealed(true);
      await wait(1000);
      onLogin(body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setPassword('');
      setSubmitting(false);
      setLock('shake');
      setAlarmKey((key) => key + 1);
      await wait(560);
      setLock('open');
    }
  };

  return (
    <GlassShell lock={lock} alarmKey={alarmKey} sealing={sealing} sealed={sealed} labelledBy="gl-login-title">
      <form className="gl-form" onSubmit={handleSubmit}>
        <div className="gl-form__head">
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

        <button type="submit" className="gl-submit gl-submit--split" disabled={submitting}>
          <span>{lock === 'locked' ? 'Acesso liberado' : submitting ? 'Verificando…' : 'Entrar'}</span>
          {submitting && lock !== 'locked'
            ? <Loader2 className="gl-spin" aria-hidden="true" />
            : <ArrowRight className="gl-submit__arrow" aria-hidden="true" />}
        </button>
      </form>
    </GlassShell>
  );
};
