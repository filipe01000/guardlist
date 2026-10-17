import { AppSettings, BlocklistEntry, Client, ClientEntriesPage, ClientEntriesPageParams, ClientException, ClientSnapshot, CorrelationPage, CorrelationPageParams, CtiSummary, DashboardStats, EntryComment, ImportHistoryRecord, ImportOutcome, PendingImport, ReportData } from '../types';
export type { ReportClientRow, ReportChangeRow, ReportData } from '../types';

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
  if (response.status === 401 || (response.status === 403 && body.code === 'PASSWORD_CHANGE_REQUIRED')) {
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

export const getClientEntriesPage = (params: ClientEntriesPageParams) =>
  call<ClientEntriesPage>('getClientEntriesPage', params);

export const getCorrelationPage = (params: CorrelationPageParams = {}) =>
  call<CorrelationPage>('getCorrelationPage', params);

export const getIndicatorEntries = (indicator: string) =>
  call<BlocklistEntry[]>('getIndicatorEntries', indicator);

export async function getClientActiveIndicatorsSet(clientId: string): Promise<{ activeSet: Set<string>; activeCidrs: string[] }> {
  const result = await call<{ activeSet: string[]; activeCidrs: string[] }>('getClientActiveIndicatorsSet', clientId);
  return { activeSet: new Set(result.activeSet), activeCidrs: result.activeCidrs };
}

// Retira repetidos e itens cobertos por CIDR da lista ativa (com versão salva antes).
export const cleanRedundantEntries = (clientId: string) => call<{ retired: number }>('cleanRedundantEntries', clientId);

export const updateEntryStatus = (id: string, status: 'active' | 'removed') => call<null>('updateEntryStatus', id, status);
export const updateEntryNotes = (id: string, notes: string) => call<null>('updateEntryNotes', id, notes);
export const bulkDeleteEntries = (ids: string[]) => call<null>('bulkDeleteEntries', ids);

export const createClientSnapshot = (clientId: string, label: string) => call<ClientSnapshot>('createClientSnapshot', clientId, label);
export const getClientSnapshots = (clientId: string) => call<ClientSnapshot[]>('getClientSnapshots', clientId);
export const restoreClientSnapshot = (snapshotId: string) => call<{ restoredCount: number }>('restoreClientSnapshot', snapshotId);
export const deleteClientEntriesAll = (clientId: string) => call<number>('deleteClientEntriesAll', clientId);
export const deleteSnapshot = (snapshotId: string) => call<null>('deleteSnapshot', snapshotId);

export const getDashboardStats = () => call<DashboardStats>('getDashboardStats');

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

export const getReport = (params: { from: string; to: string; startIso: string; endIso: string; clientId?: string }) =>
  call<ReportData>('getReport', params);

// ---------- Importação com aprovação ----------
export interface ImportBatchPayload {
  clientId: string;
  mode: 'append' | 'replace';
  entries: BlocklistEntry[];
  history: Partial<ImportHistoryRecord>;
  todayStr: string;
  seen: string[];
  /** Bloqueio avulso: não conta como a manutenção do cliente. */
  adHoc?: boolean;
  /** Detalhe da pré-visualização, guardado como relatório da importação. */
  report?: import('../utils/importReport').ImportReportData;
}
export const importBatch = (payload: ImportBatchPayload) => call<ImportOutcome>('importBatch', payload);
export const listPendingImports = () => call<PendingImport[]>('listPendingImports');
export const decidePendingImport = (id: string, decision: 'approve' | 'reject', note?: string) =>
  call<ImportOutcome | null>('decidePendingImport', id, decision, note);
export const undoImport = (snapshotId: string, historyId?: string) => call<{ restoredCount: number }>('undoImport', snapshotId, historyId);

// ---------- Exceções, validação e revisão ----------
export const updateClientExceptions = (clientId: string, exceptions: Array<{ indicator: string; reason?: string }>) =>
  call<{ exceptions: ClientException[]; retired: number }>('updateClientExceptions', clientId, exceptions);

export interface ClientValidation {
  clientId: string;
  name: string;
  active: number;
  duplicates: number;
  covered: number;
  exceptionConflicts: number;
  reviewDue: number;
  samples: string[];
}
export const validateAllClients = () => call<ClientValidation[]>('validateAllClients');
export const cleanAllClients = () =>
  call<{ clients: number; retired: number; results: Array<{ clientId: string; name: string; retired: number }> }>('cleanAllClients');

export interface ReviewItem {
  entry: BlocklistEntry;
  clientName: string;
  lastActivity: string | null;
  daysIdle: number | null;
  lastReportedAt: string | null;
  totalReports: number | null;
  score: number | null;
}
export const getReviewQueue = (clientId?: string) => call<{ reviewDays: number; items: ReviewItem[] }>('getReviewQueue', clientId);
export const reviewEntries = (ids: string[], decision: 'keep' | 'remove') => call<{ count: number }>('reviewEntries', ids, decision);

// ---------- Comentários ----------
export const getComments = (entryId: string) => call<EntryComment[]>('getComments', entryId);
export const addComment = (entryId: string, body: string) => call<EntryComment[]>('addComment', entryId, body);
export const deleteComment = (id: number) => call<EntryComment[]>('deleteComment', id);
export const getCommentCounts = (clientId: string, entryIds?: string[]) =>
  entryIds === undefined ? call<Record<string, number>>('getCommentCounts', clientId)
    : call<Record<string, number>>('getCommentCounts', clientId, entryIds);

// ---------- Auditoria, busca múltipla e evolução ----------
export interface AuditRow {
  id: number;
  at: string;
  username: string | null;
  action: string;
  detail: Record<string, unknown>;
}
export const getAuditLog = (params: { from?: string; to?: string; username?: string; action?: string; q?: string; offset?: number; limit?: number }) =>
  call<{ total: number; rows: AuditRow[]; users: Array<{ username: string; displayName: string }>; actions: string[] }>('getAuditLog', params);

export interface LookupMatch {
  clientId: string;
  clientName: string;
  entryId: string;
  indicator: string;
  status: 'active' | 'removed';
  match: 'exact' | 'covered' | 'inside';
  via?: string;
  addedDate: string;
  sourceTicket?: string;
  notes?: string;
  removedAt?: string;
  addedBy?: string;
}
export interface LookupResult {
  query: string;
  normalized: string;
  valid: boolean;
  matches: LookupMatch[];
}
export const lookupIndicators = (queries: string[]) => call<LookupResult[]>('lookupIndicators', queries);

export interface Evolution {
  points: Array<{ date: string; active: number; added: number; removed: number }>;
  enriched: number;
  activeIps: number;
  missing: string[];
  countries: Array<{ label: string; count: number }>;
  providers: Array<{ label: string; count: number }>;
  verdicts: Array<{ label: string; count: number }>;
}
export const getEvolution = (params?: { weeks?: number; clientId?: string }) => call<Evolution>('getEvolution', params);

// ---------- Rotas fora de /api/data ----------
async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401 || (response.status === 403 && json.code === 'PASSWORD_CHANGE_REQUIRED')) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: json.error }));
  }
  if (!response.ok) throw new Error(json.error || 'Não foi possível falar com o servidor.');
  return json as T;
}

