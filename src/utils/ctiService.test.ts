import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlocklistEntry, Client } from '../types/index.ts';
import { localDossier } from './ctiService.ts';

test('dossiê conta dois clientes, preserva histórico de reimportação e prioriza registro ativo', () => {
  const client = (id: string): Client => ({
    id, name: `Cliente ${id}`, isArchived: false, createdAt: '2026-10-01', updatedAt: '2026-10-11', lastUpdateDate: null
  });
  const clients = new Map([['a', client('a')], ['b', client('b')]]);
  const entries: BlocklistEntry[] = [
    { id: 'a-old', clientId: 'a', indicator: '203.0.113.1', type: 'IPv4', addedDate: '2026-10-01', status: 'removed', sourceTicket: 'Primeira inclusão' },
    { id: 'a-current', clientId: 'a', indicator: '203.0.113.1', type: 'IPv4', addedDate: '2026-10-11', status: 'active', sourceTicket: 'Reimportação' },
    { id: 'b-old', clientId: 'b', indicator: '203.0.113.1', type: 'IPv4', addedDate: '2026-10-05', status: 'removed', sourceTicket: 'Cliente B', removedAt: '2026-10-09T12:00:00.000Z' },
    { id: 'unrelated', clientId: 'a', indicator: '198.51.100.1', type: 'IPv4', addedDate: '2026-10-07', status: 'active' }
  ];
  for (const records of [entries, [...entries].reverse()]) {
    const dossier = localDossier('203.0.113.1', records, clients);
    assert.equal(dossier.correlatedClients.length, 2);
    const a = dossier.correlatedClients.find(c => c.clientId === 'a');
    assert.equal(a?.status, 'active');
    assert.equal(a?.ticket, 'Reimportação');
    assert.equal(a?.addedDate, '2026-10-11');
    assert.equal(dossier.correlatedClients.find(c => c.clientId === 'b')?.status, 'removed');
    assert.deepEqual(dossier.timeline.filter(event => event.event === 'inclusao').map(event => [event.date, event.clientName, event.source]), [
      ['2026-10-11', 'Cliente a', 'Reimportação'],
      ['2026-10-05', 'Cliente b', 'Cliente B'],
      ['2026-10-01', 'Cliente a', 'Primeira inclusão']
    ]);
    assert.deepEqual(dossier.timeline.filter(event => event.event === 'remocao').map(event => [event.date, event.clientName]), [['2026-10-09', 'Cliente b']]);
  }
});

test('dossiê não inventa nada: sem registros, sem clientes e sem linha do tempo', () => {
  const dossier = localDossier('192.0.2.77', [], new Map());
  assert.deepEqual(dossier, { correlatedClients: [], timeline: [] });
});
