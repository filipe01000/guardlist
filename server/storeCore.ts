import type { Query } from './db.ts';
import type {
  AppSettings,
  BlocklistEntry,
  Client,
  ClientSnapshot,
  ImportHistoryRecord,
  ImportOutcome,
  PendingImport
} from '../src/types/index.ts';
import { exceptionHit, findExceptionConflicts, findRedundant } from '../src/utils/redundancy.ts';

// Base do armazenamento (server/store.ts): tipos, erros, validação de entrada e as operações de baixo nível
// sobre clientes, entradas, versões e importação, usadas dentro de createStore.

export interface Actor {
  username: string;
  displayName: string;
  role: 'admin' | 'analyst';
}

export const SNAPSHOTS_PER_CLIENT = 30;
export const DEFAULT_SETTINGS: AppSettings = {
  slaDays: 7,
  lastBackupDate: null,
  sortNumericallyByDefault: true,
  reviewDays: 90,
  approvalThreshold: 500,
  requireApprovalForReplace: true
};

export const exceptionList = (client: Client | null) => (client?.exceptions || []).map((e) => e.indicator);

// Data (YYYY-MM-DD ou ISO) mais recente entre as informadas, em milissegundos.
export function latest(...dates: Array<string | null | undefined>): number {
  let max = 0;
  for (const date of dates) {
    if (!date) continue;
    const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date).getTime();
    if (!Number.isNaN(time) && time > max) max = time;
  }
  return max;
}

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function audit(q: Query, actor: Actor, action: string, detail: Record<string, unknown>) {
  await q('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
    actor.username,
    action,
    JSON.stringify(detail)
  ]);
}

export async function getClient(q: Query, clientId: string): Promise<Client | null> {
  const rows = await q<{ data: Client }>('SELECT data FROM clients WHERE id = $1', [clientId]);
  return rows[0]?.data ?? null;
}

