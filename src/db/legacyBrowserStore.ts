// Leitura dos dados que versões anteriores do GuardList guardavam no IndexedDB deste navegador.
// Só é usada para enviar esses dados para a base compartilhada da equipe; nunca grava nada aqui.

const LEGACY_DB_NAME = 'BlocklistManagerDB';
const STORES = ['clients', 'entries', 'history', 'settings'] as const;

export interface LegacyBrowserData {
  clients: unknown[];
  entries: unknown[];
  history: unknown[];
  settings: unknown;
}

async function legacyDatabaseExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  const list = await indexedDB.databases();
  return list.some((db) => db.name === LEGACY_DB_NAME);
}

export async function readLegacyBrowserData(): Promise<LegacyBrowserData | null> {
  if (!(await legacyDatabaseExists())) return null;

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  try {
    const present = STORES.filter((name) => db.objectStoreNames.contains(name));
    if (!present.includes('clients') || !present.includes('entries')) return null;
    const tx = db.transaction(present, 'readonly');
    const getAll = (name: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const [clients, entries, history, settingsRows] = await Promise.all([
      getAll('clients'),
      getAll('entries'),
      present.includes('history') ? getAll('history') : Promise.resolve([]),
      present.includes('settings') ? getAll('settings') : Promise.resolve([])
    ]);
    if (clients.length === 0) return null;
    const settings = (settingsRows as Array<{ key: string; value: unknown }>).find((row) => row.key === 'app_settings')?.value ?? null;
    return { clients, entries, history, settings };
  } finally {
    db.close();
  }
}
