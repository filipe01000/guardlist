import { API_BASE } from './apiBase';

// Cofre aberto dentro do GuardList (quadro na área de conteúdo, mesmo endereço). Nesse modo ele esconde o
// menu e o fundo próprios, segue o tema do GuardList e avisa o GuardList de que a pessoa está em atividade.
export const FRAMED: boolean = (() => {
  if (!API_BASE) return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const GUARDLIST_THEME_KEY = 'guardlist-theme';

export function readGuardListTheme(): 'dark' | 'light' {
  try {
    return window.localStorage.getItem(GUARDLIST_THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// O GuardList grava o tema no localStorage (mesma origem); a troca chega aqui pelo evento "storage".
export function onGuardListThemeChange(listener: (theme: 'dark' | 'light') => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === GUARDLIST_THEME_KEY) listener(event.newValue === 'light' ? 'light' : 'dark');
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

// A sessão do GuardList expira por inatividade, e o que acontece dentro do quadro não chega a ele.
// Repassa sinais de uso, no máximo a cada 15 s, só para a janela do próprio GuardList.
export function forwardActivityToGuardList(): () => void {
  let last = 0;
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
  const handler = () => {
    const now = Date.now();
    if (now - last < 15_000) return;
    last = now;
    window.parent.postMessage({ type: 'cofre-activity' }, window.location.origin);
  };
  events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
  handler();
  return () => events.forEach((e) => window.removeEventListener(e, handler));
}
