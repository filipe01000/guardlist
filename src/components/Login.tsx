import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, User } from 'lucide-react';
import { SessionUser } from '../types';
import { PerimeterCanvas, PerimeterEvent } from './PerimeterCanvas';
import { MfaCode, type VerifyResult } from './mfa/MfaCode';
import { MfaSetup } from './mfa/MfaSetup';
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

// Lado esquerdo das telas de entrada: frase e a lista de bloqueios simulados (o perímetro fica atrás da tela toda).
const PerimeterStage: React.FC<{ feed: FeedItem[] }> = ({ feed }) => (
    <section className="gl-stage" aria-label="GuardList">
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

// Moldura comum das telas de entrada (login, primeiro acesso, verificação de sessão).
export const GlassShell: React.FC<{
  lock?: LockState;
  alarmKey?: number;
  sealing?: boolean;
  sealed?: boolean;
  labelledBy?: string;
  children: React.ReactNode;
}> = ({ lock = 'open', alarmKey = 0, sealing = false, sealed = false, labelledBy, children }) => {
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const handleEvent = useCallback((event: PerimeterEvent) => {
    setFeed((items) => [{ ...event, id: ++feedId }, ...items].slice(0, FEED_SIZE));
  }, []);

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
      <PerimeterCanvas alarmKey={alarmKey} sealing={sealing} onEvent={handleEvent} />
      <PerimeterStage feed={feed} />
      {/* Painel de vidro fosco sobre o perímetro; a borda ganha um pulso de luz descendo. */}
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
  // Depois da senha: código do autenticador, cadastro dele, ou código de recuperação.
  const [step, setStep] = useState<'password' | 'mfa' | 'mfa-setup' | 'recovery'>('password');
  const [recoveryCode, setRecoveryCode] = useState('');
  const mfaUser = useRef<SessionUser | null>(null);

  // Acesso liberado: o cadeado tranca, os anéis fecham o perímetro e o app abre.
  const seal = async (user: SessionUser) => {
    setLock('locked');
    setSealing(true);
    await wait(1300);
    setSealed(true);
    await wait(1000);
    onLogin(user);
  };

  const alarm = async () => {
    setLock('shake');
    setAlarmKey((key) => key + 1);
    await wait(560);
    setLock('open');
  };

  const backToPassword = (message: string | null = null) => {
    setStep('password');
    setPassword('');
    setRecoveryCode('');
    setSubmitting(false);
    setError(message);
  };

  // Confere o código do autenticador (ou de recuperação). Etapa expirada ou conta travada voltam para a senha.
  const sendMfa = async (payload: { code?: string; recoveryCode?: string }): Promise<VerifyResult & { user?: SessionUser }> => {
    const response = await fetch('/api/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, user: body.user };
    if (body.code === 'MFA_STEP_EXPIRED' || response.status === 423) backToPassword(body.error);
    return { ok: false, error: body.error || 'Código incorreto.' };
  };

  const verifyCode = async (code: string): Promise<VerifyResult> => {
    const result = await sendMfa({ code });
    if (result.ok) mfaUser.current = result.user ?? null;
    return result;
  };

  const handleRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await sendMfa({ recoveryCode });
    if (result.ok && result.user) return seal(result.user);
    setSubmitting(false);
    setRecoveryCode('');
    if (!result.ok) setError(result.error);
    await alarm();
  };

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
      // Senha certa e verificação em duas etapas exigida: falta o código (ou o cadastro do autenticador).
      if (body.step === 'mfa' || body.step === 'mfa-setup') {
        setSubmitting(false);
        setStep(body.step);
        return;
      }
      await seal(body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setPassword('');
      setSubmitting(false);
      await alarm();
    }
  };

  return (
    <GlassShell lock={lock} alarmKey={alarmKey} sealing={sealing} sealed={sealed} labelledBy="gl-login-title">
      {step === 'mfa' && (
        <div className="gl-form">
          <div className="gl-form__head">
            <h1 id="gl-login-title">Confirme que é você</h1>
            <p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
          </div>
          <MfaCode verify={verifyCode} onSuccess={() => { if (mfaUser.current) void seal(mfaUser.current); }} onError={() => void alarm()} />
          <div className="gl-mfa-alt">
            <button type="button" className="gl-mfa-link" onClick={() => { setError(null); setStep('recovery'); }}>Usar um código de recuperação</button>
            <button type="button" className="gl-mfa-link gl-mfa-link--muted" onClick={() => backToPassword()}>Voltar</button>
          </div>
        </div>
      )}

      {step === 'recovery' && (
        <form className="gl-form" onSubmit={handleRecovery}>
          <div className="gl-form__head">
            <h1 id="gl-login-title">Código de recuperação</h1>
            <p>Use um dos códigos que você guardou ao cadastrar o autenticador. Cada um vale uma vez.</p>
          </div>
          <input
            className="gl-mfa-recovery-input"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="xxxx-xxxx"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Código de recuperação"
            autoFocus
            required
          />
          <p className="gl-form__error" role="alert">{error}</p>
          <button type="submit" className="gl-submit gl-submit--split" disabled={submitting}>
            <span>{lock === 'locked' ? 'Acesso liberado' : submitting ? 'Verificando…' : 'Entrar'}</span>
            {submitting && lock !== 'locked' ? <Loader2 className="gl-spin" aria-hidden="true" /> : <ArrowRight className="gl-submit__arrow" aria-hidden="true" />}
          </button>
          <div className="gl-mfa-alt">
            <button type="button" className="gl-mfa-link" onClick={() => { setError(null); setStep('mfa'); }}>Usar o código do aplicativo</button>
            <button type="button" className="gl-mfa-link gl-mfa-link--muted" onClick={() => backToPassword()}>Voltar</button>
          </div>
        </form>
      )}

      {step === 'mfa-setup' && (
        <div className="gl-form">
          <div className="gl-form__head">
            <h1 id="gl-login-title">Ative a verificação em duas etapas</h1>
            <p>O administrador passou a exigir um código do celular, além da senha.</p>
          </div>
          <MfaSetup onDone={(user) => void seal(user)} onExpired={() => backToPassword('A verificação expirou. Entre com usuário e senha de novo.')} />
          <div className="gl-mfa-alt">
            <span />
            <button type="button" className="gl-mfa-link gl-mfa-link--muted" onClick={() => backToPassword()}>Voltar</button>
          </div>
        </div>
      )}

      {step === 'password' && (
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
      )}
    </GlassShell>
  );
};