export const enrichIndicators = (indicators: string[], force = false) =>
  http<{ results: Record<string, CtiSummary>; pending: number; configured: boolean }>('POST', '/api/cti/enrich', { indicators, force });

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}
export const listMySessions = () => http<{ sessions: SessionInfo[] }>('GET', '/api/sessions');
export const revokeSession = (id: string) => http<{ ok: true }>('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
export const listUserSessions = (userId: number) => http<{ sessions: SessionInfo[] }>('GET', `/api/users/${userId}/sessions`);
export const revokeAllUserSessions = (userId: number) => http<{ ok: true }>('POST', `/api/users/${userId}/sessions/revoke-all`);
export const unlockUser = (userId: number) => http<{ user: unknown }>('PATCH', `/api/users/${userId}`, { unlock: true });

export const getNotifications = () => http<{ pendingApprovals: number; failedJobs: string[] }>('GET', '/api/notifications');

export interface JobRun {
  job: 'backup' | 'monthly_report';
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  detail: Record<string, unknown> | null;
}
export interface SystemStatus {
  version: string | null;
  uptimeSeconds: number;
  database: { kind: string; ok: boolean; latencyMs?: number; clients?: number; entries?: number; users?: number; error?: string };
  cti: { abuseIpDb: boolean; greyNoise: boolean; otx: boolean; cachedIps: number };
  email: { configured: boolean; reportRecipients: number; backupRecipients: number };
  jobs: JobRun[];
  pendingApprovals: number;
  lastImport: { at: string; client?: string; by?: string; added?: number } | null;
  proxy: { trustProxyHops: unknown; seenIp: string; forwardedChain: string | null; ips: string[] };
  ai?: { configured: boolean; model: string | null; baseUrl: string | null };
}
export const getSystemStatus = () => http<SystemStatus>('GET', '/api/status');
export const testCtiKeys = () => http<{ configured: Record<string, boolean>; result: CtiSummary | null }>('POST', '/api/status/test-cti');
export const testEmail = () => http<{ ok: true; to: string[] }>('POST', '/api/status/test-email');
export const runJob = (job: 'backup' | 'monthly_report') => http<{ ok: true; detail: Record<string, unknown> }>('POST', `/api/status/run/${job}`);

// ---------- Assistente de IA ----------
export type AiEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done'; model: string; ms: number; tokens?: number }
  | { type: 'error'; error: string };

export const getAiStatus = () => http<{ configured: boolean; model: string | null }>('GET', '/api/ai/status');
export const testAi = () =>
  http<{ configured: boolean; model?: string; baseUrl?: string; reply?: string; ms?: number; firstTokenMs?: number | null; tokens?: number | null }>('POST', '/api/status/test-ai');

/** Pergunta à IA e recebe a resposta em partes (uma linha JSON por evento), enquanto ela escreve. */
export async function streamAi(
  path: '/api/ai/chat' | '/api/ai/indicator' | '/api/ai/case-reason',
  body: unknown,
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal
  });
  if (!response.ok || !response.body) {
    const json = await response.json().catch(() => ({}));
    if (response.status === 401 || (response.status === 403 && json.code === 'PASSWORD_CHANGE_REQUIRED')) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: json.error }));
    }
    throw new Error(json.error || 'Não foi possível falar com o assistente.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as AiEvent);
      } catch {
        // linha incompleta ou inválida: ignora
      }
    }
  }
  if (pending.trim()) {
    try { onEvent(JSON.parse(pending) as AiEvent); } catch { /* ignora */ }
  }
}