export async function putClient(q: Query, client: Client, actor: Actor) {
  await q(
    `INSERT INTO clients (id, data, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [client.id, JSON.stringify(client), actor.username]
  );
}

export async function entriesOf(q: Query, clientId: string, status?: 'active' | 'removed'): Promise<BlocklistEntry[]> {
  const rows = status
    ? await q<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE client_id = $1 AND status = $2', [clientId, status])
    : await q<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE client_id = $1', [clientId]);
  return rows.map((r) => r.data);
}

export async function upsertEntries(q: Query, entries: BlocklistEntry[], actor: Actor) {
  for (let i = 0; i < entries.length; i += 2000) {
    const chunk = entries.slice(i, i + 2000);
    const saved = await q<{ id: string }>(
      `INSERT INTO entries (id, client_id, indicator, status, data, updated_by)
       SELECT e->>'id', e->>'clientId', e->>'indicator', e->>'status', e, $2
       FROM jsonb_array_elements($1::jsonb) AS e
       ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, indicator = EXCLUDED.indicator,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by
       WHERE entries.client_id = EXCLUDED.client_id
       RETURNING id`,
      [JSON.stringify(chunk), actor.username]
    );
    if (saved.length !== chunk.length) throw new StoreError('Um item deste lote pertence a outro cliente.', 409);
  }
}

export async function snapshot(q: Query, clientId: string, label: string, actor: Actor): Promise<ClientSnapshot> {
  const client = await getClient(q, clientId);
  const entries = await entriesOf(q, clientId);
  const snap: ClientSnapshot = {
    id: `snap-${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientId,
    clientName: client?.name || 'Cliente',
    createdAt: new Date().toISOString(),
    label: label.trim() || 'Ponto de restauração',
    entriesCount: entries.length,
    entries
  };
  await q('INSERT INTO snapshots (id, client_id, created_at, data, created_by) VALUES ($1, $2, $3, $4::jsonb, $5)', [
    snap.id,
    clientId,
    snap.createdAt,
    JSON.stringify(snap),
    actor.username
  ]);
  // Mantém só as versões mais recentes de cada cliente para não estourar o banco.
  await q(
    `DELETE FROM snapshots WHERE client_id = $1 AND id NOT IN (
       SELECT id FROM snapshots WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2)`,
    [clientId, SNAPSHOTS_PER_CLIENT]
  );
  return snap;
}

export async function restoreStoredSnapshot(q: Query, actor: Actor, snapshotId: string, historyId?: string) {
  const rows = await q<{ client_id: string; data: ClientSnapshot }>(
    'SELECT client_id, data FROM snapshots WHERE id = $1 FOR UPDATE', [snapshotId]
  );
  const row = rows[0];
  const snap = row?.data;
  if (!snap) throw new StoreError('Versão não encontrada.', 404);
  if (snap.clientId !== row.client_id || !Array.isArray(snap.entries) || snap.entries.some((e) => e.clientId !== snap.clientId)) {
    throw new StoreError('Versão inválida: os itens pertencem a outro cliente.');
  }
  if (!(await getClient(q, snap.clientId))) throw new StoreError('Cliente não encontrado.', 404);
  if (historyId) {
    const history = await q<{ client_id: string }>('SELECT client_id FROM history WHERE id = $1 FOR UPDATE', [historyId]);
    if (!history[0]) throw new StoreError('Importação não encontrada.', 404);
    if (history[0].client_id !== snap.clientId) throw new StoreError('A versão e a importação precisam ser do mesmo cliente.');
  }
  await snapshot(q, snap.clientId, `Segurança antes de restaurar versão de ${new Date(snap.createdAt).toLocaleDateString('pt-BR')}`, actor);
  await q('DELETE FROM entries WHERE client_id = $1', [snap.clientId]);
  await upsertEntries(q, snap.entries, actor);
  await audit(q, actor, 'snapshot.restore', { clientId: snap.clientId, snapshotId, count: snap.entries.length });
  if (historyId) {
    await q(
      `UPDATE history SET data = data || jsonb_build_object('undone', true, 'notes',
         coalesce(data->>'notes' || ' • ', '') || $2::text) WHERE id = $1`,
      [historyId, `Desfeito por ${actor.displayName}`]
    );
  }
  return { restoredCount: snap.entries.length };
}

// Retira da lista ativa o que está repetido ou contido em um CIDR maior da mesma lista.
// Fica o item mais abrangente; entre iguais, o mais antigo. O retirado vira 'removido' com o motivo na observação.
export async function retireRedundant(q: Query, clientId: string, actor: Actor): Promise<number> {
  const active = (await entriesOf(q, clientId, 'active')).sort(
    (a, b) => String(a.addedDate || '').localeCompare(String(b.addedDate || '')) || a.id.localeCompare(b.id)
  );
  const client = await getClient(q, clientId);
  const reasons = new Map<BlocklistEntry, string>();
  for (const { item, exception } of findExceptionConflicts(active, (e) => e.indicator, exceptionList(client))) {
    reasons.set(item, `Conflita com a exceção ${exception}`);
  }
  const remaining = active.filter((e) => !reasons.has(e));
  for (const { item, coveredBy, reason } of findRedundant(remaining, (e) => e.indicator)) {
    reasons.set(item, reason === 'duplicate' ? `Repetido de ${coveredBy}` : `Coberto pelo CIDR ${coveredBy}`);
  }
  if (reasons.size === 0) return 0;
  const now = new Date().toISOString();
  const retired = [...reasons].map(([item, why]) => ({
    ...item,
    status: 'removed' as const,
    removedAt: now,
    removedBy: actor.displayName,
    notes: (item.notes ? `${item.notes} • ` : '') + why
  }));
  await upsertEntries(q, retired, actor);
  await audit(q, actor, 'entries.dedupe', { clientId, name: client?.name, removed: retired.length });
  return retired.length;
}

export interface ImportPayload {
  clientId: string;
  mode: 'append' | 'replace';
  entries: BlocklistEntry[];
  history: ImportHistoryRecord;
  todayStr: string;
  seen: string[];
  /** Bloqueio avulso (menu de ações): não conta como a manutenção do cliente. */
  adHoc?: boolean;
  /** Detalhe da pré-visualização (relatório da importação). */
  report?: Record<string, unknown>;
}

export function parseImportPayload(raw: unknown): ImportPayload {
  const input = (raw || {}) as Record<string, unknown>;
  const clientId = asString(input.clientId, 'clientId');
  const entries = asArray<BlocklistEntry>(input.entries, 'entries');
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.indicator !== 'string') throw new StoreError('Item inválido no lote.');
  }
  const history = (input.history && typeof input.history === 'object' ? input.history : {}) as ImportHistoryRecord;
  const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(String(input.todayStr)) ? String(input.todayStr) : new Date().toISOString().slice(0, 10);
  const seen = Array.isArray(input.seen) ? input.seen.filter((x): x is string => typeof x === 'string').slice(0, 100_000) : [];
  // Relatório da importação: aceito como veio, com limite de tamanho (o detalhe é só informativo).
  const report = input.report && typeof input.report === 'object' && !Array.isArray(input.report) && JSON.stringify(input.report).length < 6_000_000
    ? (input.report as Record<string, unknown>)
    : undefined;
  return { clientId, mode: input.mode === 'replace' ? 'replace' : 'append', entries, history, todayStr, seen, adHoc: input.adHoc === true, report };
}

