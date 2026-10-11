import React, { useCallback, useEffect, useState } from 'react';
import App from './App.tsx';
import { Login } from './components/Login';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { SESSION_EXPIRED_EVENT } from './db/store';
import { SessionUser } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; user: SessionUser | null };

// Aplica o tema salvo antes do App montar, para a tela de login seguir a mesma preferência.
function applySavedTheme() {
  const saved = window.localStorage.getItem('guardlist-theme');
  const theme = saved === 'dark' || saved === 'light'
    ? saved
    : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function AuthGate() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(() => {
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

  if (auth.status === 'loading') return null;

  if (auth.status === 'error') {
    return (
      <main className="gl-login-page">
        <p>Não foi possível conectar ao servidor do GuardList. Recarregue a página.</p>
      </main>
    );
  }

  if (!auth.user) {
    return <Login onLogin={(user) => setAuth({ status: 'ready', user })} />;
  }

  if (auth.user.mustChangePassword) {
    return (
      <main className="gl-login-page">
        <section className="data-panel w-full max-w-md p-6 sm:p-7 view-enter" aria-labelledby="first-access-title">
          <h1 id="first-access-title" className="text-lg font-bold text-white">Defina sua senha</h1>
          <p className="text-xs text-slate-400 mt-1.5 mb-5">
            Olá, {auth.user.displayName}. Antes de começar, troque a senha provisória que você recebeu por uma só sua.
          </p>
          <ChangePasswordForm
            submitLabel="Definir senha e entrar"
            onDone={(user) => setAuth({ status: 'ready', user })}
            onCancel={handleLogout}
          />
        </section>
      </main>
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