// ---------- Casos enviados ao cliente ----------
export interface CaseCheckItem {
  indicator: string;
  /** Situação na lista do cliente. */
  list: 'listed' | 'covered' | 'removed' | 'missing';
  via?: string;
  /** Caso anterior em que o indicador (ou um CIDR que o contém) já foi informado. */
  previousCase: { ticket: string; at: string; by: string; via?: string } | null;
}
export interface CaseCheck {
  items: CaseCheckItem[];
  recentCases: Array<{ ticket: string; at: string; by: string; count: number }>;
}
export const checkClientCase = (clientId: string, indicators: string[], ticket?: string) =>
  call<CaseCheck>('checkClientCase', clientId, indicators, ticket);
export const saveClientCase = (clientId: string, ticket: string, indicators: string[]) =>
  call<{ ticket: string; count: number; clientName: string }>('saveClientCase', clientId, ticket, indicators);

// ---------- Relatório de cada importação ----------
export const getImportReport = (historyId: string) =>
  call<{ history: ImportHistoryRecord; report: import('../utils/importReport').ImportReportData | null }>('getImportReport', historyId);
export const listImportReportIds = (clientId?: string) => call<string[]>('listImportReportIds', clientId);
export const setClientLogo = (clientId: string, logo: string | null) => call<null>('setClientLogo', clientId, logo);
export const fetchLogoFromSite = (site: string) => http<{ dataUrl: string; source: string }>('POST', '/api/logo/fetch', { site });
