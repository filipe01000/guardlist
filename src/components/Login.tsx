import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { SessionUser } from '../types';
import './Login.css';

interface LoginProps {
  onLogin: (user: SessionUser) => void;
}

const Hero: React.FC = () => (
  <div className="gl-hero">
    <img src="/brand/guardlist-mark.png" alt="" className="gl-hero__mark" />
    <h2>GuardList</h2>
    <p>Blocklists de firewall de cada cliente, revisadas toda semana.</p>
  </div>
);

const LoginForm: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      onLogin(body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="gl-form gl-form--login" onSubmit={handleSubmit}>
      <div className="gl-form__head">
        <ShieldCheck aria-hidden="true" />
        <h1>Entrar no GuardList</h1>
        <p>Acesso restrito à equipe autorizada.</p>
      </div>

      <label className="gl-field">
        <span>Usuário</span>
        <input
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />
      </label>

      <label className="gl-field">
        <span>Senha</span>
        <span className="gl-field__password">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
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
        {submitting ? <Loader2 className="gl-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
        {submitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
};

// O loop da porta só toca sem "reduzir movimento" e sem economia de dados; senão fica o pôster.
function canPlayVaultLoop(): boolean {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  return !reduceMotion && !saveData;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [playLoop] = useState(canPlayVaultLoop);

  return (
    <main className="gl-login-page">
      <div className="gl-card">
        <div className="gl-card-bg" aria-hidden="true">
          {playLoop && (
            <video
              className="gl-card-bg__video"
              src="/brand/login-vault-loop.mp4"
              poster="/brand/login-vault-poster.webp"
              autoPlay
              muted
              loop
              playsInline
              disablePictureInPicture
              tabIndex={-1}
            />
          )}
        </div>
        <Hero />
        <LoginForm onLogin={onLogin} />
      </div>
    </main>
  );
};
