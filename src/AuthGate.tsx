import React, { useEffect, useState } from 'react';
import App from './App.tsx';
import { Login } from './components/Login';

type AuthState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; authEnabled: boolean; user: string | null };

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

  useEffect(() => {
    applySavedTheme();
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => setAuth({ status: 'ready', authEnabled: Boolean(body.authEnabled), user: body.user ?? null }))
      .catch(() => setAuth({ status: 'error' }));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAuth({ status: 'ready', authEnabled: true, user: null });
  };

  if (auth.status === 'loading') return null;

  if (auth.status === 'error') {
    return (
      <main className="gl-login-page">
        <p>Não foi possível conectar ao servidor do GuardList. Recarregue a página.</p>
      </main>
    );
  }

  if (auth.authEnabled && !auth.user) {
    return <Login onLogin={(user) => setAuth({ status: 'ready', authEnabled: true, user })} />;
  }

  return <App currentUser={auth.user} onLogout={auth.authEnabled ? handleLogout : undefined} />;
}
