import { useEffect, useState } from 'react';

// Preferência "mostrar total com CIDRs", lembrada no navegador e igual no Painel geral e na lista do cliente.
// Opcional porque um /16 sozinho já vale 65.536 endereços e distorce a leitura do total.
const KEY = 'guardlist.dashboard.cidrTotal';
const EVENT = 'guardlist:cidr-total';

const read = () => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function useCidrTotalPref(): [boolean, () => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const toggle = () => {
    try { window.localStorage.setItem(KEY, read() ? '0' : '1'); } catch { /* preferência opcional */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, toggle];
}
