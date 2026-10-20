import type { Database } from './db.ts';
import type {
  AppSettings,
  BlocklistEntry,
  Client,
  ClientEntriesPage,
  ClientEntriesPageParams,
  ClientException,
  ClientSnapshot,
  CorrelationPage,
  CorrelationPageParams,
  DashboardStats,
  EntryComment,
  ImportHistoryRecord,
  ImportOutcome
} from '../src/types/index.ts';
import { findExceptionConflicts, findRedundant, toRange } from '../src/utils/redundancy.ts';
import { ipTotalsByClient, type IpTotals } from '../src/utils/addressCount.ts';
import { classifyIndicator, normalizeIndicator } from '../src/utils/validator.ts';
import {
  type Actor,
  DEFAULT_SETTINGS,
  exceptionList,
  latest,
  StoreError,
  audit,
  getClient,
  putClient,
  entriesOf,
  upsertEntries,
  snapshot,
  restoreStoredSnapshot,
  retireRedundant,
  parseImportPayload,
  executeImport,
  toPendingImport,
  requireAdmin,
  asString,
  asArray,
  pageNumber,
  CORRELATION_CTE
} from './storeCore.ts';

export { StoreError, type Actor } from './storeCore.ts';

// Operações da base compartilhada da equipe, no Postgres, registrando quem fez cada alteração.
// As operações de baixo nível (clientes, entradas, versões, importação) ficam em storeCore.ts.

