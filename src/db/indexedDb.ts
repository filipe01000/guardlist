/**
 * Camada de Armazenamento Local de Alta Capacidade com IndexedDB
 * Suporta mais de 50.000 entradas por cliente com transações nativas e índices otimizados.
 */

import { Client, BlocklistEntry, ImportHistoryRecord, AppSettings, ClientSnapshot } from '../types';
import { classifyIndicator, checkReservedRange, ipv4ToNumber, getIsoWeek } from '../utils/validator';

const DB_NAME = 'BlocklistManagerDB';
const DB_VERSION = 2;

export const DEFAULT_CLIENTS = [
  'SULGIPE',
  'CREA',
  'UNIT',
  'SANTA CASA',
  'LABCHECAP',
  'EMBASA',
  'DELFINANCE'
];

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Erro ao abrir IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Tabela de Clientes
      if (!db.objectStoreNames.contains('clients')) {
        const clientStore = db.createObjectStore('clients', { keyPath: 'id' });
        clientStore.createIndex('name', 'name', { unique: false });
        clientStore.createIndex('isArchived', 'isArchived', { unique: false });
      }

      // 2. Tabela de Entradas da Blocklist (alta capacidade)
      if (!db.objectStoreNames.contains('entries')) {
        const entryStore = db.createObjectStore('entries', { keyPath: 'id' });
        entryStore.createIndex('clientId', 'clientId', { unique: false });
        entryStore.createIndex('indicator', 'indicator', { unique: false });
        entryStore.createIndex('status', 'status', { unique: false });
        entryStore.createIndex('byClientAndStatus', ['clientId', 'status'], { unique: false });
        entryStore.createIndex('byClientAndIndicator', ['clientId', 'indicator'], { unique: false });
      }

      // 3. Tabela de Histórico de Importações
      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id' });
        historyStore.createIndex('clientId', 'clientId', { unique: false });
        historyStore.createIndex('date', 'date', { unique: false });
        historyStore.createIndex('isoWeek', 'isoWeek', { unique: false });
      }

      // 4. Configurações gerais
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // 5. Tabela de Snapshots / Versões Anteriores (Undo / Rollback de listas)
      if (!db.objectStoreNames.contains('snapshots')) {
        const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
        snapshotStore.createIndex('clientId', 'clientId', { unique: false });
        snapshotStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Inicializa os 7 clientes e dados de teste caso o banco esteja vazio
 */
export async function initializeDatabaseIfEmpty(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['clients', 'entries', 'settings'], 'readwrite');
  const clientStore = tx.objectStore('clients');

  const countRequest = clientStore.count();
  await new Promise<void>((resolve, reject) => {
    countRequest.onsuccess = () => resolve();
    countRequest.onerror = () => reject(countRequest.error);
  });

  if (countRequest.result === 0) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Criar os 7 clientes padrão com perfis de firewall reais e variações
    const firewallProfiles: Record<string, { firewall: string; format: 'nano' | 'raw_txt' | 'csv'; variation: { added: number; removed: number; previousTotal: number } }> = {
      SULGIPE: { firewall: 'FortiGate 100F', format: 'nano', variation: { added: 18, removed: 3, previousTotal: 342 } },
      CREA: { firewall: 'pfSense 2.7', format: 'raw_txt', variation: { added: 45, removed: 0, previousTotal: 580 } },
      UNIT: { firewall: 'Mikrotik RouterOS v7', format: 'nano', variation: { added: 12, removed: 4, previousTotal: 301 } },
      'SANTA CASA': { firewall: 'Palo Alto PA-440', format: 'nano', variation: { added: 92, removed: 5, previousTotal: 1240 } },
      LABCHECAP: { firewall: 'FortiGate 60F', format: 'raw_txt', variation: { added: 28, removed: 2, previousTotal: 415 } },
      EMBASA: { firewall: 'Cisco Firepower 2100', format: 'nano', variation: { added: 145, removed: 10, previousTotal: 2480 } },
      DELFINANCE: { firewall: 'OPNsense 24.1', format: 'nano', variation: { added: 1, removed: 22, previousTotal: 26 } }
    };

    const initialClients: Client[] = DEFAULT_CLIENTS.map((name, index) => {
      // Simular datas de atualização para mostrar o dashboard dinâmico
      // Atrasados: DELFINANCE (12 dias), UNIT (9 dias). Em dia: CREA, SULGIPE, EMBASA, SANTA CASA, LABCHECAP
      const daysAgo = index === 0 ? 3 : index === 1 ? 5 : index === 2 ? 9 : index === 3 ? 2 : index === 4 ? 4 : index === 5 ? 3 : 12;
      const lastUpdate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const profile = firewallProfiles[name] || { firewall: 'Firewall Padrão', format: 'nano', variation: { added: 10, removed: 0, previousTotal: 100 } };

      return {
        id: `client-${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name,
        isArchived: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUpdateDate: lastUpdate,
        targetFirewall: profile.firewall,
        preferredExportFormat: profile.format,
        lastVariation: profile.variation,
        notes: `Firewall ${profile.firewall} • Formato: ${profile.format.toUpperCase()}`
      };
    });

    for (const c of initialClients) {
      clientStore.add(c);
    }

    // Gerar entradas realistas (IPs únicos e blocos CIDR) para cada cliente
    const entryStore = tx.objectStore('entries');
    const sampleIpsPerClient: Record<string, string[]> = {
      SULGIPE: [
        '185.196.220.34', '193.106.191.66', '91.240.118.15', '185.220.101.5', '194.26.29.112',
        '45.143.203.0/24', '185.220.100.0/22', '103.152.220.0/24', '205.210.31.171', '205.210.31.176'
      ],
      CREA: [
        '185.220.101.5', '45.148.10.12', '89.248.165.74', '194.26.29.112', '185.191.171.10',
        '77.247.110.155', '45.154.255.89', '195.154.0.0/16', '185.196.220.0/24', 'c2-beacon-scan.net'
      ],
      UNIT: [
        '185.191.171.10', '162.247.74.200', '198.98.56.142', '45.154.255.89', '185.220.101.5',
        '194.26.29.112', '91.240.118.15', '45.143.203.0/24', '193.106.191.0/24'
      ],
      'SANTA CASA': [
        '45.154.255.89', '194.38.20.7', '178.62.204.11', '195.54.160.21', '185.220.101.5',
        '77.247.110.155', '194.26.29.112', '185.156.73.54', '45.143.203.0/24', '194.38.20.0/23',
        'ransomware-drop.cc'
      ],
      LABCHECAP: [
        '80.82.77.139', '109.237.103.124', '194.26.29.112', '185.156.73.54', '185.220.101.5',
        '185.191.171.10', '91.240.118.15', '109.237.100.0/22', '80.82.76.0/23'
      ],
      EMBASA: [
        '185.156.73.54', '193.142.146.35', '194.26.29.112', '77.247.110.155', '185.220.101.5',
        '45.154.255.89', '185.191.171.10', '193.106.191.66', '45.143.203.0/24', '193.142.144.0/22',
        '2001:db8:85a3::8a2e:370:7334'
      ],
      DELFINANCE: [
        // Lista pequena de apenas 5 itens (com anomalia de queda de 26 para 5 entradas)
        '195.54.160.21', '77.247.110.155', '185.191.171.10', '185.220.101.5', '45.143.203.0/24'
      ]
    };

    for (const client of initialClients) {
      const ips = sampleIpsPerClient[client.name] || ['185.220.101.5'];
      ips.forEach((ip, i) => {
        const classification = classifyIndicator(ip);
        const reserved = checkReservedRange(ip);
        const isIpv4 = classification.type === 'IPv4';

        const entry: BlocklistEntry = {
          id: `entry-${client.id}-${i}-${Date.now()}`,
          clientId: client.id,
          indicator: ip,
          type: classification.type,
          addedDate: client.lastUpdateDate || today,
          sourceTicket: `SEC-${1000 + i}`,
          status: 'active',
          notes: 'Bloqueio adicionado na rotina semanal.',
          isReservedAlert: reserved.isReserved,
          reservedReason: reserved.reason,
          numericValue: isIpv4 ? ipv4ToNumber(ip) : undefined
        };
        entryStore.add(entry);
      });
    }

    // Configurações iniciais
    const settingsStore = tx.objectStore('settings');
    settingsStore.add({
      key: 'app_settings',
      value: {
        slaDays: 7,
        lastBackupDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        sortNumericallyByDefault: true
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// OPERAÇÕES DE CLIENTES
// ==========================================

export async function getAllClients(): Promise<Client[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clients', 'readonly');
    const store = tx.objectStore('clients');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveClient(client: Client): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clients', 'readwrite');
    const store = tx.objectStore('clients');
    store.put(client);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function renameClient(clientId: string, newName: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('clients', 'readwrite');
  const store = tx.objectStore('clients');
  const client: Client = await new Promise((resolve, reject) => {
    const req = store.get(clientId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (client) {
    client.name = newName.trim().toUpperCase();
    client.updatedAt = new Date().toISOString();
    store.put(client);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function archiveClient(clientId: string, isArchived: boolean): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('clients', 'readwrite');
  const store = tx.objectStore('clients');
  const client: Client = await new Promise((resolve, reject) => {
    const req = store.get(clientId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (client) {
    client.isArchived = isArchived;
    client.updatedAt = new Date().toISOString();
    store.put(client);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// OPERAÇÕES DE BLOCKLIST (ENTRIES)
// ==========================================

/**
 * Obtém entradas de um cliente com filtro opcional de status
 */
export async function getClientEntries(
  clientId: string,
  status?: 'active' | 'removed'
): Promise<BlocklistEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');

    if (status) {
      const index = store.index('byClientAndStatus');
      const request = index.getAll(IDBKeyRange.only([clientId, status]));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      const index = store.index('clientId');
      const request = index.getAll(IDBKeyRange.only(clientId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });
}

/**
 * Retorna um Set de indicadores ativos e lista de CIDRs ativos do cliente
 * Usado para verificação e deduplicação ultrarrápida antes da importação
 */
export async function getClientActiveIndicatorsSet(clientId: string): Promise<{
  activeSet: Set<string>;
  activeCidrs: string[];
}> {
  const entries = await getClientEntries(clientId, 'active');
  const activeSet = new Set<string>();
  const activeCidrs: string[] = [];

  for (const entry of entries) {
    activeSet.add(entry.indicator);
    if (entry.type === 'CIDR_v4') {
      activeCidrs.push(entry.indicator);
    }
  }

  return { activeSet, activeCidrs };
}

/**
 * Inserção em lote de novas entradas em uma única transação rápida (Modo Aditivo)
 */
export async function bulkInsertEntries(
  entries: BlocklistEntry[],
  clientId: string,
  lastUpdateDateStr: string
): Promise<void> {
  // Criar snapshot automático antes de modificar a lista para permitir "Desfazer"
  try {
    await createClientSnapshot(clientId, `Antes da importação de ${entries.length} novos itens (${lastUpdateDateStr})`);
  } catch (err) {
    console.warn('Não foi possível gerar snapshot automático antes do insert:', err);
  }

  const db = await getDB();
  const tx = db.transaction(['entries', 'clients'], 'readwrite');
  const entryStore = tx.objectStore('entries');
  const clientStore = tx.objectStore('clients');

  for (const entry of entries) {
    entryStore.add(entry);
  }

  // Atualizar data da última atualização no cliente e variação
  const clientReq = clientStore.get(clientId);
  clientReq.onsuccess = () => {
    const client: Client = clientReq.result;
    if (client) {
      const prevTotal = client.lastVariation?.previousTotal || 0;
      client.lastVariation = {
        added: entries.length,
        removed: 0,
        previousTotal: prevTotal
      };
      client.lastUpdateDate = lastUpdateDateStr;
      client.updatedAt = new Date().toISOString();
      clientStore.put(client);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Modo Substituir Lista:
 * Substitui o conteúdo ativo do cliente pelo novo lote com snapshot automático de segurança
 * e cálculo preciso de variação (+X / -Y).
 */
export async function replaceClientEntries(
  newEntries: BlocklistEntry[],
  clientId: string,
  lastUpdateDateStr: string
): Promise<{ added: number; removed: number; previousTotal: number }> {
  const currentActive = await getClientEntries(clientId, 'active');
  const previousTotal = currentActive.length;

  // Snapshot automático de segurança antes de substituir
  try {
    await createClientSnapshot(clientId, `Segurança antes de substituir lista (${previousTotal} itens)`);
  } catch (err) {
    console.warn('Erro ao criar snapshot antes de substituir:', err);
  }

  const newIndicatorsSet = new Set(newEntries.map(e => e.indicator.toLowerCase()));
  let removedCount = 0;
  let addedCount = 0;

  const db = await getDB();
  const tx = db.transaction(['entries', 'clients'], 'readwrite');
  const entryStore = tx.objectStore('entries');
  const clientStore = tx.objectStore('clients');

  // 1. Marcar como removidos os que não estão na nova lista
  for (const old of currentActive) {
    if (!newIndicatorsSet.has(old.indicator.toLowerCase())) {
      old.status = 'removed';
      old.notes = (old.notes ? old.notes + ' • ' : '') + `Removido na sincronização semanal (${lastUpdateDateStr})`;
      entryStore.put(old);
      removedCount++;
    }
  }

  // 2. Inserir ou atualizar os novos
  const existingActiveMap = new Map(currentActive.map(e => [e.indicator.toLowerCase(), e]));
  for (const n of newEntries) {
    const existing = existingActiveMap.get(n.indicator.toLowerCase());
    if (!existing) {
      entryStore.add(n);
      addedCount++;
    } else if (existing.status !== 'active') {
      existing.status = 'active';
      entryStore.put(existing);
      addedCount++;
    }
  }

  // 3. Atualizar cliente
  const clientReq = clientStore.get(clientId);
  clientReq.onsuccess = () => {
    const client: Client = clientReq.result;
    if (client) {
      client.lastVariation = {
        added: addedCount,
        removed: removedCount,
        previousTotal
      };
      client.lastUpdateDate = lastUpdateDateStr;
      client.updatedAt = new Date().toISOString();
      clientStore.put(client);
    }
  };

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { added: addedCount, removed: removedCount, previousTotal };
}

/**
 * Atualiza status (ex: marcar como 'removed' para soft delete mantendo histórico)
 */
export async function updateEntryStatus(id: string, status: 'active' | 'removed'): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  const req = store.get(id);

  req.onsuccess = () => {
    const entry: BlocklistEntry = req.result;
    if (entry) {
      entry.status = status;
      store.put(entry);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Atualiza observação de uma entrada
 */
export async function updateEntryNotes(id: string, notes: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  const req = store.get(id);

  req.onsuccess = () => {
    const entry: BlocklistEntry = req.result;
    if (entry) {
      entry.notes = notes;
      store.put(entry);
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Exclui definitivamente entradas por ID
 */
export async function bulkDeleteEntries(ids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');

  for (const id of ids) {
    store.delete(id);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==========================================
// SNAPSHOTS E RESTAURAÇÃO DE VERSÕES (UNDO)
// ==========================================

/**
 * Cria um snapshot (versão anterior) da lista inteira de um cliente
 */
export async function createClientSnapshot(clientId: string, label: string): Promise<ClientSnapshot> {
  const db = await getDB();
  const currentEntries = await getClientEntries(clientId);
  const clients = await getAllClients();
  const client = clients.find(c => c.id === clientId);

  const snapshot: ClientSnapshot = {
    id: `snap-${clientId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    clientId,
    clientName: client?.name || 'Cliente',
    createdAt: new Date().toISOString(),
    label: label.trim() || 'Ponto de restauração',
    entriesCount: currentEntries.length,
    entries: currentEntries
  };

  const tx = db.transaction('snapshots', 'readwrite');
  const store = tx.objectStore('snapshots');
  store.put(snapshot);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return snapshot;
}

/**
 * Retorna todos os snapshots de um cliente ordenados do mais recente ao mais antigo
 */
export async function getClientSnapshots(clientId: string): Promise<ClientSnapshot[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const index = store.index('clientId');
    const req = index.getAll(IDBKeyRange.only(clientId));

    req.onsuccess = () => {
      const list = (req.result as ClientSnapshot[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Restaura uma versão anterior da lista de um cliente
 */
export async function restoreClientSnapshot(snapshotId: string): Promise<{ restoredCount: number }> {
  const db = await getDB();

  // 1. Obter o snapshot
  const snapshot: ClientSnapshot = await new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const req = store.get(snapshotId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!snapshot) {
    throw new Error('Versão não encontrada.');
  }

  // 2. Criar snapshot de segurança da lista atual antes de substituir
  await createClientSnapshot(snapshot.clientId, `Segurança antes de restaurar versão de ${new Date(snapshot.createdAt).toLocaleDateString('pt-BR')}`);

  // 3. Deletar todas as entradas atuais do cliente e inserir as do snapshot
  const tx = db.transaction('entries', 'readwrite');
  const entryStore = tx.objectStore('entries');
  const index = entryStore.index('clientId');
  const existingReq = index.getAll(IDBKeyRange.only(snapshot.clientId));

  await new Promise<void>((resolve, reject) => {
    existingReq.onsuccess = () => {
      const currentList: BlocklistEntry[] = existingReq.result;
      for (const item of currentList) {
        entryStore.delete(item.id);
      }
      for (const restored of snapshot.entries) {
        entryStore.put(restored);
      }
      resolve();
    };
    existingReq.onerror = () => reject(existingReq.error);
  });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { restoredCount: snapshot.entries.length };
}

/**
 * Exclui a lista inteira de um cliente (zerar blocklist do cliente)
 * Cria automaticamente um snapshot de segurança antes para permitir desfazer se necessário!
 */
export async function deleteClientEntriesAll(clientId: string): Promise<number> {
  const db = await getDB();
  const currentEntries = await getClientEntries(clientId);
  const count = currentEntries.length;

  if (count > 0) {
    // Snapshot de segurança automático
    await createClientSnapshot(clientId, `Segurança antes de excluir toda a lista (${count} itens)`);

    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    for (const item of currentEntries) {
      store.delete(item.id);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return count;
}

/**
 * Exclui um snapshot específico
 */
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('snapshots', 'readwrite');
  const store = tx.objectStore('snapshots');
  store.delete(snapshotId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Contadores detalhados e operacionais para o Dashboard:
 * Separação estrita de IPs individuais vs Sub-redes CIDR,
 * detecção de correlação cruzada e contadores semanais.
 */
export async function getDashboardStats(): Promise<{
  activeCounts: Record<string, number>;
  ipCounts: Record<string, number>;
  cidrCounts: Record<string, number>;
  totalActiveAcrossAll: number;
  totalIpsAcrossAll: number;
  totalCidrsAcrossAll: number;
  totalCorrelatedIps: number;
  addedThisWeekCount: number;
}> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const index = store.index('status');
    const request = index.getAll(IDBKeyRange.only('active'));

    request.onsuccess = () => {
      const activeEntries: BlocklistEntry[] = request.result;
      const activeCounts: Record<string, number> = {};
      const ipCounts: Record<string, number> = {};
      const cidrCounts: Record<string, number> = {};

      const indicatorClients = new Map<string, Set<string>>();
      let totalIps = 0;
      let totalCidrs = 0;

      // Pegar threshold de 7 dias para "adicionados esta semana"
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      let addedThisWeek = 0;

      for (const entry of activeEntries) {
        const cId = entry.clientId;
        activeCounts[cId] = (activeCounts[cId] || 0) + 1;

        const isCidr = entry.type === 'CIDR_v4' || entry.type === 'CIDR_v6' || entry.indicator.includes('/');

        if (isCidr) {
          cidrCounts[cId] = (cidrCounts[cId] || 0) + 1;
          totalCidrs++;
        } else {
          ipCounts[cId] = (ipCounts[cId] || 0) + 1;
          totalIps++;
        }

        // Correlação
        const ind = entry.indicator.trim().toLowerCase();
        if (!indicatorClients.has(ind)) {
          indicatorClients.set(ind, new Set());
        }
        indicatorClients.get(ind)!.add(cId);

        // Adicionados recentemente
        if (entry.addedDate) {
          const entryTime = new Date(entry.addedDate).getTime();
          if (!isNaN(entryTime) && entryTime >= sevenDaysAgo) {
            addedThisWeek++;
          }
        }
      }

      // Quantos indicadores aparecem em 2 ou mais clientes simultaneamente
      let correlatedCount = 0;
      for (const clientSet of indicatorClients.values()) {
        if (clientSet.size >= 2) {
          correlatedCount++;
        }
      }

      resolve({
        activeCounts,
        ipCounts,
        cidrCounts,
        totalActiveAcrossAll: activeEntries.length,
        totalIpsAcrossAll: totalIps,
        totalCidrsAcrossAll: totalCidrs,
        totalCorrelatedIps: correlatedCount,
        addedThisWeekCount: addedThisWeek
      });
    };
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// CONSULTA RÁPIDA (SEM MISTURAR DADOS)
// ==========================================

export async function searchIndicatorAcrossClients(searchQuery: string): Promise<Array<{
  client: Client;
  entry: BlocklistEntry;
}>> {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return [];

  const db = await getDB();
  const clients = await getAllClients();
  const clientMap = new Map(clients.map(c => [c.id, c]));

  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const request = store.getAll();

    request.onsuccess = () => {
      const all: BlocklistEntry[] = request.result;
      const matches: Array<{ client: Client; entry: BlocklistEntry }> = [];

      for (const entry of all) {
        if (entry.indicator.toLowerCase().includes(q) && entry.status === 'active') {
          const client = clientMap.get(entry.clientId);
          if (client) {
            matches.push({ client, entry });
          }
        }
      }
      resolve(matches);
    };

    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// HISTÓRICO SEMANAL
// ==========================================

export async function addHistoryRecord(record: ImportHistoryRecord): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readwrite');
    const store = tx.objectStore('history');
    store.add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHistoryRecords(clientId?: string): Promise<ImportHistoryRecord[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', 'readonly');
    const store = tx.objectStore('history');

    if (clientId && clientId !== 'ALL') {
      const index = store.index('clientId');
      const req = index.getAll(IDBKeyRange.only(clientId));
      req.onsuccess = () => {
        const sorted = (req.result as ImportHistoryRecord[]).sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    } else {
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result as ImportHistoryRecord[]).sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    }
  });
}

export async function getAllActiveEntries(): Promise<BlocklistEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const index = store.index('status');
    const req = index.getAll(IDBKeyRange.only('active'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==========================================
// CONFIGURAÇÕES & BACKUP COMPLETO
// ==========================================

export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const req = store.get('app_settings');
    req.onsuccess = () => {
      resolve(req.result?.value || {
        slaDays: 7,
        lastBackupDate: null,
        sortNumericallyByDefault: true
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put({ key: 'app_settings', value: settings });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportFullBackupJSON(): Promise<string> {
  const db = await getDB();
  const tx = db.transaction(['clients', 'entries', 'history', 'settings'], 'readonly');

  const clients = await new Promise<Client[]>((res, rej) => {
    const req = tx.objectStore('clients').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const entries = await new Promise<BlocklistEntry[]>((res, rej) => {
    const req = tx.objectStore('entries').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const history = await new Promise<ImportHistoryRecord[]>((res, rej) => {
    const req = tx.objectStore('history').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const settingsReq = await new Promise<any>((res, rej) => {
    const req = tx.objectStore('settings').get('app_settings');
    req.onsuccess = () => res(req.result?.value);
    req.onerror = () => rej(req.error);
  });

  // Atualizar data do último backup
  const now = new Date().toISOString();
  await saveAppSettings({
    slaDays: settingsReq?.slaDays || 7,
    lastBackupDate: now,
    sortNumericallyByDefault: settingsReq?.sortNumericallyByDefault ?? true
  });

  const backupData = {
    app: 'GuardList',
    version: '1.0',
    exportedAt: now,
    clients,
    entries,
    history,
    settings: {
      ...settingsReq,
      lastBackupDate: now
    }
  };

  return JSON.stringify(backupData, null, 2);
}

export async function restoreFullBackupJSON(jsonStr: string): Promise<{
  clientsCount: number;
  entriesCount: number;
  historyCount: number;
}> {
  const data = JSON.parse(jsonStr);
  if (!data || !Array.isArray(data.clients) || !Array.isArray(data.entries)) {
    throw new Error('Arquivo de backup inválido ou corrompido.');
  }

  const db = await getDB();
  const tx = db.transaction(['clients', 'entries', 'history', 'settings'], 'readwrite');

  // Limpar dados anteriores
  tx.objectStore('clients').clear();
  tx.objectStore('entries').clear();
  tx.objectStore('history').clear();

  // Restaurar clientes
  const clientStore = tx.objectStore('clients');
  for (const c of data.clients) {
    clientStore.put(c);
  }

  // Restaurar entradas
  const entryStore = tx.objectStore('entries');
  for (const e of data.entries) {
    entryStore.put(e);
  }

  // Restaurar histórico se houver
  if (Array.isArray(data.history)) {
    const historyStore = tx.objectStore('history');
    for (const h of data.history) {
      historyStore.put(h);
    }
  }

  // Restaurar configurações
  if (data.settings) {
    tx.objectStore('settings').put({ key: 'app_settings', value: data.settings });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    clientsCount: data.clients.length,
    entriesCount: data.entries.length,
    historyCount: (data.history || []).length
  };
}
