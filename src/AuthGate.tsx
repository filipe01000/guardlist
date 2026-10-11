import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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
      <main className="gl-login-page">
        <section className="data-panel w-full max-w-md p-6 sm:p-7" aria-labelledby="auth-status-title" aria-busy={loading}>
          <div className="flex items-center gap-3 mb-6">
            <img src="/brand/guardlist-mark.png" alt="" className="w-10 h-10 object-contain" />
            <span className="text-xl font-semibold">GuardList</span>
          </div>
          <div role={loading ? 'status' : 'alert'}>
            <h1 id="auth-status-title" className="text-lg font-semibold flex items-center gap-2">
              {loading && <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {loading ? 'Verificando seu acesso…' : 'Não foi possível conectar'}
            </h1>
            <p className="text-sm mt-2" style={{ color: 'var(--text-soft)' }}>
              {loading ? 'Aguarde enquanto carregamos sua sessão.' : 'Não conseguimos verificar sua sessão. Tente novamente em instantes.'}
            </p>
          </div>
          {!loading && (
            <button type="button" className="btn btn--primary mt-5" onClick={loadSession}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </button>
          )}
        </section>
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
