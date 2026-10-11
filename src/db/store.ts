import { AppSettings, BlocklistEntry, Client, ClientSnapshot, ImportHistoryRecord } from '../types';

// Acesso à base compartilhada da equipe pelo servidor (/api/data/<operação>).
// Mantém os mesmos nomes e assinaturas que as telas usavam com o IndexedDB.

export const SESSION_EXPIRED_EVENT = 'guardlist:session-expired';

async function call<T>(op: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/data/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: body.error }));
  }
  if (!response.ok) throw new Error(body.error || 'Não foi possível falar com o servidor.');
  return body.result as T;
}

export const initializeDatabaseIfEmpty = () => call<null>('initializeDatabaseIfEmpty');

export const getAllClients = () => call<Client[]>('getAllClients');
export const saveClient = (client: Client) => call<null>('saveClient', client);
export const renameClient = (clientId: string, newName: string) => call<null>('renameClient', clientId, newName);
export const updateClient = (clientId: string, changes: { name?: string; notes?: string }) =>
  call<Client>('updateClient', clientId, changes);
export const deleteClient = (clientId: string, confirmName: string) =>
  call<{ entries: number; snapshots: number; history: number }>('deleteClient', clientId, confirmName);
export const archiveClient = (clientId: string, isArchived: boolean) => call<null>('archiveClient', clientId, isArchived);

export const getClientEntries = (clientId: string, status?: 'active' | 'removed') =>
  call<BlocklistEntry[]>('getClientEntries', clientId, status);

export async function getClientActiveIndicatorsSet(clientId: string): Promise<{ activeSet: Set<string>; activeCidrs: string[] }> {
  const result = await call<{ activeSet: string[]; activeCidrs: string[] }>('getClientActiveIndicatorsSet', clientId);
  return { activeSet: new Set(result.activeSet), activeCidrs: result.activeCidrs };
}

export const bulkInsertEntries = (entries: BlocklistEntry[], clientId: string, lastUpdateDateStr: string) =>
  call<null>('bulkInsertEntries', entries, clientId, lastUpdateDateStr);

export const replaceClientEntries = (newEntries: BlocklistEntry[], clientId: string, lastUpdateDateStr: string) =>
  call<{ added: number; removed: number; previousTotal: number }>('replaceClientEntries', newEntries, clientId, lastUpdateDateStr);

export const updateEntryStatus = (id: string, status: 'active' | 'removed') => call<null>('updateEntryStatus', id, status);
export const updateEntryNotes = (id: string, notes: string) => call<null>('updateEntryNotes', id, notes);
export const bulkDeleteEntries = (ids: string[]) => call<null>('bulkDeleteEntries', ids);

export const createClientSnapshot = (clientId: string, label: string) => call<ClientSnapshot>('createClientSnapshot', clientId, label);
export const getClientSnapshots = (clientId: string) => call<ClientSnapshot[]>('getClientSnapshots', clientId);
export const restoreClientSnapshot = (snapshotId: string) => call<{ restoredCount: number }>('restoreClientSnapshot', snapshotId);
export const deleteClientEntriesAll = (clientId: string) => call<number>('deleteClientEntriesAll', clientId);
export const deleteSnapshot = (snapshotId: string) => call<null>('deleteSnapshot', snapshotId);

export const getDashboardStats = () =>
  call<{
    activeCounts: Record<string, number>;
    ipCounts: Record<string, number>;
    cidrCounts: Record<string, number>;
    totalActiveAcrossAll: number;
    totalIpsAcrossAll: number;
    totalCidrsAcrossAll: number;
    totalCorrelatedIps: number;
    addedThisWeekCount: number;
  }>('getDashboardStats');

export const searchIndicatorAcrossClients = (searchQuery: string) =>
  call<Array<{ client: Client; entry: BlocklistEntry }>>('searchIndicatorAcrossClients', searchQuery);

export const addHistoryRecord = (record: ImportHistoryRecord) => call<null>('addHistoryRecord', record);
export const getHistoryRecords = (clientId?: string) => call<ImportHistoryRecord[]>('getHistoryRecords', clientId);
export const getAllActiveEntries = () => call<BlocklistEntry[]>('getAllActiveEntries');

export const getAppSettings = () => call<AppSettings>('getAppSettings');
export const saveAppSettings = (settings: AppSettings) => call<null>('saveAppSettings', settings);

export const exportFullBackupJSON = () => call<string>('exportFullBackupJSON');
export const restoreFullBackupJSON = (jsonStr: string) =>
  call<{ clientsCount: number; entriesCount: number; historyCount: number }>('restoreFullBackupJSON', jsonStr);

export interface ReportClientRow {
  clientId: string;
  name: string;
  notes: string;
  lastUpdateDate: string | null;
  status: 'em_dia' | 'atrasado' | 'sem_importacao';
  activeNow: number;
  addedInPeriod: number;
  removedInPeriod: number;
  importsInPeriod: number;
  importers: string[];
}

export interface ReportChangeRow {
  action: 'incluido' | 'removido';
  date: string;
  indicator: string;
  type: string;
  ticket: string;
  notes: string;
  by: string;
  currentStatus: 'active' | 'removed';
}

export interface ReportData {
  from: string;
  to: string;
  clientId: string | null;
  generatedAt: string;
  generatedBy: string;
  slaDays: number;
  totals: { clients: number; added: number; removed: number; imports: number; late: number; activeNow: number };
  clients: ReportClientRow[];
  changes: ReportChangeRow[];
  imports: ImportHistoryRecord[];
  activity: Array<{ name: string; imports: number; added: number; removed: number }>;
}

export const getReport = (params: { from: string; to: string; startIso: string; endIso: string; clientId?: string }) =>
  call<ReportData>('getReport', params);