// Grava um lote já aprovado: respeita as exceções do cliente, salva uma versão antes, atualiza "visto por último",
// retira redundâncias e registra o histórico. `author` é quem assina a inclusão (o solicitante, numa aprovação).
export async function executeImport(q: Query, author: Actor, payload: ImportPayload, extraNote?: string): Promise<ImportOutcome> {
  const { clientId, mode, todayStr } = payload;
  const client = await getClient(q, clientId);
  if (!client) throw new StoreError('Cliente não encontrado.', 404);
  const exceptions = exceptionList(client);
  const list = payload.entries
    .map((e) => ({ ...e, clientId, addedBy: author.displayName, status: 'active' as const }))
    .filter((e) => !exceptionHit(e.indicator, exceptions));
  const blockedByException = payload.entries.length - list.length;

  const currentActive = await entriesOf(q, clientId, 'active');
  const previousTotal = currentActive.length;
  const snap = await snapshot(
    q,
    clientId,
    mode === 'replace'
      ? `Segurança antes de substituir lista (${previousTotal} itens)`
      : `Antes da importação de ${list.length} novos itens (${todayStr})`,
    author
  );

  let added = 0;
  let removed = 0;
  const removedIndicators: string[] = [];
  const now = new Date().toISOString();
  const existing = new Map(currentActive.map((e) => [e.indicator.toLowerCase(), e]));
  if (mode === 'replace') {
    const incoming = new Set(list.map((e) => e.indicator.toLowerCase()));
    const changed: BlocklistEntry[] = [];
    for (const old of currentActive) {
      if (!incoming.has(old.indicator.toLowerCase())) {
        changed.push({
          ...old,
          status: 'removed',
          removedAt: now,
          removedBy: author.displayName,
          notes: (old.notes ? `${old.notes} • ` : '') + `Removido na sincronização semanal (${todayStr})`
        });
        removed++;
        removedIndicators.push(old.indicator);
      }
    }
    for (const entry of list) {
      if (!existing.has(entry.indicator.toLowerCase())) {
        changed.push(entry);
        added++;
      }
    }
    await upsertEntries(q, changed, author);
  } else {
    const fresh = list.filter((e) => !existing.has(e.indicator.toLowerCase()));
    added = fresh.length;
    await upsertEntries(q, fresh, author);
  }

  // Quem reapareceu neste lote volta a contar como visto (sai da fila de revisão).
  const seen = new Set(payload.seen.map((x) => x.toLowerCase()));
  if (mode === 'replace') for (const e of list) if (existing.has(e.indicator.toLowerCase())) seen.add(e.indicator.toLowerCase());
  if (seen.size > 0) {
    await q(
      `UPDATE entries SET data = data || jsonb_build_object('lastSeenAt', $3::text)
       WHERE client_id = $1 AND status = 'active' AND lower(indicator) = ANY($2::text[])`,
      [clientId, [...seen], now]
    );
  }

  const retired = await retireRedundant(q, clientId, author);
  removed += retired;
  const totalAfter = (await q<{ n: number }>("SELECT count(*)::int AS n FROM entries WHERE client_id = $1 AND status = 'active'", [clientId]))[0]?.n ?? 0;

  // Bloqueio avulso não muda a data da manutenção semanal nem a variação da semana.
  await putClient(q, payload.adHoc ? { ...client, updatedAt: now } : { ...client, lastVariation: { added, removed, previousTotal }, lastUpdateDate: todayStr, updatedAt: now }, author);

  const notes = [payload.history.notes, mode === 'replace' ? `Modo Substituir (-${removed - retired} itens arquivados)` : '',
    retired > 0 ? `${retired} retirados por repetição, cobertura de CIDR ou exceção` : '',
    blockedByException > 0 ? `${blockedByException} recusados por estarem nas exceções do cliente` : '', extraNote || '']
    .filter(Boolean).join(' • ');
  const historyId = typeof payload.history.id === 'string' && payload.history.id ? payload.history.id : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record: ImportHistoryRecord = {
    ...payload.history,
    id: historyId,
    date: now,
    clientId,
    clientName: client.name,
    totalBefore: previousTotal,
    addedCount: added,
    totalAfter,
    notes: notes || undefined,
    importedBy: author.displayName
  };
  await q(
    'INSERT INTO history (id, client_id, happened_at, data, created_by) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (id) DO NOTHING',
    [historyId, clientId, now, JSON.stringify(record), author.username]
  );
  if (payload.report) {
    const report = { ...payload.report, removed: removedIndicators, result: { added, retired, removed, blockedByException, totalBefore: previousTotal, totalAfter } };
    await q(
      'INSERT INTO import_reports (history_id, client_id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (history_id) DO UPDATE SET data = EXCLUDED.data',
      [historyId, clientId, JSON.stringify(report)]
    );
  }
  await audit(q, author, 'entries.import', { clientId, name: client.name, added, removed, mode, blockedByException });
  return { status: 'done', added, retired, removed, blockedByException, snapshotId: snap.id, historyId };
}

