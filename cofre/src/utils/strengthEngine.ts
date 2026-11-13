import { useSyncExternalStore } from 'react';
import type zxcvbnFn from 'zxcvbn';

type Zxcvbn = typeof zxcvbnFn;

// O zxcvbn traz dicionários de uns 800 KB, mais da metade do JavaScript do app. Ele carrega em
// paralelo, fora do caminho da primeira tela. O app pede o carregamento ao abrir e espera por ele
// antes de mostrar o cofre aberto.
let engine: Zxcvbn | null = null;
let loading: Promise<Zxcvbn> | null = null;
const listeners = new Set<() => void>();

export function loadStrengthEngine(): Promise<Zxcvbn> {
  if (engine) return Promise.resolve(engine);
  if (!loading) {
    loading = import('zxcvbn')
      .then((mod) => {
        const loaded =
          (mod as unknown as { default?: Zxcvbn }).default ??
          (mod as unknown as Zxcvbn);
        engine = loaded;
        listeners.forEach((listener) => listener());
        return loaded;
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

export function getStrengthEngine(): Zxcvbn | null {
  return engine;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const isReady = () => engine !== null;

/** Faz o componente desenhar de novo quando o medidor termina de carregar. */
export function useStrengthEngineReady(): boolean {
  return useSyncExternalStore(subscribe, isReady, isReady);
}
