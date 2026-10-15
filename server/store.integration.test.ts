import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { BlocklistEntry, Client, ImportHistoryRecord, ImportOutcome } from '../src/types/index.ts';
import { openMemoryDatabase } from './db.ts';
import { createStore, StoreError, type Actor, type Store } from './store.ts';

const admin: Actor = { username: 'admin-test', displayName: 'Administrador', role: 'admin' };
const analyst: Actor = { username: 'analyst-test', displayName: 'Analista', role: 'analyst' };
const otherAnalyst: Actor = { username: 'other-test', displayName: 'Outro analista', role: 'analyst' };
const today = '2026-10-11';

function client(id: string): Client {
  return { id, name: `Cliente ${id}`, isArchived: false, createdAt: `${today}T00:00:00Z`, updatedAt: `${today}T00:00:00Z`, lastUpdateDate: null };
}

function entry(id: string, clientId: string, indicator: string): BlocklistEntry {
  return { id, clientId, indicator, type: indicator.includes('/') ? 'CIDR_v4' : 'IPv4', addedDate: today, status: 'active', notes: 'Origem preservada' };
}

function payload(clientId: string, id: string, entries: BlocklistEntry[], mode: 'append' | 'replace' = 'append', seen: string[] = []) {
  const history: ImportHistoryRecord = {
    id, date: `${today}T00:00:00Z`, isoWeek: '2026-W41', clientId, clientName: `Cliente ${clientId}`,
    totalBefore: 0, addedCount: 0, duplicatesDiscarded: 0, coveredByCidrDiscarded: 0, invalidsDiscarded: 0, totalAfter: 0
  };
  return { clientId, entries, mode, history, todayStr: today, seen };
}

async function setup(t: TestContext) {
  const db = await openMemoryDatabase();
  t.after(() => db.close?.());
  const store = createStore(db);
  await store.saveClient(admin, client('a'));
  await store.saveClient(admin, client('b'));
  return { db, store };
}

async function active(store: Store, clientId: string) {
  return (await store.getClientEntries(admin, clientId, 'active')).sort((a, b) => a.id.localeCompare(b.id));
}

function completed(outcome: ImportOutcome) {
  assert.equal(outcome.status, 'done');
  assert.ok(outcome.snapshotId);
  assert.ok(outcome.historyId);
  return { snapshotId: outcome.snapshotId, historyId: outcome.historyId };
}

test('append preserva clientes, evita indicador já ativo e registra autor e histórico reais', async (t) => {
  const { store } = await setup(t);
  const b = entry('b-original', 'b', '203.0.113.1');
  await store.importBatch(admin, payload('b', 'hist-b', [b]));
  const first = await store.importBatch(analyst, payload('a', 'hist-a1', [entry('a-first', 'a', b.indicator)]));
  completed(first);
  assert.equal(first.added, 1);
  const previous = await active(store, 'a');
  const next = await store.importBatch(analyst, payload('a', 'hist-a2', [entry('a-duplicate', 'a', b.indicator), entry('a-second', 'a', '198.51.100.2')]));
  assert.equal(next.added, 1);
  assert.equal(next.removed, 0);
  assert.equal((await active(store, 'a')).length, 2);
  assert.deepEqual((await active(store, 'a')).find((e) => e.id === 'a-first'), previous[0]);
  assert.deepEqual(await active(store, 'b'), [{ ...b, addedBy: admin.displayName }]);
  const record = (await store.getHistoryRecords(admin, 'a')).find((r) => r.id === 'hist-a2');
  assert.equal(record?.totalBefore, 1);
  assert.equal(record?.totalAfter, 2);
  assert.equal(record?.importedBy, analyst.displayName);
});

test('importação aplica exceções e retira somente IPs cobertos do cliente alvo', async (t) => {
  const { store } = await setup(t);
  await store.updateClientExceptions(admin, 'a', [{ indicator: '192.0.2.1', reason: 'Parceiro' }]);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-small', 'a', '203.0.113.1')]));
  await store.importBatch(admin, payload('b', 'seed-b', [entry('b-small', 'b', '203.0.113.1')]));
  const beforeB = await active(store, 'b');
  const result = await store.importBatch(admin, payload('a', 'cidr-a', [entry('a-net', 'a', '203.0.113.0/24'), entry('a-excepted', 'a', '192.0.2.1')]));
  assert.equal(result.blockedByException, 1);
  assert.equal(result.retired, 1);
  assert.deepEqual((await active(store, 'a')).map((e) => e.indicator), ['203.0.113.0/24']);
  const [removed] = await store.getClientEntries(admin, 'a', 'removed');
  assert.equal(removed.id, 'a-small');
  assert.match(removed.notes || '', /Coberto pelo CIDR/);
  assert.deepEqual(await active(store, 'b'), beforeB);
});

