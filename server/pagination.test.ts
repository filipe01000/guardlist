import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryDatabase } from './db.ts';
import { createStore, type Actor } from './store.ts';
import type { BlocklistEntry, Client } from '../src/types/index.ts';

const actor: Actor = { username: 'admin', displayName: 'Admin', role: 'admin' };

test('consultas SQL paginam listas e agregam correlação sem perder o contexto global', async (t) => {
  const db = await openMemoryDatabase();
  t.after(() => db.close?.());
  const store = createStore(db);
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, name, isArchived] of [
    ['a', 'Alpha', false], ['b', 'Beta', false], ['c', 'Gamma', false],
    ['d', 'Delta', false], ['z', 'Arquivado', true]
  ] as const) {
    const client: Client = { id, name, isArchived, createdAt: today, updatedAt: today, lastUpdateDate: today, targetFirewall: 'FortiGate' };
    await db.query('INSERT INTO clients (id, data) VALUES ($1, $2::jsonb)', [id, JSON.stringify(client)]);
  }
  const entry = (id: string, clientId: string, indicator: string, extra: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
    id, clientId, indicator, type: indicator.includes('/') ? 'CIDR_v4' : indicator.includes(':') ? 'IPv6' : indicator.includes('example') ? 'Domain' : 'IPv4',
    addedDate: today, status: 'active', ...extra
  });
  const entries = [
    entry('a10', 'a', '192.0.2.10'), entry('a10-copy', 'a', '192.0.2.10'),
    entry('a2', 'a', '192.0.2.2', { sourceTicket: '%Urgente_100', notes: 'Revisar CAIXA', numericValue: 3221225986 }),
    entry('a-cidr', 'a', '203.0.113.0/24'), entry('a-domain', 'a', 'abc.example'),
    entry('a-ip6', 'a', '2001:db8::2', { addedDate: '2000-01-01' }),
    entry('a-archive', 'a', '198.51.100.50', { addedDate: '2000-01-01' }),
    entry('a-removed', 'a', '192.0.2.1', { status: 'removed' }),
    entry('b10', 'b', '192.0.2.10'), entry('b2', 'b', '192.0.2.2'),
    entry('b-cidr', 'b', '203.0.113.0/24'), entry('b-domain', 'b', 'abc.example'),
    entry('c10', 'c', '192.0.2.10'), entry('c-domain', 'c', 'abc.example'),
    entry('d10', 'd', '192.0.2.10'), entry('z10', 'z', '192.0.2.10'), entry('z50', 'z', '198.51.100.50')
  ];
  for (const e of entries) {
    await db.query('INSERT INTO entries (id, client_id, indicator, status, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [e.id, e.clientId, e.indicator, e.status, JSON.stringify(e)]);
  }

  await t.test('filtros preservam busca literal, totais do cliente e isolamento', async () => {
    const page = await store.getClientEntriesPage(actor, { clientId: 'a', status: 'active', type: 'IPv4', search: '  %URGENTE_  ', pageSize: 1 });
    assert.deepEqual(page.entries.map((e) => e.id), ['a2']);
    assert.equal(page.total, 1);
    assert.equal(page.totalClient, 8);
    assert.equal(page.activeCount, 7);
    assert.equal((await store.getClientEntriesPage(actor, { clientId: 'a', search: 'caixa' })).total, 1);
    assert.equal((await store.getClientEntriesPage(actor, { clientId: 'a', search: "' OR 1=1 --" })).total, 0);
    assert.equal((await store.getClientEntriesPage(actor, { clientId: 'a', status: 'removed' })).total, 1);
    assert.equal((await store.getClientEntriesPage(actor, { clientId: 'a', status: 'active', period: '7d' })).total, 5);
  });

  await t.test('ordenação IPv4 é numérica com fallback e páginas são limitadas e corrigidas', async () => {
    const first = await store.getClientEntriesPage(actor, { clientId: 'a', status: 'active', sort: 'numeric', pageSize: 2 });
    assert.deepEqual(first.entries.map((e) => e.id), ['a2', 'a10']);
    const second = await store.getClientEntriesPage(actor, { clientId: 'a', status: 'active', sort: 'numeric', page: 2, pageSize: 2 });
    assert.deepEqual(second.entries.map((e) => e.id), ['a10-copy', 'a-archive']);
    const last = await store.getClientEntriesPage(actor, { clientId: 'a', status: 'active', page: 999, pageSize: 2 });
    assert.equal(last.page, 4);
    assert.equal(last.entries.length, 1);
    const date = await store.getClientEntriesPage(actor, { clientId: 'a', sort: 'date', pageSize: 9999 });
    assert.equal(date.pageSize, 500);
    assert.equal(date.entries.length, 8);
    assert.equal(date.entries.at(-1)?.addedDate, '2000-01-01');
    const empty = await store.getClientEntriesPage(actor, { clientId: 'missing', page: 20 });
    assert.deepEqual({ page: empty.page, total: empty.total, entries: empty.entries }, { page: 1, total: 0, entries: [] });
  });

  await t.test('dashboard mantém métricas anteriores e limita recorrentes a quatro clientes ativos', async () => {
    const stats = await store.getDashboardStats();
    assert.equal(stats.totalActiveAcrossAll, 16);
    assert.equal(stats.totalIpsAcrossAll, 14);
    assert.equal(stats.totalCidrsAcrossAll, 2);
    assert.equal(stats.totalCorrelatedIps, 5);
    assert.equal(stats.addedThisWeekCount, 14);
    assert.equal(stats.activeCounts.a, 7);
    assert.equal(stats.ipCounts.a, 6);
    assert.equal(stats.cidrCounts.a, 1);
    assert.equal(stats.recurring.length, 4);
    assert.deepEqual(stats.recurring[0], { indicator: '192.0.2.10', count: 4 });
    assert.ok(!stats.recurring.some((item) => item.indicator === '198.51.100.50'));
  });

  await t.test('correlação distingue clientes, ignora arquivados e mantém summary global ao filtrar', async () => {
    const result = await store.getCorrelationPage(actor, { pageSize: 1 });
    assert.equal(result.total, 4);
    assert.equal(result.sharedIndicators.length, 1);
    assert.equal(result.sharedIndicators[0].indicator, '192.0.2.10');
    assert.equal(result.sharedIndicators[0].occurrencesCount, 4);
    assert.deepEqual(result.summary, { totalCorrelatedIpsCount: 4, maxDissemination: 4, cidrSharedCount: 1, criticalCount: 1, activeClientsCount: 4 });
    assert.deepEqual(result.clientOverlapTable[0], { clientA: 'Alpha', clientB: 'Beta', sharedCount: 4 });
    const filtered = await store.getCorrelationPage(actor, { search: 'beta', clientId: 'b', severity: 'high', page: 99, pageSize: 1 });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.page, 1);
    assert.equal(filtered.sharedIndicators[0].indicator, 'abc.example');
    assert.deepEqual(filtered.summary, result.summary);
    assert.deepEqual(filtered.clientOverlapTable, result.clientOverlapTable);
    assert.equal((await store.getCorrelationPage(actor, { clientId: 'z' })).total, 0);
    assert.equal((await store.getCorrelationPage(actor, { search: '%', pageSize: 999 })).pageSize, 100);
  });

  await t.test('dossiê consulta indicador exato e comentários só dos IDs pedidos', async () => {
    const exact = await store.getIndicatorEntries(actor, ' 192.0.2.10 ');
    assert.equal(exact.length, 5);
    assert.ok(exact.every((e) => e.indicator === '192.0.2.10' && e.clientId !== 'z'));
    assert.deepEqual((await store.getIndicatorEntries(actor, '192.0.2.1')).map((e) => e.status), ['removed']);
    for (const id of ['a2', 'a2', 'a10']) {
      await db.query("INSERT INTO comments (entry_id, client_id, indicator, body) VALUES ($1, 'a', '192.0.2.2', 'Comentário')", [id]);
    }
    assert.deepEqual(await store.getCommentCounts(actor, 'a', ['a2']), { a2: 2 });
    assert.deepEqual(await store.getCommentCounts(actor, 'a', []), {});
    assert.deepEqual(await store.getCommentCounts(actor, 'a'), { a2: 2, a10: 1 });
  });

  await t.test('desfazer valida cliente do histórico e reverte lista, versões e auditoria se falhar', async () => {
    const saved = { id: 'snapshot-a', clientId: 'a', clientName: 'Alpha', createdAt: new Date().toISOString(), label: 'Antes', entriesCount: 1, entries: [entry('restored-a', 'a', '198.51.100.8')] };
    await db.query('INSERT INTO snapshots (id, client_id, created_at, data) VALUES ($1, $2, $3, $4::jsonb)', ['snapshot-a', 'a', saved.createdAt, JSON.stringify(saved)]);
    for (const clientId of ['a', 'b']) {
      const record = { id: `history-${clientId}`, clientId, date: saved.createdAt };
      await db.query('INSERT INTO history (id, client_id, happened_at, data) VALUES ($1, $2, $3, $4::jsonb)', [record.id, clientId, record.date, JSON.stringify(record)]);
    }
    const beforeEntries = await store.getClientEntries(actor, 'a');
    const beforeSnapshots = await store.getClientSnapshots(actor, 'a');
    const beforeAudit = await db.query('SELECT action, detail FROM audit_log ORDER BY id');
    await assert.rejects(() => store.undoImport(actor, 'snapshot-a', 'history-b'), /mesmo cliente/);
    await assert.rejects(() => store.undoImport(actor, 'snapshot-a', 'missing-history'), /Importação não encontrada/);
    assert.deepEqual(await store.getClientEntries(actor, 'a'), beforeEntries);
    assert.deepEqual(await store.getClientSnapshots(actor, 'a'), beforeSnapshots);
    assert.deepEqual(await db.query('SELECT action, detail FROM audit_log ORDER BY id'), beforeAudit);

    const originalTx = db.tx.bind(db);
    db.tx = (fn) => originalTx((q) => fn(async (sql, params) => {
      if (sql.includes('UPDATE history SET')) throw new Error('Falha ao marcar histórico');
      return q(sql, params);
    }));
    try {
      await assert.rejects(() => store.undoImport(actor, 'snapshot-a', 'history-a'), /Falha ao marcar histórico/);
    } finally {
      db.tx = originalTx;
    }
    assert.deepEqual(await store.getClientEntries(actor, 'a'), beforeEntries);
    assert.deepEqual(await store.getClientSnapshots(actor, 'a'), beforeSnapshots);
    assert.deepEqual(await db.query('SELECT action, detail FROM audit_log ORDER BY id'), beforeAudit);
    assert.deepEqual(await store.undoImport(actor, 'snapshot-a', 'history-a'), { restoredCount: 1 });
    assert.deepEqual((await store.getClientEntries(actor, 'a')).map((e) => e.id), ['restored-a']);
    const histories = await db.query<{ id: string; undone: boolean | null }>("SELECT id, (data->>'undone')::boolean AS undone FROM history ORDER BY id");
    assert.deepEqual(histories, [{ id: 'history-a', undone: true }, { id: 'history-b', undone: null }]);
  });
});
