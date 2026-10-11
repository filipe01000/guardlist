import type { Database, Query } from './db.ts';
import type {
  AppSettings,
  BlocklistEntry,
  Client,
  ClientSnapshot,
  ImportHistoryRecord
} from '../src/types/index.ts';

// Operações da base compartilhada da equipe. Espelham as funções que o app usava no IndexedDB,
// agora no Postgres, registrando quem fez cada alteração.

export interface Actor {
  username: string;
  displayName: string;
  role: 'admin' | 'analyst';
}

const SNAPSHOTS_PER_CLIENT = 30;
const DEFAULT_SETTINGS: AppSettings = { slaDays: 7, lastBackupDate: null, sortNumericallyByDefault: true };

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function audit(q: Query, actor: Actor, action: string, detail: Record<string, unknown>) {
  await q('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
    actor.username,
    action,
    JSON.stringify(detail)
  ]);
}

async function getClient(q: Query, clientId: string): Promise<Client | null> {
  const rows = await q<{ data: Client }>('SELECT data FROM clients WHERE id = $1', [clientId]);
  return rows[0]?.data ?? null;
}

async function putClient(q: Query, client: Client, actor: Actor) {
  await q(
    `INSERT INTO clients (id, data, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [client.id, JSON.stringify(client), actor.username]
  );
}

async function entriesOf(q: Query, clientId: string, status?: 'active' | 'removed'): Promise<BlocklistEntry[]> {
  const rows = status
    ? await q<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE client_id = $1 AND status = $2', [clientId, status])
    : await q<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE client_id = $1', [clientId]);
  return rows.map((r) => r.data);
}

async function upsertEntries(q: Query, entries: BlocklistEntry[], actor: Actor) {
  for (let i = 0; i < entries.length; i += 2000) {
    const chunk = entries.slice(i, i + 2000);
    await q(
      `INSERT INTO entries (id, client_id, indicator, status, data, updated_by)
       SELECT e->>'id', e->>'clientId', e->>'indicator', e->>'status', e, $2
       FROM jsonb_array_elements($1::jsonb) AS e
       ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, indicator = EXCLUDED.indicator,
         status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(chunk), actor.username]
    );
  }
}

async function snapshot(q: Query, clientId: string, label: string, actor: Actor): Promise<ClientSnapshot> {
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

function requireAdmin(actor: Actor) {
  if (actor.role !== 'admin') throw new StoreError('Apenas administradores podem fazer isso.', 403);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new StoreError(`Campo inválido: ${field}.`);
  return value;
}

function asArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) throw new StoreError(`Campo inválido: ${field}.`);
  return value as T[];
}