// Conta de IPs/CIDRs por cliente: refeita só quando alguma lista ou cliente muda (o Painel é atualizado
// depois de cada ação, e a conta percorre todas as entradas ativas).
const ipTotalsCache = new WeakMap<object, { key: string; value: { perClient: Record<string, IpTotals>; sum: IpTotals } }>();

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

    // Exclusão definitiva do cliente e de tudo dele (lista, versões e histórico). Só administradores.
    // O nome digitado precisa conferir, para evitar exclusão por engano; a auditoria registra quem apagou.
    async deleteClient(actor: Actor, clientId: string, confirmName: string) {
      requireAdmin(actor);
      return db.tx(async (q) => {
        const client = await getClient(q, asString(clientId, 'clientId'));
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        if (String(confirmName ?? '').trim().toUpperCase() !== client.name.toUpperCase()) {
          throw new StoreError('O nome digitado não confere com o do cliente.');
        }
        const count = async (table: string) =>
          (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE client_id = $1`, [clientId]))[0]?.n ?? 0;
        const removed = { entries: await count('entries'), snapshots: await count('snapshots'), history: await count('history') };
        await q('DELETE FROM entries WHERE client_id = $1', [clientId]);
        await q('DELETE FROM snapshots WHERE client_id = $1', [clientId]);
        await q('DELETE FROM history WHERE client_id = $1', [clientId]);
        await q('DELETE FROM clients WHERE id = $1', [clientId]);
        await audit(q, actor, 'client.delete', { clientId, name: client.name, ...removed });
        return removed;
      });
    },

    // Exceções do cliente: o que nunca pode ser bloqueado. Ao salvar, itens ativos em conflito são retirados.
    // Imagem de capa do cliente: data URL de imagem pequena (o navegador já reduz antes de enviar).
    async setClientLogo(actor: Actor, clientId: string, logo: unknown) {
      return db.tx(async (q) => {
        const client = await getClient(q, asString(clientId, 'clientId'));
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        let value: string | undefined;
        if (logo !== null && logo !== undefined && logo !== '') {
          value = String(logo);
          if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new StoreError('Envie uma imagem PNG, JPEG ou WebP.');
          if (value.length > 400_000) throw new StoreError('Imagem grande demais (máximo 400 KB depois de reduzida).');
        }
        await putClient(q, { ...client, logo: value, updatedAt: new Date().toISOString() }, actor);
        await audit(q, actor, 'client.logo', { clientId: client.id, name: client.name, removed: !value });
        return null;
      });
    },

    async updateClientExceptions(actor: Actor, clientId: string, input: unknown) {
      requireAdmin(actor);
      const raw = asArray<{ indicator?: unknown; reason?: unknown }>(input, 'exceptions').slice(0, 1000);
      const seen = new Set<string>();
      const list: ClientException[] = [];
      const invalid: string[] = [];
      for (const item of raw) {
        const indicator = normalizeIndicator(String(item?.indicator ?? ''));
        if (!indicator) continue;
        if (!classifyIndicator(indicator).isValid) {
          invalid.push(String(item?.indicator));
          continue;
        }
        if (seen.has(indicator)) continue;
        seen.add(indicator);
        list.push({ indicator, reason: String(item?.reason ?? '').trim().slice(0, 200) || undefined });
      }
      if (invalid.length) throw new StoreError(`Exceções inválidas: ${invalid.slice(0, 5).join(', ')}`);
      return db.tx(async (q) => {
        const client = await getClient(q, asString(clientId, 'clientId'));
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        const previous = new Map((client.exceptions || []).map((e) => [e.indicator, e]));
        const now = new Date().toISOString();
        const exceptions = list.map((e) => ({ ...e, addedBy: previous.get(e.indicator)?.addedBy || actor.displayName, addedAt: previous.get(e.indicator)?.addedAt || now }));
        await putClient(q, { ...client, exceptions, updatedAt: now }, actor);
        const active = await entriesOf(q, clientId, 'active');
        const conflicts = findExceptionConflicts(active, (e) => e.indicator, exceptions.map((e) => e.indicator));
        let retired = 0;
        if (conflicts.length) {
          await snapshot(q, clientId, 'Antes de aplicar as exceções do cliente', actor);
          retired = await retireRedundant(q, clientId, actor);
        }
        await audit(q, actor, 'client.exceptions', { clientId, name: client.name, count: exceptions.length, retired });
        return { exceptions, retired };
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

    async getClientEntriesPage(_actor: Actor, params: ClientEntriesPageParams): Promise<ClientEntriesPage> {
      const clientId = asString(params?.clientId, 'clientId');
      const pageSize = pageNumber(params.pageSize, 100, 500);
      const requestedPage = pageNumber(params.page, 1);
      const args: unknown[] = [clientId];
      const where: string[] = [];
      const add = (condition: string, value: unknown) => {
        args.push(value);
        where.push(condition.replace('?', `$${args.length}`));
      };
      if (params.status && params.status !== 'ALL') {
        if (!['active', 'removed'].includes(params.status)) throw new StoreError('Status inválido.');
        add('status = ?', params.status);
      }
      if (params.type && params.type !== 'ALL') {
        if (!['IPv4', 'IPv6', 'CIDR_v4', 'CIDR_v6', 'Domain', 'Invalid'].includes(params.type)) throw new StoreError('Tipo inválido.');
        add("data->>'type' = ?", params.type);
      }
      const now = new Date();
      if (params.period && params.period !== 'ALL') {
        if (!['7d', '30d', 'year'].includes(params.period)) throw new StoreError('Período inválido.');
        const from = params.period === 'year' ? `${now.getFullYear()}-01-01`
          : new Date(now.getTime() - (params.period === '7d' ? 7 : 30) * 86_400_000).toISOString().slice(0, 10);
        add("data->>'addedDate' >= ?", from);
      }
      const search = String(params.search ?? '').trim().toLowerCase();
      if (search) {
        args.push(search);
        const p = `$${args.length}`;
        where.push(`(strpos(lower(indicator), ${p}) > 0 OR strpos(lower(coalesce(data->>'sourceTicket', '')), ${p}) > 0 OR strpos(lower(coalesce(data->>'notes', '')), ${p}) > 0)`);
      }
      const octet = '(0?[0-9]{1,2}|1[0-9]{2}|2[0-4][0-9]|25[0-5])';
      const validIpv4 = `(data->>'type' = 'IPv4' AND indicator ~ '^${octet}(\\.${octet}){3}$')`;
      const numeric = `CASE WHEN ${validIpv4} THEN
        coalesce(CASE WHEN jsonb_typeof(data->'numericValue') = 'number' THEN (data->>'numericValue')::numeric END,
          split_part(indicator, '.', 1)::bigint * 16777216 + split_part(indicator, '.', 2)::bigint * 65536
          + split_part(indicator, '.', 3)::bigint * 256 + split_part(indicator, '.', 4)::bigint) END`;
      const order = params.sort === 'date' ? "data->>'addedDate' DESC NULLS LAST, id"
        : `${numeric} ASC NULLS LAST, indicator, id`;
      args.push(requestedPage, pageSize);
      const pageParam = `$${args.length - 1}`;
      const sizeParam = `$${args.length}`;
      const rows = await db.query<{ result: ClientEntriesPage }>(`
        WITH client_entries AS MATERIALIZED (
          SELECT id, indicator, status, data FROM entries WHERE client_id = $1
        ), filtered AS MATERIALIZED (
          SELECT * FROM client_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ), counts AS (
          SELECT count(*)::int AS total,
                 (SELECT count(*)::int FROM client_entries) AS total_client,
                 (SELECT count(*)::int FROM client_entries WHERE status = 'active') AS active_count FROM filtered
        ), paging AS (
          SELECT *, least(${pageParam}::int, greatest(1, ceil(total::numeric / ${sizeParam}::int)::int)) AS page FROM counts
        ), selected AS (
          SELECT data, row_number() OVER (ORDER BY ${order}) AS position FROM filtered
          ORDER BY ${order} LIMIT ${sizeParam}::int OFFSET ((SELECT page FROM paging) - 1) * ${sizeParam}::int
        )
        SELECT jsonb_build_object('entries', coalesce((SELECT jsonb_agg(data ORDER BY position) FROM selected), '[]'::jsonb),
          'total', total, 'totalClient', total_client, 'activeCount', active_count,
          'page', page, 'pageSize', ${sizeParam}::int) AS result FROM paging`, args);
      return rows[0].result;
    },

    async getIndicatorEntries(_actor: Actor, indicator: string): Promise<BlocklistEntry[]> {
      const key = asString(indicator, 'indicator').trim().toLowerCase();
      const rows = await db.query<{ data: BlocklistEntry }>(
        `SELECT e.data FROM entries e JOIN clients c ON c.id = e.client_id
         WHERE lower(trim(e.indicator)) = $1 AND coalesce(c.data->>'isArchived', 'false') <> 'true'
         ORDER BY e.client_id, e.data->>'addedDate' DESC, e.id`, [key]
      );
      return rows.map((row) => row.data);
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
      return db.tx(async (q) => {
        const client = await getClient(q, clientId);
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        await snapshot(q, clientId, `Antes da importação de ${list.length} novos itens (${lastUpdateDateStr})`, actor);
        await upsertEntries(q, list, actor);
        const retired = await retireRedundant(q, clientId, actor);
        await putClient(
          q,
          {
            ...client,
            lastVariation: { added: list.length, removed: retired, previousTotal: client.lastVariation?.previousTotal || 0 },
            lastUpdateDate: lastUpdateDateStr,
            updatedAt: new Date().toISOString()
          },
          actor
        );
        await audit(q, actor, 'entries.import', { clientId, name: client.name, added: list.length, removed: retired, mode: 'append' });
        return { retired };
      });
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
        const retired = await retireRedundant(q, clientId, actor);
        removed += retired;
        await putClient(
          q,
          { ...client, lastVariation: { added, removed, previousTotal }, lastUpdateDate: lastUpdateDateStr, updatedAt: new Date().toISOString() },
          actor
        );
        await audit(q, actor, 'entries.import', { clientId, name: client.name, added, removed, mode: 'replace' });
        return { added, removed, previousTotal, retired };
      });
    },

    // Importação vinda da tela: grava na hora ou, se a regra pedir, deixa aguardando um administrador.
    async importBatch(actor: Actor, rawPayload: unknown): Promise<ImportOutcome> {
      const payload = parseImportPayload(rawPayload);
      const settings = await ops.getAppSettings();
      const needsApproval =
        actor.role !== 'admin' &&
        ((payload.mode === 'replace' && settings.requireApprovalForReplace !== false) ||
          payload.entries.length > (settings.approvalThreshold ?? 500));
      if (!needsApproval) return db.tx((q) => executeImport(q, actor, payload));

      const client = await getClient(db.query, payload.clientId);
      if (!client) throw new StoreError('Cliente não encontrado.', 404);
      const id = `pend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await db.tx(async (q) => {
        await q(
          'INSERT INTO pending_imports (id, client_id, mode, data, requested_by) VALUES ($1, $2, $3, $4::jsonb, $5)',
          [id, payload.clientId, payload.mode, JSON.stringify({ ...payload, requestedByName: actor.displayName }), actor.username]
        );
        await audit(q, actor, 'import.pending', { clientId: payload.clientId, name: client.name, mode: payload.mode, items: payload.entries.length });
      });
      return { status: 'pending', pendingId: id, added: 0, retired: 0, removed: 0, blockedByException: 0 };
    },

    // Admin vê todas as pendentes e as últimas decididas; analista vê só as próprias.
    async listPendingImports(actor: Actor) {
      const rows = await db.query<any>(
        actor.role === 'admin'
          ? `(SELECT * FROM pending_imports WHERE status = 'pending' ORDER BY requested_at)
             UNION ALL (SELECT * FROM pending_imports WHERE status <> 'pending' ORDER BY decided_at DESC LIMIT 20)`
          : 'SELECT * FROM pending_imports WHERE requested_by = $1 ORDER BY requested_at DESC LIMIT 30',
        actor.role === 'admin' ? [] : [actor.username]
      );
      const names = new Map((await ops.getAllClients()).map((c) => [c.id, c.name]));
      return rows.map((r) => toPendingImport(r, names.get(r.client_id) || 'Cliente removido'));
    },

    async decidePendingImport(actor: Actor, id: string, decision: string, note?: string) {
      requireAdmin(actor);
      if (decision !== 'approve' && decision !== 'reject') throw new StoreError('Decisão inválida.');
      return db.tx(async (q) => {
        const rows = await q<any>("SELECT * FROM pending_imports WHERE id = $1 AND status = 'pending' FOR UPDATE", [String(id)]);
        const row = rows[0];
        if (!row) throw new StoreError('Esta importação já foi decidida ou não existe.', 404);
        const cleanNote = String(note ?? '').trim().slice(0, 500) || null;
        let outcome: ImportOutcome | null = null;
        if (decision === 'approve') {
          const payload = parseImportPayload(row.data);
          const requester: Actor = { username: row.requested_by, displayName: row.data.requestedByName || row.requested_by, role: 'analyst' };
          outcome = await executeImport(q, requester, payload, `Aprovado por ${actor.displayName}`);
        }
        await q(
          'UPDATE pending_imports SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1',
          [row.id, decision === 'approve' ? 'approved' : 'rejected', actor.displayName, cleanNote]
        );
        await audit(q, actor, decision === 'approve' ? 'import.approve' : 'import.reject', {
          clientId: row.client_id, requestedBy: row.requested_by, items: (row.data.entries || []).length, note: cleanNote
        });
        return outcome;
      });
    },

    // Desfaz uma importação: volta a lista para a versão salva antes dela e marca o histórico.
    async undoImport(actor: Actor, snapshotId: string, historyId?: string) {
      const id = asString(snapshotId, 'snapshotId');
      if (historyId != null && typeof historyId !== 'string') throw new StoreError('Importação inválida.');
      return db.tx((q) => restoreStoredSnapshot(q, actor, id, historyId || undefined));
    },

    // Validação de todas as listas: repetidos, cobertos por CIDR, conflitos com exceções e itens para revisão.
    async validateAllClients(actor: Actor) {
      const [clients, settings, entries] = await Promise.all([
        ops.getAllClients(),
        ops.getAppSettings(),
        db.query<{ data: BlocklistEntry; last_reported: string | null }>(
          `SELECT e.data, c.data->>'lastReportedAt' AS last_reported FROM entries e
           LEFT JOIN cti_cache c ON c.indicator = lower(e.indicator) WHERE e.status = 'active'`
        )
      ]);
      const byClient = new Map<string, Array<{ data: BlocklistEntry; last_reported: string | null }>>();
      for (const row of entries) {
        const list = byClient.get(row.data.clientId) ?? [];
        list.push(row);
        byClient.set(row.data.clientId, list);
      }
      const cutoff = Date.now() - (settings.reviewDays || 90) * 86_400_000;
      return clients.filter((c) => !c.isArchived).map((c) => {
        const rows = (byClient.get(c.id) ?? []).sort((a, b) => String(a.data.addedDate).localeCompare(String(b.data.addedDate)));
        const active = rows.map((r) => r.data);
        const conflicts = findExceptionConflicts(active, (e) => e.indicator, exceptionList(c));
        const conflictSet = new Set(conflicts.map((x) => x.item));
        const redundant = findRedundant(active.filter((e) => !conflictSet.has(e)), (e) => e.indicator);
        const reviewDue = rows.filter((r) => latest(r.data.addedDate, r.data.lastSeenAt, r.data.reviewedAt, r.last_reported) < cutoff).length;
        return {
          clientId: c.id,
          name: c.name,
          active: active.length,
          duplicates: redundant.filter((m) => m.reason === 'duplicate').length,
          covered: redundant.filter((m) => m.reason === 'cidr').length,
          exceptionConflicts: conflicts.length,
          reviewDue,
          samples: [
            ...conflicts.slice(0, 3).map((x) => `${x.item.indicator} (exceção ${x.exception})`),
            ...redundant.slice(0, 5).map((m) => `${m.item.indicator} → ${m.coveredBy}`)
          ]
        };
      });
    },

    // Corrige todas as listas de uma vez (versão salva antes em cada cliente alterado).
    async cleanAllClients(actor: Actor) {
      const report = await ops.validateAllClients(actor);
      const results: Array<{ clientId: string; name: string; retired: number }> = [];
      for (const item of report) {
        if (item.duplicates + item.covered + item.exceptionConflicts === 0) continue;
        const { retired } = await ops.cleanRedundantEntries(actor, item.clientId);
        results.push({ clientId: item.clientId, name: item.name, retired });
      }
      return { clients: results.length, retired: results.reduce((n, r) => n + r.retired, 0), results };
    },

    // Fila de revisão: ativos sem reaparecer em importações, sem revisão e sem denúncias recentes há mais de N dias.
    async getReviewQueue(_actor: Actor, clientId?: string) {
      const settings = await ops.getAppSettings();
      const days = settings.reviewDays || 90;
      const rows = await db.query<{ data: BlocklistEntry; last_reported: string | null; reports: string | null; score: string | null }>(
        `SELECT e.data, c.data->>'lastReportedAt' AS last_reported, c.data->>'totalReports' AS reports, c.data->>'score' AS score
         FROM entries e LEFT JOIN cti_cache c ON c.indicator = lower(e.indicator)
         WHERE e.status = 'active' ${typeof clientId === 'string' && clientId ? 'AND e.client_id = $1' : ''}`,
        typeof clientId === 'string' && clientId ? [clientId] : []
      );
      const cutoff = Date.now() - days * 86_400_000;
      const names = new Map((await ops.getAllClients()).map((c) => [c.id, c.name]));
      const items = rows
        .map((r) => {
          const last = latest(r.data.addedDate, r.data.lastSeenAt, r.data.reviewedAt, r.last_reported);
          return {
            entry: r.data,
            clientName: names.get(r.data.clientId) || '',
            lastActivity: last ? new Date(last).toISOString() : null,
            daysIdle: last ? Math.floor((Date.now() - last) / 86_400_000) : null,
            lastReportedAt: r.last_reported,
            totalReports: r.reports === null ? null : Number(r.reports),
            score: r.score === null ? null : Number(r.score)
          };
        })
        .filter((x) => x.lastActivity === null || new Date(x.lastActivity).getTime() < cutoff)
        .sort((a, b) => (b.daysIdle ?? 99999) - (a.daysIdle ?? 99999));
      return { reviewDays: days, items };
    },

    async reviewEntries(actor: Actor, ids: unknown, decision: string) {
      const list = asArray<string>(ids, 'ids').filter((x) => typeof x === 'string').slice(0, 5000);
      if (decision !== 'keep' && decision !== 'remove') throw new StoreError('Decisão inválida.');
      if (list.length === 0) return { count: 0 };
      await db.tx(async (q) => {
        if (decision === 'keep') {
          await q(
            `UPDATE entries SET data = data || jsonb_build_object('reviewedAt', to_jsonb(now()), 'reviewedBy', $2::text),
               updated_at = now(), updated_by = $3 WHERE id = ANY($1::text[]) AND status = 'active'`,
            [list, actor.displayName, actor.username]
          );
        } else {
          await q(
            `UPDATE entries SET status = 'removed', data = data || jsonb_build_object('status', 'removed', 'removedAt', to_jsonb(now()),
               'removedBy', $2::text, 'notes', coalesce(data->>'notes' || ' • ', '') || 'Removido na revisão (sem novas denúncias)'),
               updated_at = now(), updated_by = $3 WHERE id = ANY($1::text[]) AND status = 'active'`,
            [list, actor.displayName, actor.username]
          );
        }
        await audit(q, actor, decision === 'keep' ? 'review.keep' : 'review.remove', { count: list.length });
      });
      return { count: list.length };
    },

    // Comentários por item.
    async getComments(_actor: Actor, entryId: string) {
      const rows = await db.query<any>('SELECT * FROM comments WHERE entry_id = $1 ORDER BY at', [asString(entryId, 'entryId')]);
      return rows.map((r): EntryComment => ({
        id: Number(r.id), entryId: r.entry_id, clientId: r.client_id, indicator: r.indicator,
        username: r.username, displayName: r.display_name || r.username, body: r.body, at: new Date(r.at).toISOString()
      }));
    },

    async addComment(actor: Actor, entryId: string, body: string) {
      const text = String(body ?? '').trim().slice(0, 1000);
      if (!text) throw new StoreError('Escreva o comentário.');
      const rows = await db.query<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE id = $1', [asString(entryId, 'entryId')]);
      const entry = rows[0]?.data;
      if (!entry) throw new StoreError('Item não encontrado.', 404);
      await db.query(
        'INSERT INTO comments (entry_id, client_id, indicator, username, display_name, body) VALUES ($1, $2, $3, $4, $5, $6)',
        [entryId, entry.clientId, entry.indicator, actor.username, actor.displayName, text]
      );
      await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
        actor.username, 'comment.add', JSON.stringify({ clientId: entry.clientId, indicator: entry.indicator })
      ]);
      return ops.getComments(actor, entryId);
    },

    async deleteComment(actor: Actor, id: number) {
      const rows = await db.query<{ username: string; entry_id: string }>('SELECT username, entry_id FROM comments WHERE id = $1', [Number(id)]);
      const row = rows[0];
      if (!row) throw new StoreError('Comentário não encontrado.', 404);
      if (row.username !== actor.username && actor.role !== 'admin') throw new StoreError('Só quem escreveu ou um administrador pode apagar.', 403);
      await db.query('DELETE FROM comments WHERE id = $1', [Number(id)]);
      return ops.getComments(actor, row.entry_id);
    },

    async getCommentCounts(_actor: Actor, clientId: string, entryIds?: string[]) {
      const ids = entryIds === undefined ? undefined : asArray<string>(entryIds, 'entryIds');
      if (ids && (ids.length > 500 || ids.some((id) => typeof id !== 'string'))) throw new StoreError('Lista de itens inválida.');
      const rows = await db.query<{ entry_id: string; n: number }>(
        `SELECT entry_id, count(*)::int AS n FROM comments WHERE client_id = $1
         ${ids ? 'AND entry_id = ANY($2::text[])' : ''} GROUP BY entry_id`,
        ids ? [asString(clientId, 'clientId'), ids] : [asString(clientId, 'clientId')]
      );
      return Object.fromEntries(rows.map((r) => [r.entry_id, r.n]));
    },

    // Trilha de auditoria (só administradores).
    async getAuditLog(actor: Actor, params: { from?: unknown; to?: unknown; username?: unknown; action?: unknown; q?: unknown; offset?: unknown; limit?: unknown }) {
      requireAdmin(actor);
      const where: string[] = [];
      const args: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        args.push(value);
        where.push(sql.replace('?', () => `$${args.length}`));
      };
      if (typeof params?.from === 'string' && params.from) add('at >= ?::timestamptz', params.from);
      if (typeof params?.to === 'string' && params.to) add('at <= ?::timestamptz', params.to);
      if (typeof params?.username === 'string' && params.username) add('username = ?', params.username);
      if (typeof params?.action === 'string' && params.action) add('action LIKE ?', `${params.action}%`);
      if (typeof params?.q === 'string' && params.q.trim()) add('detail::text ILIKE ?', `%${params.q.trim()}%`);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(Math.max(Number(params?.limit) || 100, 1), 500);
      const offset = Math.max(Number(params?.offset) || 0, 0);
      const [rows, total, users, actions] = await Promise.all([
        db.query<any>(`SELECT id, at, username, action, detail FROM audit_log ${clause} ORDER BY at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, args),
        db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log ${clause}`, args),
        db.query<{ username: string; display_name: string | null }>('SELECT DISTINCT a.username, u.display_name FROM audit_log a LEFT JOIN users u ON u.username = a.username WHERE a.username IS NOT NULL ORDER BY a.username'),
        db.query<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action')
      ]);
      return {
        total: total[0]?.n ?? 0,
        rows: rows.map((r) => ({ id: Number(r.id), at: new Date(r.at).toISOString(), username: r.username, action: r.action, detail: r.detail || {} })),
        users: users.map((u) => ({ username: u.username, displayName: u.display_name || u.username })),
        actions: actions.map((a) => a.action)
      };
    },

    // Busca de vários indicadores em todas as listas: igual, coberto por um CIDR, ou CIDR pesquisado que contém itens.
    async lookupIndicators(_actor: Actor, queries: unknown) {
      const tokens = asArray<string>(queries, 'queries').filter((x) => typeof x === 'string').slice(0, 2000);
      const [clients, rows] = await Promise.all([
        ops.getAllClients(),
        db.query<{ data: BlocklistEntry }>('SELECT data FROM entries')
      ]);
      const names = new Map(clients.map((c) => [c.id, c.name]));
      const exact = new Map<string, BlocklistEntry[]>();
      const ranged: Array<{ entry: BlocklistEntry; range: NonNullable<ReturnType<typeof toRange>> }> = [];
      for (const { data } of rows) {
        const key = data.indicator.toLowerCase();
        exact.set(key, [...(exact.get(key) ?? []), data]);
        const range = toRange(data.indicator);
        if (range) ranged.push({ entry: data, range });
      }
      const nets = ranged.filter((r) => r.range.end > r.range.start);
      const seen = new Set<string>();
      const results = [];
      for (const raw of tokens) {
        const normalized = normalizeIndicator(raw);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        const valid = classifyIndicator(normalized).isValid;
        const matches: Array<Record<string, unknown>> = [];
        const push = (entry: BlocklistEntry, match: string, via?: string) => matches.push({
          clientId: entry.clientId, clientName: names.get(entry.clientId) || entry.clientId, entryId: entry.id,
          indicator: entry.indicator, status: entry.status, match, via, addedDate: entry.addedDate,
          sourceTicket: entry.sourceTicket, notes: entry.notes, removedAt: entry.removedAt, addedBy: entry.addedBy
        });
        for (const entry of exact.get(normalized) ?? []) push(entry, 'exact');
        const range = valid ? toRange(normalized) : null;
        if (range) {
          for (const net of nets) {
            if (net.entry.indicator.toLowerCase() === normalized) continue;
            if (net.range.family === range.family && net.range.start <= range.start && range.end <= net.range.end) push(net.entry, 'covered', net.entry.indicator);
          }
          if (range.end > range.start) {
            let inside = 0;
            for (const r of ranged) {
              if (r.entry.indicator.toLowerCase() === normalized) continue;
              if (r.range.family === range.family && range.start <= r.range.start && r.range.end <= range.end && !(r.range.start === range.start && r.range.end === range.end)) {
                if (inside++ < 50) push(r.entry, 'inside');
              }
            }
          }
        }
        results.push({ query: raw, normalized, valid, matches });
      }
      return results;
    },

    // Evolução: total ativo por semana, e países/provedores dos IPs ativos que já têm reputação consultada.
    async getEvolution(_actor: Actor, params?: { weeks?: unknown; clientId?: unknown }) {
      const weeks = Math.min(Math.max(Number(params?.weeks) || 26, 4), 104);
      const clientId = typeof params?.clientId === 'string' && params.clientId ? params.clientId : null;
      const rows = await db.query<{ data: BlocklistEntry; updated_at: string; cti: Record<string, any> | null }>(
        `SELECT e.data, e.updated_at, c.data AS cti FROM entries e LEFT JOIN cti_cache c ON c.indicator = lower(e.indicator)
         ${clientId ? 'WHERE e.client_id = $1' : ''}`,
        clientId ? [clientId] : []
      );
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const points: Array<{ date: string; active: number; added: number; removed: number }> = [];
      const spans = rows.map((r) => ({
        start: latest(r.data.addedDate),
        end: r.data.status === 'removed' ? latest(r.data.removedAt || r.updated_at) : Infinity
      }));
      for (let i = weeks - 1; i >= 0; i--) {
        const pointEnd = end.getTime() - i * 7 * 86_400_000;
        const pointStart = pointEnd - 7 * 86_400_000;
        let active = 0, added = 0, removed = 0;
        for (const span of spans) {
          if (span.start && span.start <= pointEnd && span.end > pointEnd) active++;
          if (span.start > pointStart && span.start <= pointEnd) added++;
          if (span.end !== Infinity && span.end > pointStart && span.end <= pointEnd) removed++;
        }
        points.push({ date: new Date(pointEnd).toISOString().slice(0, 10), active, added, removed });
      }
      const activeIps = rows.filter((r) => r.data.status === 'active' && toRange(r.data.indicator) && !r.data.indicator.includes('/'));
      const tally = (pick: (cti: Record<string, any>) => string | null | undefined) => {
        const counts = new Map<string, number>();
        for (const r of activeIps) {
          const value = r.cti ? pick(r.cti) : null;
          if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count }));
      };
      return {
        points,
        enriched: activeIps.filter((r) => r.cti).length,
        activeIps: activeIps.length,
        missing: activeIps.filter((r) => !r.cti).map((r) => r.data.indicator).slice(0, 500),
        countries: tally((c) => c.countryCode),
        providers: tally((c) => c.asn || c.isp),
        verdicts: tally((c) => c.verdict)
      };
    },

    // Limpeza manual: retira repetidos, itens cobertos por CIDR e conflitos com exceções, com versão salva antes.
    async cleanRedundantEntries(actor: Actor, clientId: string) {
      return db.tx(async (q) => {
        const client = await getClient(q, asString(clientId, 'clientId'));
        if (!client) throw new StoreError('Cliente não encontrado.', 404);
        const active = await entriesOf(q, clientId, 'active');
        if (findRedundant(active, (e) => e.indicator).length === 0 && findExceptionConflicts(active, (e) => e.indicator, exceptionList(client)).length === 0) return { retired: 0 };
        await snapshot(q, clientId, 'Antes de retirar repetidos e itens cobertos por CIDR', actor);
        return { retired: await retireRedundant(q, clientId, actor) };
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
      return db.tx((q) => restoreStoredSnapshot(q, actor, asString(snapshotId, 'snapshotId')));
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

    async getDashboardStats(): Promise<DashboardStats> {
      const rows = await db.query<{ result: DashboardStats }>(`
        WITH active AS MATERIALIZED (
          SELECT client_id, indicator, data->>'addedDate' AS added_date
          FROM entries WHERE status = 'active'
        ), counts AS (
          SELECT client_id, count(*)::int AS total FROM active GROUP BY client_id
        ), correlations AS (
          SELECT lower(trim(indicator)) FROM active GROUP BY lower(trim(indicator)) HAVING count(DISTINCT client_id) >= 2
        ), recurring AS (
          SELECT a.indicator, count(DISTINCT a.client_id)::int AS count FROM active a
          JOIN clients c ON c.id = a.client_id WHERE coalesce(c.data->>'isArchived', 'false') <> 'true'
          GROUP BY a.indicator HAVING count(DISTINCT a.client_id) >= 2
          ORDER BY count DESC, a.indicator LIMIT 4
        )
        SELECT jsonb_build_object(
          'activeCounts', coalesce((SELECT jsonb_object_agg(client_id, total) FROM counts), '{}'::jsonb),
          'totalActiveAcrossAll', (SELECT count(*)::int FROM active),
          'totalCorrelatedIps', (SELECT count(*)::int FROM correlations),
          'addedThisWeekCount', (SELECT count(*)::int FROM active WHERE
            added_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([012][0-9]|3[01])($|T)' AND
            CASE WHEN length(added_date) = 10 THEN added_date || 'T00:00:00.000Z' ELSE added_date END >= $1),
          'recurring', coalesce((SELECT jsonb_agg(jsonb_build_object('indicator', indicator, 'count', count) ORDER BY count DESC, indicator) FROM recurring), '[]'::jsonb)
        ) AS result`, [new Date(Date.now() - 7 * 86_400_000).toISOString()]);
      // Conta de IPs/CIDRs (feita aqui, fora do SQL), guardada até alguma entrada ou cliente mudar.
      const [{ key }] = await db.query<{ key: string }>(
        `SELECT (SELECT count(*) FROM entries)::text || '|' || coalesce((SELECT max(updated_at) FROM entries)::text, '')
           || '|' || coalesce((SELECT max(updated_at) FROM clients)::text, '') AS key`
      );
      const hit = ipTotalsCache.get(db);
      let totals = hit && hit.key === key ? hit.value : null;
      if (!totals) {
        const active = await db.query<{ client_id: string; indicator: string }>(
          `SELECT e.client_id, e.indicator FROM entries e JOIN clients c ON c.id = e.client_id
           WHERE e.status = 'active' AND coalesce(c.data->>'isArchived', 'false') <> 'true'`
        );
        totals = ipTotalsByClient(active.map((row) => ({ clientId: row.client_id, indicator: row.indicator })));
        ipTotalsCache.set(db, { key, value: totals });
      }
      return { ...rows[0].result, ipTotals: totals.perClient, ipTotalsSum: totals.sum };
    },

    async getCorrelationPage(_actor: Actor, params: CorrelationPageParams = {}): Promise<CorrelationPage> {
      const input = params ?? {};
      const pageSize = pageNumber(input.pageSize, 50, 100);
      const requestedPage = pageNumber(input.page, 1);
      const search = String(input.search ?? '').trim().toLowerCase();
      const clientId = input.clientId && input.clientId !== 'ALL' ? asString(input.clientId, 'clientId') : '';
      const severity = input.severity && input.severity !== 'ALL' ? input.severity : '';
      if (severity && !['critical', 'high', 'medium'].includes(severity)) throw new StoreError('Severidade inválida.');
      const rows = await db.query<{ result: CorrelationPage }>(`${CORRELATION_CTE}, filtered AS (
          SELECT * FROM shared WHERE ($1 = '' OR strpos(lower(indicator), $1) > 0
            OR EXISTS (SELECT 1 FROM unnest(client_names) AS name WHERE strpos(lower(name), $1) > 0))
            AND ($2 = '' OR $2 = ANY(client_ids)) AND ($3 = '' OR severity = $3)
        ), paging AS (
          SELECT count(*)::int AS total, least($4::int, greatest(1, ceil(count(*)::numeric / $5::int)::int)) AS page FROM filtered
        ), selected AS (
          SELECT * FROM filtered ORDER BY occurrences DESC, indicator
          LIMIT $5::int OFFSET ((SELECT page FROM paging) - 1) * $5::int
        ), client_pairs AS (
          SELECT a.name AS client_a, b.name AS client_b, count(*)::int AS shared_count
          FROM members a JOIN members b ON a.indicator = b.indicator AND a.client_id < b.client_id
          GROUP BY a.client_id, b.client_id, a.name, b.name ORDER BY shared_count DESC, a.name, b.name LIMIT 9
        )
        SELECT jsonb_build_object(
          'sharedIndicators', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'indicator', indicator, 'type', type, 'clientIds', client_ids, 'clientNames', client_names,
            'occurrencesCount', occurrences, 'severity', severity, 'firewallsImpacted', firewalls)
            ORDER BY occurrences DESC, indicator) FROM selected), '[]'::jsonb),
          'total', total, 'page', page, 'pageSize', $5::int,
          'summary', jsonb_build_object(
            'totalCorrelatedIpsCount', (SELECT count(*)::int FROM shared),
            'maxDissemination', coalesce((SELECT max(occurrences) FROM shared), 0),
            'cidrSharedCount', (SELECT count(*)::int FROM shared WHERE type IN ('CIDR_v4', 'CIDR_v6') OR strpos(indicator, '/') > 0),
            'criticalCount', (SELECT count(*)::int FROM shared WHERE severity = 'critical'),
            'activeClientsCount', (SELECT count(*)::int FROM active_clients)),
          'clientOverlapTable', coalesce((SELECT jsonb_agg(jsonb_build_object('clientA', client_a, 'clientB', client_b, 'sharedCount', shared_count)
            ORDER BY shared_count DESC, client_a, client_b) FROM client_pairs), '[]'::jsonb)
        ) AS result FROM paging`, [search, clientId, severity, requestedPage, pageSize]);
      return rows[0].result;
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
      if (actor.role !== 'admin') {
        const current = await ops.getAppSettings();
        settings = { ...settings, reviewDays: current.reviewDays, approvalThreshold: current.approvalThreshold, requireApprovalForReplace: current.requireApprovalForReplace };
      }
      const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
        const n = Math.round(Number(value));
        return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
      };
      settings = {
        ...settings,
        slaDays: clampInt(settings?.slaDays, 1, 365, 7),
        reviewDays: clampInt(settings?.reviewDays, 7, 3650, 90),
        approvalThreshold: clampInt(settings?.approvalThreshold, 1, 1_000_000, 500),
        requireApprovalForReplace: settings?.requireApprovalForReplace !== false
      };
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
      const clientIds = new Set<string>();
      const entryIds = new Set<string>();
      const historyIds = new Set<string>();
      for (const client of clients) {
        if (!client || typeof client.id !== 'string' || !client.id.trim() || clientIds.has(client.id)
          || typeof client.name !== 'string' || !client.name.trim()) {
          throw new StoreError('Backup inválido: cliente sem identificação ou repetido.');
        }
        clientIds.add(client.id);
      }
      for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || entryIds.has(entry.id)) {
          throw new StoreError('Backup inválido: item sem identificação ou repetido.');
        }
        if (!clientIds.has(entry.clientId)) throw new StoreError('Backup inválido: item vinculado a cliente inexistente.');
        if (typeof entry.indicator !== 'string' || !classifyIndicator(entry.indicator).isValid) {
          throw new StoreError('Backup inválido: indicador de bloqueio inválido.');
        }
        if (!['active', 'removed'].includes(entry.status)) throw new StoreError('Backup inválido: status de item inválido.');
        entryIds.add(entry.id);
      }
      if (data.history !== undefined && !Array.isArray(data.history)) throw new StoreError('Backup inválido: histórico corrompido.');
      const history = Array.isArray(data.history) ? data.history : [];
      for (const record of history) {
        if (!record || typeof record.id !== 'string' || !record.id.trim() || historyIds.has(record.id)
          || typeof record.clientId !== 'string' || !record.clientId || !record.date || Number.isNaN(new Date(record.date).getTime())) {
          throw new StoreError('Backup inválido: registro de histórico corrompido ou repetido.');
        }
        historyIds.add(record.id);
      }
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
          `SELECT data FROM history WHERE happened_at >= $1 AND happened_at <= $2 AND NOT coalesce((data->>'undone')::boolean, false) ${clientId ? 'AND client_id = $3' : ''} ORDER BY happened_at DESC`,
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
            status: (since === null ? 'sem_importacao' : since > sla ? 'atrasado' : 'em_dia') as 'sem_importacao' | 'atrasado' | 'em_dia',
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

      // Visão por dia: incluídos, removidos e importações em cada data do período (horário de Brasília).
      const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const dayList: string[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to && dayList.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
        dayList.push(d.toISOString().slice(0, 10));
      }
      const byDay = new Map(dayList.map((date) => [date, { date, added: 0, removed: 0, imports: 0, clients: new Set<string>() }]));
      for (const r of addedRows) {
        const bucket = byDay.get(r.data.addedDate);
        if (bucket) {
          bucket.added++;
          bucket.clients.add(r.data.clientId);
        }
      }
      for (const r of removedRows) {
        const bucket = byDay.get(localDay(String(r.data.removedAt || r.updated_at)));
        if (bucket) bucket.removed++;
      }
      for (const r of historyRows) {
        const bucket = byDay.get(localDay(r.data.date));
        if (bucket) bucket.imports++;
      }
      const daily = [...byDay.values()].map(({ clients: touched, ...rest }) => ({ ...rest, clients: touched.size }));
      const addedTotal = daily.reduce((n, d) => n + d.added, 0);
      const activeDays = daily.filter((d) => d.added > 0).length;
      const peak = daily.reduce<(typeof daily)[number] | null>((best, d) => (d.added > (best?.added ?? 0) ? d : best), null);
      const round1 = (n: number) => Math.round(n * 10) / 10;
      const dailySummary = {
        days: daily.length,
        activeDays,
        avgAddedPerDay: daily.length ? round1(addedTotal / daily.length) : 0,
        avgAddedPerActiveDay: activeDays ? round1(addedTotal / activeDays) : 0,
        peak: peak ? { date: peak.date, added: peak.added } : null
      };

      return {
        from,
        to,
        clientId,
        generatedAt: new Date().toISOString(),
        generatedBy: actor.displayName,
        slaDays: sla,
        daily,
        dailySummary,
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

    // Relatório de uma importação: o registro do histórico e o detalhe item por item (se houver).
    async getImportReport(_actor: Actor, historyId: string) {
      const id = asString(historyId, 'historyId');
      const [historyRows, reportRows] = await Promise.all([
        db.query<{ data: ImportHistoryRecord }>('SELECT data FROM history WHERE id = $1', [id]),
        db.query<{ data: Record<string, unknown> }>('SELECT data FROM import_reports WHERE history_id = $1', [id])
      ]);
      const history = historyRows[0]?.data;
      if (!history) throw new StoreError('Importação não encontrada.', 404);
      return { history, report: reportRows[0]?.data ?? null };
    },

    // Quais importações têm relatório detalhado (para mostrar o botão só onde existe).
    async listImportReportIds(_actor: Actor, clientId?: string) {
      const rows = await db.query<{ history_id: string }>(
        `SELECT history_id FROM import_reports ${typeof clientId === 'string' && clientId ? 'WHERE client_id = $1' : ''} ORDER BY created_at DESC LIMIT 2000`,
        typeof clientId === 'string' && clientId ? [clientId] : []
      );
      return rows.map((r) => r.history_id);
    },

    // ---------- Casos enviados ao cliente ----------

    // Para cada indicador do caso: situação na lista do cliente e se já foi informado num caso anterior
    // (o mesmo indicador, ou um IP dentro de um CIDR já informado). O caso do próprio ticket não conta.
    async checkClientCase(_actor: Actor, clientId: string, indicators: unknown, ticket?: unknown) {
      const id = asString(clientId, 'clientId');
      const list = [...new Set(asArray<unknown>(indicators, 'indicators')
        .filter((x): x is string => typeof x === 'string')
        .map((x) => normalizeIndicator(x))
        .filter(Boolean))].slice(0, 5000);
      const currentTicket = typeof ticket === 'string' ? ticket.trim().toLowerCase() : '';
      const [entryRows, caseRows] = await Promise.all([
        db.query<{ data: BlocklistEntry }>('SELECT data FROM entries WHERE client_id = $1', [id]),
        db.query<{ ticket: string; indicators: string[]; display_name: string | null; created_by: string | null; created_at: string }>(
          'SELECT ticket, indicators, display_name, created_by, created_at FROM client_cases WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1000',
          [id]
        )
      ]);
      type R = NonNullable<ReturnType<typeof toRange>>;
      const contains = (outer: R | null, inner: R | null) =>
        Boolean(outer && inner && outer.family === inner.family && outer.start <= inner.start && inner.end <= outer.end);
      const entries = entryRows.map((r) => r.data);
      const activeExact = new Set(entries.filter((e) => e.status === 'active').map((e) => e.indicator.toLowerCase()));
      const activeNets = entries
        .filter((e) => e.status === 'active')
        .map((e) => ({ indicator: e.indicator, range: toRange(e.indicator) }))
        .filter((n) => n.range && n.range.end > n.range.start);
      const removed = new Set(entries.filter((e) => e.status === 'removed').map((e) => e.indicator.toLowerCase()));
      const previous = caseRows
        .filter((c) => c.ticket.trim().toLowerCase() !== currentTicket)
        .flatMap((c) => (c.indicators || []).map((value) => ({ value: String(value).toLowerCase(), range: toRange(String(value)), c })));

      const items = list.map((indicator) => {
        const range = toRange(indicator);
        let status: 'listed' | 'covered' | 'removed' | 'missing' = 'missing';
        let via: string | undefined;
        if (activeExact.has(indicator)) status = 'listed';
        else {
          const net = activeNets.find((n) => contains(n.range, range));
          if (net) {
            status = 'covered';
            via = net.indicator;
          } else if (removed.has(indicator)) status = 'removed';
        }
        const hit = previous.find((p) => p.value === indicator) ?? previous.find((p) => p.range && p.range.end > p.range.start && contains(p.range, range));
        return {
          indicator,
          list: status,
          via,
          previousCase: hit
            ? { ticket: hit.c.ticket, at: new Date(hit.c.created_at).toISOString(), by: hit.c.display_name || hit.c.created_by || '', via: hit.value !== indicator ? hit.value : undefined }
            : null
        };
      });
      const recentCases = caseRows.slice(0, 5).map((c) => ({
        ticket: c.ticket,
        at: new Date(c.created_at).toISOString(),
        by: c.display_name || c.created_by || '',
        count: (c.indicators || []).length
      }));
      return { items, recentCases };
    },

    // Registra o caso (ao copiar o texto). O mesmo ticket no mesmo cliente soma os indicadores.
    async saveClientCase(actor: Actor, clientId: string, ticket: unknown, indicators: unknown) {
      const id = asString(clientId, 'clientId');
      const t = String(ticket ?? '').trim().slice(0, 60);
      if (!t) throw new StoreError('Informe o ticket TLD.');
      const list = [...new Set(asArray<unknown>(indicators, 'indicators')
        .filter((x): x is string => typeof x === 'string')
        .map((x) => normalizeIndicator(x))
        .filter((x) => x && classifyIndicator(x).isValid))].slice(0, 5000);
      if (!list.length) throw new StoreError('Nenhum indicador válido no caso.');
      const client = (await db.query<{ data: Client }>('SELECT data FROM clients WHERE id = $1', [id]))[0]?.data;
      if (!client) throw new StoreError('Cliente não encontrado.', 404);
      await db.query(
        `INSERT INTO client_cases (client_id, ticket, indicators, created_by, display_name) VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (client_id, ticket) DO UPDATE SET
           indicators = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(client_cases.indicators || EXCLUDED.indicators) AS x),
           updated_at = now()`,
        [id, t, JSON.stringify(list), actor.username, actor.displayName]
      );
      await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
        actor.username, 'case.save', JSON.stringify({ clientId: id, name: client.name, ticket: t, count: list.length })
      ]);
      return { ticket: t, count: list.length, clientName: client.name };
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
  'checkClientCase',
  'setClientLogo',
  'getImportReport',
  'listImportReportIds',
  'saveClientCase',
  'getAllClients',
  'saveClient',
  'renameClient',
  'updateClient',
  'deleteClient',
  'archiveClient',
  'getClientEntries',
  'getClientEntriesPage',
  'getIndicatorEntries',
  'getCorrelationPage',
  'getClientActiveIndicatorsSet',
  'importBatch',
  'listPendingImports',
  'decidePendingImport',
  'undoImport',
  'updateClientExceptions',
  'validateAllClients',
  'cleanAllClients',
  'getReviewQueue',
  'reviewEntries',
  'getComments',
  'addComment',
  'deleteComment',
  'getCommentCounts',
  'getAuditLog',
  'lookupIndicators',
  'getEvolution',
  'cleanRedundantEntries',
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