export function toPendingImport(row: { id: string; client_id: string; mode: string; data: Record<string, any>; requested_by: string; requested_at: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null }, clientName: string): PendingImport {
  const entries = (row.data.entries || []) as BlocklistEntry[];
  return {
    id: row.id,
    clientId: row.client_id,
    clientName,
    mode: row.mode === 'replace' ? 'replace' : 'append',
    itemCount: entries.length,
    requestedBy: row.requested_by,
    requestedByName: row.data.requestedByName || row.requested_by,
    requestedAt: new Date(row.requested_at).toISOString(),
    status: row.status as PendingImport['status'],
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    decisionNote: row.decision_note,
    sourceTicket: row.data.history?.sourceTicket,
    notes: row.data.history?.notes,
    sample: entries.slice(0, 12).map((e) => e.indicator)
  };
}

export function requireAdmin(actor: Actor) {
  if (actor.role !== 'admin') throw new StoreError('Apenas administradores podem fazer isso.', 403);
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new StoreError(`Campo inválido: ${field}.`);
  return value;
}

export function asArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) throw new StoreError(`Campo inválido: ${field}.`);
  return value as T[];
}

export function pageNumber(value: unknown, fallback: number, max = 1_000_000): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : fallback;
}

// Cada indicador conta uma vez por cliente; todas as estatísticas ficam no banco.
export const CORRELATION_CTE = `
  WITH active_clients AS (
    SELECT id, coalesce(data->>'name', id) AS name,
           coalesce(nullif(data->>'targetFirewall', ''), 'Firewall Padrão') AS firewall
    FROM clients WHERE coalesce(data->>'isArchived', 'false') <> 'true'
  ), members AS (
    SELECT trim(e.indicator) AS indicator, e.client_id, c.name, c.firewall,
           min(coalesce(e.data->>'type', 'IPv4')) AS type
    FROM entries e JOIN active_clients c ON c.id = e.client_id
    WHERE e.status = 'active' AND trim(e.indicator) <> ''
    GROUP BY trim(e.indicator), e.client_id, c.name, c.firewall
  ), shared AS (
    SELECT indicator, min(type) AS type,
           array_agg(client_id ORDER BY client_id) AS client_ids,
           array_agg(name ORDER BY client_id) AS client_names,
           array_agg(DISTINCT firewall ORDER BY firewall) AS firewalls,
           count(*)::int AS occurrences,
           CASE WHEN count(*) >= 4 THEN 'critical' WHEN count(*) = 3 THEN 'high' ELSE 'medium' END AS severity
    FROM members GROUP BY indicator HAVING count(*) >= 2
  )`;