export function createStore(db: Database) {
  const ops = {
    async initializeDatabaseIfEmpty() {
      return null;
    },

    async getAllClients() {
      const rows = await db.query<{ data: Client }>("SELECT data FROM clients ORDER BY data->>'name'");
      return rows.map((r) => r.data);
    },

    async saveClient(actor: Actor, client: Client) {
      asString(client?.id, 'id');
      asString(client?.name, 'name');
      await db.tx(async (q) => {
        await putClient(q, client, actor);
        await audit(q, actor, 'client.save', { clientId: client.id, name: client.name });
      });
      return null;
    },

    async renameClient(actor: Actor, clientId: string, newName: string) {
      const name = asString(newName, 'name').trim().toUpperCase();
      await db.tx(async (q) => {
        const client = await getClient(q, clientId);
        if (!client) return;
        const previous = client.name;
        await putClient(q, { ...client, name, updatedAt: new Date().toISOString() }, actor);
        await audit(q, actor, 'client.rename', { clientId, from: previous, to: name });
      });
      return null;
    },

    // Edição parcial: altera só nome e/ou observações, sem regravar dados que outra pessoa possa ter mudado.
    async updateClient(actor: Actor, clientId: string, changes: { name?: unknown; notes?: unknown }) {
      return db.tx(async (q) => {
        const client = await getClient(q, asString(clientId, 'clientId'));
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        const next: Client = { ...client, updatedAt: new Date().toISOString() };
        const detail: Record<string, unknown> = { clientId, name: client.name };

        if (changes?.name !== undefined) {
          const name = String(changes.name).trim().toUpperCase().slice(0, 80);
          if (!name) throw new StoreError('Informe o nome do cliente.');
          const clash = await q<{ id: string }>("SELECT id FROM clients WHERE upper(data->>'name') = $1 AND id <> $2", [name, clientId]);
          if (clash.length) throw new StoreError('Já existe outro cliente com esse nome.', 409);
          if (name !== client.name) detail.renamedTo = name;
          next.name = name;
        }
        if (changes?.notes !== undefined) {
          const notes = String(changes.notes ?? '').trim().slice(0, 1000);
          next.notes = notes || undefined;
          detail.notesChanged = (client.notes || '') !== notes;
        }

        await putClient(q, next, actor);
        await audit(q, actor, 'client.update', detail);
        return next;
      });
    },

    async archiveClient(actor: Actor, clientId: string, isArchived: boolean) {
      await db.tx(async (q) => {
        const client = await getClient(q, clientId);
        if (!client) return;
        await putClient(q, { ...client, isArchived: Boolean(isArchived), updatedAt: new Date().toISOString() }, actor);
        await audit(q, actor, isArchived ? 'client.archive' : 'client.unarchive', { clientId, name: client.name });
      });
      return null;
    },

    async getClientEntries(_actor: Actor, clientId: string, status?: 'active' | 'removed') {
      return entriesOf(db.query, asString(clientId, 'clientId'), status);
    },

    async getClientActiveIndicatorsSet(_actor: Actor, clientId: string) {
      const entries = await entriesOf(db.query, asString(clientId, 'clientId'), 'active');
      return {
        activeSet: entries.map((e) => e.indicator),
        activeCidrs: entries.filter((e) => e.type === 'CIDR_v4').map((e) => e.indicator)
      };
    },

    async bulkInsertEntries(actor: Actor, entries: BlocklistEntry[], clientId: string, lastUpdateDateStr: string) {
      const list = asArray<BlocklistEntry>(entries, 'entries').map((e) => ({ ...e, clientId, addedBy: actor.displayName }));
      await db.tx(async (q) => {
        const client = await getClient(q, clientId);
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        await snapshot(q, clientId, `Antes da importação de ${list.length} novos itens (${lastUpdateDateStr})`, actor);
        await upsertEntries(q, list, actor);
        await putClient(
          q,
          {
            ...client,
            lastVariation: { added: list.length, removed: 0, previousTotal: client.lastVariation?.previousTotal || 0 },
            lastUpdateDate: lastUpdateDateStr,
            updatedAt: new Date().toISOString()
          },
          actor
        );
        await audit(q, actor, 'entries.import', { clientId, name: client.name, added: list.length, mode: 'append' });
      });
      return null;
    },

    async replaceClientEntries(actor: Actor, newEntries: BlocklistEntry[], clientId: string, lastUpdateDateStr: string) {
      const list = asArray<BlocklistEntry>(newEntries, 'entries').map((e) => ({ ...e, clientId, addedBy: actor.displayName }));
      return db.tx(async (q) => {
        const client = await getClient(q, clientId);
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        const currentActive = await entriesOf(q, clientId, 'active');
        const previousTotal = currentActive.length;
        await snapshot(q, clientId, `Segurança antes de substituir lista (${previousTotal} itens)`, actor);

        const incoming = new Set(list.map((e) => e.indicator.toLowerCase()));
        const existing = new Map(currentActive.map((e) => [e.indicator.toLowerCase(), e]));
        const changed: BlocklistEntry[] = [];
        let removed = 0;
        let added = 0;

        for (const old of currentActive) {
          if (!incoming.has(old.indicator.toLowerCase())) {
            changed.push({
              ...old,
              status: 'removed',
              removedAt: new Date().toISOString(),
              removedBy: actor.displayName,
              notes: (old.notes ? `${old.notes} • ` : '') + `Removido na sincronização semanal (${lastUpdateDateStr})`
            });
            removed++;
          }
        }
        for (const entry of list) {
          if (!existing.has(entry.indicator.toLowerCase())) {
            changed.push(entry);
            added++;
          }
        }
        await upsertEntries(q, changed, actor);
        await putClient(
          q,
          { ...client, lastVariation: { added, removed, previousTotal }, lastUpdateDate: lastUpdateDateStr, updatedAt: new Date().toISOString() },
          actor
        );
        await audit(q, actor, 'entries.import', { clientId, name: client.name, added, removed, mode: 'replace' });
        return { added, removed, previousTotal };
      });
    },

    async updateEntryStatus(actor: Actor, id: string, status: 'active' | 'removed') {
      if (status !== 'active' && status !== 'removed') throw new StoreError('Situação inválida.');
      await db.tx(async (q) => {
        await q(
          `UPDATE entries SET status = $2,
             data = CASE WHEN $2 = 'removed'
               THEN data || jsonb_build_object('status', $2::text, 'removedAt', to_jsonb(now()), 'removedBy', $4::text)
               ELSE (data - 'removedAt' - 'removedBy') || jsonb_build_object('status', $2::text) END,
             updated_at = now(), updated_by = $3 WHERE id = $1`,
          [id, status, actor.username, actor.displayName]
        );
        await audit(q, actor, 'entry.status', { id, status });
      });
      return null;
    },

    async updateEntryNotes(actor: Actor, id: string, notes: string) {
      await db.query(
        `UPDATE entries SET data = jsonb_set(data, '{notes}', to_jsonb($2::text)), updated_at = now(), updated_by = $3 WHERE id = $1`,
        [id, String(notes ?? ''), actor.username]
      );
      return null;
    },

    async bulkDeleteEntries(actor: Actor, ids: string[]) {
      const list = asArray<string>(ids, 'ids');
      await db.tx(async (q) => {
        await q('DELETE FROM entries WHERE id = ANY($1::text[])', [list]);
        await audit(q, actor, 'entries.delete', { count: list.length });
      });
      return null;
    },

    async createClientSnapshot(actor: Actor, clientId: string, label: string) {
      return db.tx((q) => snapshot(q, asString(clientId, 'clientId'), String(label ?? ''), actor));
    },

    async getClientSnapshots(_actor: Actor, clientId: string) {
      const rows = await db.query<{ data: ClientSnapshot }>(
        'SELECT data FROM snapshots WHERE client_id = $1 ORDER BY created_at DESC',
        [clientId]
      );
      return rows.map((r) => r.data);
    },

    async restoreClientSnapshot(actor: Actor, snapshotId: string) {
      return db.tx(async (q) => {
        const rows = await q<{ data: ClientSnapshot }>('SELECT data FROM snapshots WHERE id = $1', [snapshotId]);
        const snap = rows[0]?.data;
        if (!snap) throw new StoreError('Versão não encontrada.', 404);
        await snapshot(q, snap.clientId, `Segurança antes de restaurar versão de ${new Date(snap.createdAt).toLocaleDateString('pt-BR')}`, actor);
        await q('DELETE FROM entries WHERE client_id = $1', [snap.clientId]);
        await upsertEntries(q, snap.entries, actor);
        await audit(q, actor, 'snapshot.restore', { clientId: snap.clientId, snapshotId, count: snap.entries.length });
        return { restoredCount: snap.entries.length };
      });
    },

    async deleteClientEntriesAll(actor: Actor, clientId: string) {
      return db.tx(async (q) => {
        const count = (await entriesOf(q, clientId)).length;
        if (count > 0) {
          await snapshot(q, clientId, `Segurança antes de excluir toda a lista (${count} itens)`, actor);
          await q('DELETE FROM entries WHERE client_id = $1', [clientId]);
          await audit(q, actor, 'entries.clear', { clientId, count });
        }
        return count;
      });
    },

    async deleteSnapshot(actor: Actor, snapshotId: string) {
      await db.tx(async (q) => {
        await q('DELETE FROM snapshots WHERE id = $1', [snapshotId]);
        await audit(q, actor, 'snapshot.delete', { snapshotId });
      });
      return null;
    },

    async getDashboardStats() {
      const entries = await ops.getAllActiveEntries();
      const activeCounts: Record<string, number> = {};
      const ipCounts: Record<string, number> = {};
      const cidrCounts: Record<string, number> = {};
      const indicatorClients = new Map<string, Set<string>>();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let totalIps = 0;
      let totalCidrs = 0;
      let addedThisWeek = 0;

      for (const entry of entries) {
        const id = entry.clientId;
        activeCounts[id] = (activeCounts[id] || 0) + 1;
        const isCidr = entry.type === 'CIDR_v4' || entry.type === 'CIDR_v6' || entry.indicator.includes('/');
        if (isCidr) {
          cidrCounts[id] = (cidrCounts[id] || 0) + 1;
          totalCidrs++;
        } else {
          ipCounts[id] = (ipCounts[id] || 0) + 1;
          totalIps++;
        }
        const key = entry.indicator.trim().toLowerCase();
        if (!indicatorClients.has(key)) indicatorClients.set(key, new Set());
        indicatorClients.get(key)!.add(id);
        const added = entry.addedDate ? new Date(entry.addedDate).getTime() : NaN;
        if (!Number.isNaN(added) && added >= weekAgo) addedThisWeek++;
      }

      let correlated = 0;
      for (const set of indicatorClients.values()) if (set.size >= 2) correlated++;

      return {
        activeCounts,
        ipCounts,
        cidrCounts,
        totalActiveAcrossAll: entries.length,
        totalIpsAcrossAll: totalIps,
        totalCidrsAcrossAll: totalCidrs,
        totalCorrelatedIps: correlated,
        addedThisWeekCount: addedThisWeek
      };
    },

    async searchIndicatorAcrossClients(_actor: Actor, searchQuery: string) {
      const q = String(searchQuery ?? '').trim().toLowerCase();
      if (!q) return [];
      const rows = await db.query<{ entry: BlocklistEntry; client: Client }>(
        `SELECT e.data AS entry, c.data AS client FROM entries e JOIN clients c ON c.id = e.client_id
         WHERE e.status = 'active' AND lower(e.indicator) LIKE '%' || $1 || '%' LIMIT 500`,
        [q]
      );
      return rows.map((r) => ({ client: r.client, entry: r.entry }));
    },

    async addHistoryRecord(actor: Actor, record: ImportHistoryRecord) {
      const data = { ...record, importedBy: actor.displayName || actor.username };
      await db.query(
        'INSERT INTO history (id, client_id, happened_at, data, created_by) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (id) DO NOTHING',
        [asString(record?.id, 'id'), record.clientId, record.date, JSON.stringify(data), actor.username]
      );
      return null;
    },

    async getHistoryRecords(_actor: Actor, clientId?: string) {
      const rows =
        clientId && clientId !== 'ALL'
          ? await db.query<{ data: ImportHistoryRecord }>('SELECT data FROM history WHERE client_id = $1 ORDER BY happened_at DESC', [clientId])
          : await db.query<{ data: ImportHistoryRecord }>('SELECT data FROM history ORDER BY happened_at DESC');
      return rows.map((r) => r.data);
    },

    async getAllActiveEntries() {
      const rows = await db.query<{ data: BlocklistEntry }>("SELECT data FROM entries WHERE status = 'active'");
      return rows.map((r) => r.data);
    },

    async getAppSettings(): Promise<AppSettings> {
      const rows = await db.query<{ data: AppSettings }>("SELECT data FROM settings WHERE key = 'app_settings'");
      return { ...DEFAULT_SETTINGS, ...(rows[0]?.data ?? {}) };
    },

    async saveAppSettings(actor: Actor, settings: AppSettings) {
      await db.tx(async (q) => {
        await q(
          `INSERT INTO settings (key, data) VALUES ('app_settings', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
          [JSON.stringify({ ...DEFAULT_SETTINGS, ...settings })]
        );
        await audit(q, actor, 'settings.save', { slaDays: settings?.slaDays });
      });
      return null;
    },

    async exportFullBackupJSON(actor: Actor) {
      const [clients, entries, history, settings] = await Promise.all([
        ops.getAllClients(),
        db.query<{ data: BlocklistEntry }>('SELECT data FROM entries').then((r) => r.map((x) => x.data)),
        ops.getHistoryRecords(actor),
        ops.getAppSettings()
      ]);
      const now = new Date().toISOString();
      await ops.saveAppSettings(actor, { ...settings, lastBackupDate: now });
      return JSON.stringify(
        { app: 'GuardList', version: '2.0', exportedAt: now, exportedBy: actor.username, clients, entries, history, settings: { ...settings, lastBackupDate: now } },
        null,
        2
      );
    },

    async restoreFullBackupJSON(actor: Actor, jsonStr: string) {
      requireAdmin(actor);
      let data: { clients?: Client[]; entries?: BlocklistEntry[]; history?: ImportHistoryRecord[]; settings?: AppSettings };
      try {
        data = JSON.parse(String(jsonStr));
      } catch {
        throw new StoreError('Arquivo de backup inválido ou corrompido.');
      }
      if (!data || !Array.isArray(data.clients) || !Array.isArray(data.entries)) {
        throw new StoreError('Arquivo de backup inválido ou corrompido.');
      }
      const clients = data.clients;
      const entries = data.entries;
      const history = Array.isArray(data.history) ? data.history : [];
      await db.tx(async (q) => {
        await q('DELETE FROM entries');
        await q('DELETE FROM clients');
        await q('DELETE FROM history');
        for (const client of clients) await putClient(q, client, actor);
        await upsertEntries(q, entries, actor);
        for (const record of history) {
          await q('INSERT INTO history (id, client_id, happened_at, data, created_by) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (id) DO NOTHING', [
            record.id,
            record.clientId,
            record.date,
            JSON.stringify(record),
            actor.username
          ]);
        }
        if (data.settings) {
          await q(
            `INSERT INTO settings (key, data) VALUES ('app_settings', $1::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
            [JSON.stringify({ ...DEFAULT_SETTINGS, ...data.settings })]
          );
        }
        await audit(q, actor, 'backup.restore', { clients: clients.length, entries: entries.length, history: history.length });
      });
      return { clientsCount: clients.length, entriesCount: entries.length, historyCount: history.length };
    },

    // Relatório de um período: geral (todos os clientes) ou de um cliente.
    // from/to são datas locais (YYYY-MM-DD, inclusivas); startIso/endIso delimitam o mesmo intervalo em instantes.
    async getReport(actor: Actor, params: { from?: unknown; to?: unknown; startIso?: unknown; endIso?: unknown; clientId?: unknown }) {
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const from = String(params?.from ?? '');
      const to = String(params?.to ?? '');
      if (!dateRe.test(from) || !dateRe.test(to) || from > to) throw new StoreError('Período inválido.');
      const startIso = new Date(String(params?.startIso ?? `${from}T00:00:00`)).toISOString();
      const endIso = new Date(String(params?.endIso ?? `${to}T23:59:59.999`)).toISOString();
      const clientId = typeof params?.clientId === 'string' && params.clientId ? params.clientId : null;

      const [clients, settings, activeRows, addedRows, removedRows, historyRows, auditRows] = await Promise.all([
        ops.getAllClients(),
        ops.getAppSettings(),
        db.query<{ client_id: string; n: number }>("SELECT client_id, count(*)::int AS n FROM entries WHERE status = 'active' GROUP BY client_id"),
        db.query<{ data: BlocklistEntry }>(
          `SELECT data FROM entries WHERE data->>'addedDate' >= $1 AND data->>'addedDate' <= $2 ${clientId ? 'AND client_id = $3' : ''}`,
          clientId ? [from, to, clientId] : [from, to]
        ),
        db.query<{ data: BlocklistEntry; updated_at: string; updated_by: string | null }>(
          `SELECT data, updated_at, updated_by FROM entries
           WHERE status = 'removed' AND coalesce((data->>'removedAt')::timestamptz, updated_at) >= $1
             AND coalesce((data->>'removedAt')::timestamptz, updated_at) <= $2 ${clientId ? 'AND client_id = $3' : ''}`,
          clientId ? [startIso, endIso, clientId] : [startIso, endIso]
        ),
        db.query<{ data: ImportHistoryRecord }>(
          `SELECT data FROM history WHERE happened_at >= $1 AND happened_at <= $2 ${clientId ? 'AND client_id = $3' : ''} ORDER BY happened_at DESC`,
          clientId ? [startIso, endIso, clientId] : [startIso, endIso]
        ),
        db.query<{ username: string; action: string; detail: Record<string, unknown> }>(
          `SELECT a.username, a.action, a.detail FROM audit_log a WHERE a.at >= $1 AND a.at <= $2 AND a.action LIKE 'entr%'`,
          [startIso, endIso]
        )
      ]);

      const names = new Map((await db.query<{ username: string; display_name: string | null }>('SELECT username, display_name FROM users')).map((u) => [u.username, u.display_name || u.username]));
      const activeByClient = new Map(activeRows.map((r) => [r.client_id, r.n]));
      const sla = settings.slaDays || 7;
      const today = new Date();
      const daysSince = (date: string | null) => (date ? Math.floor((today.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000) : null);

      const perClient = clients
        .filter((c) => (clientId ? c.id === clientId : !c.isArchived))
        .map((c) => {
          const added = addedRows.filter((r) => r.data.clientId === c.id);
          const removed = removedRows.filter((r) => r.data.clientId === c.id);
          const imports = historyRows.filter((r) => r.data.clientId === c.id);
          const importers = [...new Set(imports.map((r) => r.data.importedBy).filter(Boolean))] as string[];
          const since = daysSince(c.lastUpdateDate);
          return {
            clientId: c.id,
            name: c.name,
            notes: c.notes || '',
            lastUpdateDate: c.lastUpdateDate,
            status: since === null ? 'sem_importacao' : since > sla ? 'atrasado' : 'em_dia',
            activeNow: activeByClient.get(c.id) || 0,
            addedInPeriod: added.length,
            removedInPeriod: removed.length,
            importsInPeriod: imports.length,
            importers
          };
        });

      const changes = clientId
        ? [
            ...addedRows.map((r) => ({
              action: 'incluido' as const,
              date: r.data.addedDate,
              indicator: r.data.indicator,
              type: r.data.type,
              ticket: r.data.sourceTicket || '',
              notes: r.data.notes || '',
              by: r.data.addedBy || '',
              currentStatus: r.data.status
            })),
            ...removedRows.map((r) => ({
              action: 'removido' as const,
              date: (r.data.removedAt || r.updated_at).toString().slice(0, 10),
              indicator: r.data.indicator,
              type: r.data.type,
              ticket: r.data.sourceTicket || '',
              notes: r.data.notes || '',
              by: r.data.removedBy || (r.updated_by ? names.get(r.updated_by) || r.updated_by : ''),
              currentStatus: r.data.status
            }))
          ].sort((a, b) => b.date.localeCompare(a.date) || a.indicator.localeCompare(b.indicator))
        : [];

      // Atividade por pessoa no período (importações, inclusões e remoções registradas na auditoria).
      const byUser = new Map<string, { name: string; imports: number; added: number; removed: number }>();
      for (const row of auditRows) {
        const detail = row.detail || {};
        if (clientId && detail.clientId !== clientId) continue;
        const entry = byUser.get(row.username) ?? { name: names.get(row.username) || row.username, imports: 0, added: 0, removed: 0 };
        if (row.action === 'entries.import') {
          entry.imports++;
          entry.added += Number(detail.added || 0);
          entry.removed += Number(detail.removed || 0);
        } else if (row.action === 'entry.status' && detail.status === 'removed') {
          entry.removed++;
        }
        byUser.set(row.username, entry);
      }

      return {
        from,
        to,
        clientId,
        generatedAt: new Date().toISOString(),
        generatedBy: actor.displayName,
        slaDays: sla,
        totals: {
          clients: perClient.length,
          added: perClient.reduce((n, c) => n + c.addedInPeriod, 0),
          removed: perClient.reduce((n, c) => n + c.removedInPeriod, 0),
          imports: perClient.reduce((n, c) => n + c.importsInPeriod, 0),
          late: perClient.filter((c) => c.status !== 'em_dia').length,
          activeNow: perClient.reduce((n, c) => n + c.activeNow, 0)
        },
        clients: perClient,
        changes,
        imports: historyRows.map((r) => r.data),
        activity: [...byUser.values()].sort((a, b) => b.imports - a.imports || b.added - a.added)
      };
    },

    async isEmpty() {
      const rows = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM clients');
      return (rows[0]?.n ?? 0) === 0;
    }
  };
  return ops;
}

export type Store = ReturnType<typeof createStore>;

// Operações que o navegador pode chamar por /api/data/:op. As demais são internas.
export const PUBLIC_OPS = [
  'initializeDatabaseIfEmpty',
  'getAllClients',
  'saveClient',
  'renameClient',
  'updateClient',
  'archiveClient',
  'getClientEntries',
  'getClientActiveIndicatorsSet',
  'bulkInsertEntries',
  'replaceClientEntries',
  'updateEntryStatus',
  'updateEntryNotes',
  'bulkDeleteEntries',
  'createClientSnapshot',
  'getClientSnapshots',
  'restoreClientSnapshot',
  'deleteClientEntriesAll',
  'deleteSnapshot',
  'getDashboardStats',
  'searchIndicatorAcrossClients',
  'addHistoryRecord',
  'getHistoryRecords',
  'getReport',
  'getAllActiveEntries',
  'getAppSettings',
  'saveAppSettings',
  'exportFullBackupJSON',
  'restoreFullBackupJSON'
] as const;
