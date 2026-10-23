import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import App from './App.tsx';
import { GlassShell, Login } from './components/Login';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { SESSION_EXPIRED_EVENT } from './db/store';
import { SessionUser } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; user: SessionUser | null };

// Aplica o tema salvo antes do App montar, para a tela de login seguir a mesma preferência.
function applySavedTheme() {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem('guardlist-theme');
  } catch {
    // Navegação com armazenamento restrito continua usando o tema do sistema.
  }
  const theme = saved === 'dark' || saved === 'light'
    ? saved
    : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function AuthGate() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(() => {
    setAuth({ status: 'loading' });
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => setAuth({ status: 'ready', user: body.user ?? null }))
      .catch(() => setAuth({ status: 'error' }));
  }, []);

  useEffect(() => {
    applySavedTheme();
    loadSession();
  }, [loadSession]);

  // Qualquer chamada recusada por sessão expirada ou senha pendente reavalia a sessão.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, loadSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, loadSession);
  }, [loadSession]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAuth({ status: 'ready', user: null });
  };

  if (auth.status === 'loading' || auth.status === 'error') {
    const loading = auth.status === 'loading';
    return (
      <GlassShell labelledBy="auth-status-title">
        <div role={loading ? 'status' : 'alert'} aria-busy={loading}>
          <h1 id="auth-status-title" className="gl-shell-title flex items-center gap-2">
            {loading && <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {loading ? 'Verificando seu acesso…' : 'Não foi possível conectar'}
          </h1>
          <p className="gl-shell-text">
            {loading ? 'Aguarde enquanto carregamos sua sessão.' : 'Não conseguimos verificar sua sessão. Tente novamente em instantes.'}
          </p>
        </div>
        {!loading && (
          <button type="button" className="gl-submit w-full" onClick={loadSession}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        )}
      </GlassShell>
    );
  }

  if (!auth.user) {
    return <Login onLogin={(user) => setAuth({ status: 'ready', user })} />;
  }

  if (auth.user.mustChangePassword) {
    return (
      <GlassShell labelledBy="first-access-title">
        <h1 id="first-access-title" className="gl-shell-title">Defina sua senha</h1>
        <p className="gl-shell-text">
          Olá, {auth.user.displayName}. Antes de começar, troque a senha provisória que você recebeu por uma só sua.
        </p>
        <ChangePasswordForm
          submitLabel="Definir senha e entrar"
          onDone={(user) => setAuth({ status: 'ready', user })}
          onCancel={handleLogout}
        />
      </GlassShell>
    );
  }

  return (
    <App
      currentUser={auth.user}
      onLogout={handleLogout}
      onUserChange={(user) => setAuth({ status: 'ready', user })}
    />
  );
}