test('replace arquiva ausentes, preserva ID existente e atualiza visto por último', async (t) => {
  const { store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-kept', 'a', '203.0.113.1'), entry('a-old', 'a', '198.51.100.1')]));
  await store.importBatch(admin, payload('b', 'seed-b', [entry('b-kept', 'b', '198.51.100.1')]));
  const beforeB = await active(store, 'b');
  const result = await store.importBatch(admin, payload('a', 'replace-a', [entry('a-ignored-new-id', 'a', '203.0.113.1'), entry('a-new', 'a', '192.0.2.2')], 'replace'));
  completed(result);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  const kept = (await active(store, 'a')).find((e) => e.indicator === '203.0.113.1');
  assert.equal(kept?.id, 'a-kept');
  assert.ok(kept?.lastSeenAt);
  const [removed] = await store.getClientEntries(admin, 'a', 'removed');
  assert.equal(removed.id, 'a-old');
  assert.ok(removed.removedAt);
  assert.equal(removed.removedBy, admin.displayName);
  assert.deepEqual(await active(store, 'b'), beforeB);
});

test('replace do analista aguarda admin e aprovação preserva solicitante e decisão', async (t) => {
  const { db, store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-old', 'a', '198.51.100.1')]));
  const before = await active(store, 'a');
  const pending = await store.importBatch(analyst, payload('a', 'request-a', [entry('a-new', 'a', '192.0.2.2')], 'replace'));
  assert.equal(pending.status, 'pending');
  assert.ok(pending.pendingId);
  assert.deepEqual(await active(store, 'a'), before);
  assert.deepEqual(await store.listPendingImports(otherAnalyst), []);
  assert.equal((await store.listPendingImports(analyst))[0].status, 'pending');
  await assert.rejects(() => store.decidePendingImport(analyst, pending.pendingId!, 'approve'), (error) => error instanceof StoreError && error.status === 403);
  const approved = await store.decidePendingImport(admin, pending.pendingId, 'approve', '  Conferido  ');
  assert.ok(approved);
  completed(approved);
  assert.deepEqual((await active(store, 'a')).map((e) => [e.indicator, e.addedBy]), [['192.0.2.2', analyst.displayName]]);
  const [decision] = await store.listPendingImports(analyst);
  assert.equal(decision.status, 'approved');
  assert.equal(decision.decidedBy, admin.displayName);
  assert.equal(decision.decisionNote, 'Conferido');
  const history = (await store.getHistoryRecords(admin, 'a')).find((r) => r.id === 'request-a');
  assert.equal(history?.importedBy, analyst.displayName);
  assert.match(history?.notes || '', /Aprovado por Administrador/);
  const [audit] = await db.query<{ username: string }>("SELECT username FROM audit_log WHERE action = 'import.approve'");
  assert.equal(audit.username, admin.username);
  await assert.rejects(() => store.decidePendingImport(admin, pending.pendingId!, 'approve'), (error) => error instanceof StoreError && error.status === 404);
});

test('limite de aprovação permite lote no limite e rejeição não altera lista ou versões', async (t) => {
  const { store } = await setup(t);
  await store.saveAppSettings(admin, { ...(await store.getAppSettings()), approvalThreshold: 1 });
  const allowed = await store.importBatch(analyst, payload('a', 'allowed-a', [entry('a-allowed', 'a', '203.0.113.1')]));
  completed(allowed);
  const before = await active(store, 'a');
  const snapshots = await store.getClientSnapshots(admin, 'a');
  const history = await store.getHistoryRecords(admin, 'a');
  const pending = await store.importBatch(analyst, payload('a', 'reject-a', [entry('a-rejected1', 'a', '192.0.2.1'), entry('a-rejected2', 'a', '192.0.2.2')]));
  assert.equal(pending.status, 'pending');
  assert.ok(pending.pendingId);
  assert.equal(await store.decidePendingImport(admin, pending.pendingId, 'reject', 'Duplicado na fonte'), null);
  assert.deepEqual(await active(store, 'a'), before);
  assert.deepEqual(await store.getClientSnapshots(admin, 'a'), snapshots);
  assert.deepEqual(await store.getHistoryRecords(admin, 'a'), history);
  assert.equal((await store.listPendingImports(analyst))[0].status, 'rejected');
});

test('undo restaura a lista anterior completa e marca apenas histórico da importação', async (t) => {
  const { db, store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-original', 'a', '203.0.113.1')]));
  await store.importBatch(admin, payload('b', 'seed-b', [entry('b-original', 'b', '198.51.100.1')]));
  const beforeA = await store.getClientEntries(admin, 'a');
  const beforeB = await store.getClientEntries(admin, 'b');
  const result = completed(await store.importBatch(admin, payload('a', 'replace-a', [entry('a-new', 'a', '192.0.2.2')], 'replace')));
  assert.equal((await store.undoImport(admin, result.snapshotId, result.historyId)).restoredCount, beforeA.length);
  assert.deepEqual(await store.getClientEntries(admin, 'a'), beforeA);
  assert.deepEqual(await store.getClientEntries(admin, 'b'), beforeB);
  const rows = await db.query<{ id: string; undone: boolean | null }>("SELECT id, (data->>'undone')::boolean AS undone FROM history ORDER BY id");
  assert.deepEqual(rows, [{ id: 'replace-a', undone: true }, { id: 'seed-a', undone: null }, { id: 'seed-b', undone: null }]);
});

test('backup inválido, cliente órfão e indicador inválido preservam dados e auditoria', async (t) => {
  const { db, store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-original', 'a', '203.0.113.1')]));
  const before = JSON.parse(await store.exportFullBackupJSON(admin));
  const auditBefore = await db.query('SELECT username, action, detail FROM audit_log ORDER BY id');
  const invalid = [
    '{', JSON.stringify({ clients: [], entries: null }),
    JSON.stringify({ ...before, clients: [client('new')], entries: [{ ...entry('bad', 'new', '192.0.2.1'), id: undefined }] }),
    JSON.stringify({ ...before, entries: [{ ...before.entries[0], clientId: 'missing-client' }] }),
    JSON.stringify({ ...before, entries: [{ ...before.entries[0], indicator: '999.999.999.999' }] })
  ];
  for (const backup of invalid) {
    await assert.rejects(() => store.restoreFullBackupJSON(admin, backup));
    assert.deepEqual(await store.getAllClients(), before.clients);
    assert.deepEqual(await store.getClientEntries(admin, 'a'), before.entries);
    assert.deepEqual(await store.getHistoryRecords(admin), before.history);
    assert.deepEqual(await store.getAppSettings(), before.settings);
    assert.deepEqual(await db.query('SELECT username, action, detail FROM audit_log ORDER BY id'), auditBefore);
  }
});

test('falha de gravação depois da limpeza do backup reverte toda restauração', async (t) => {
  const { db, store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-original', 'a', '203.0.113.1')]));
  const saved = JSON.parse(await store.exportFullBackupJSON(admin));
  const auditBefore = await db.query('SELECT username, action, detail FROM audit_log ORDER BY id');
  const tx = db.tx.bind(db);
  db.tx = (fn) => tx((q) => fn(async (sql, params) => {
    if (sql.includes('INSERT INTO history')) throw new Error('Falha de gravação simulada');
    return q(sql, params);
  }));
  const backup = JSON.stringify({ ...saved, entries: [entry('a-new', 'a', '192.0.2.1')] });
  await assert.rejects(() => store.restoreFullBackupJSON(admin, backup), /Falha de gravação simulada/);
  assert.deepEqual(await store.getAllClients(), saved.clients);
  assert.deepEqual(await store.getClientEntries(admin, 'a'), saved.entries);
  assert.deepEqual(await store.getHistoryRecords(admin), saved.history);
  assert.deepEqual(await store.getAppSettings(), saved.settings);
  assert.deepEqual(await db.query('SELECT username, action, detail FROM audit_log ORDER BY id'), auditBefore);
});

test('backup válido restaura clientes, lista, histórico e configurações; analista não restaura', async (t) => {
  const { store } = await setup(t);
  await store.importBatch(admin, payload('a', 'seed-a', [entry('a-original', 'a', '203.0.113.1')]));
  await store.saveAppSettings(admin, { ...(await store.getAppSettings()), slaDays: 14, approvalThreshold: 42 });
  const backup = await store.exportFullBackupJSON(admin);
  const saved = JSON.parse(backup);
  await store.importBatch(admin, payload('b', 'extra-b', [entry('b-extra', 'b', '192.0.2.1')]));
  await store.renameClient(admin, 'a', 'NOME MODIFICADO');
  await assert.rejects(() => store.restoreFullBackupJSON(analyst, backup), (error) => error instanceof StoreError && error.status === 403);
  const result = await store.restoreFullBackupJSON(admin, backup);
  assert.deepEqual(result, { clientsCount: 2, entriesCount: 1, historyCount: 1 });
  assert.deepEqual(await store.getAllClients(), saved.clients);
  assert.deepEqual(await store.getClientEntries(admin, 'a'), saved.entries);
  assert.deepEqual(await store.getClientEntries(admin, 'b'), []);
  assert.deepEqual(await store.getHistoryRecords(admin), saved.history);
  assert.deepEqual(await store.getAppSettings(), saved.settings);
});

test('ID de outro cliente não pode ser sobrescrito nem deslocado por importBatch', async (t) => {
  const { store } = await setup(t);
  await store.importBatch(admin, payload('b', 'seed-b', [entry('shared-id', 'b', '203.0.113.1')]));
  const beforeB = await store.getClientEntries(admin, 'b');
  await assert.rejects(() => store.importBatch(admin, payload('a', 'collision-a', [entry('shared-id', 'a', '192.0.2.1')])));
  assert.deepEqual(await store.getClientEntries(admin, 'a'), []);
  assert.deepEqual(await store.getClientEntries(admin, 'b'), beforeB);
  assert.deepEqual(await store.getHistoryRecords(admin, 'a'), []);
  assert.deepEqual(await store.getClientSnapshots(admin, 'a'), []);
});

test('casos do cliente: avisa IP já informado (exato ou dentro de CIDR) e situação na lista', async (t) => {
  const { store } = await setup(t);
  completed(await store.importBatch(admin, payload('a', 'case-seed', [entry('a-1', 'a', '203.0.113.5'), entry('a-net', 'a', '198.51.100.0/24')])));
  await store.saveClientCase(analyst, 'a', 'TLD-1', ['203.0.113.5', '192.0.2.0/24']);
  // Mesmo ticket soma os indicadores, sem repetir.
  const again = await store.saveClientCase(analyst, 'a', 'TLD-1', ['203.0.113.5', '192.0.2.77']);
  assert.equal(again.clientName, 'Cliente a');

  const check = await store.checkClientCase(analyst, 'a', ['203.0.113.5', '192.0.2.9', '198.51.100.7', '8.8.8.8'], 'TLD-2');
  const by = Object.fromEntries(check.items.map((i) => [i.indicator, i]));
  assert.equal(by['203.0.113.5'].list, 'listed');
  assert.equal(by['203.0.113.5'].previousCase?.ticket, 'TLD-1');
  assert.equal(by['192.0.2.9'].previousCase?.via, '192.0.2.0/24');
  assert.equal(by['198.51.100.7'].list, 'covered');
  assert.equal(by['198.51.100.7'].via, '198.51.100.0/24');
  assert.equal(by['198.51.100.7'].previousCase, null);
  assert.equal(by['8.8.8.8'].list, 'missing');
  assert.equal(check.recentCases[0].count, 3);

  // O próprio ticket não conta como caso anterior; outro cliente não enxerga os casos deste.
  const same = await store.checkClientCase(analyst, 'a', ['203.0.113.5'], 'TLD-1');
  assert.equal(same.items[0].previousCase, null);
  const other = await store.checkClientCase(analyst, 'b', ['203.0.113.5'], 'TLD-9');
  assert.equal(other.items[0].previousCase, null);
  await assert.rejects(store.saveClientCase(analyst, 'a', '  ', ['1.2.3.4']), StoreError);
});
