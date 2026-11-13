import test from 'node:test';
import assert from 'node:assert/strict';
import type { CredentialItem, SecretNote, VaultPayload } from '../types/vault.ts';
import { mergeRemoteRecords } from './syncMerge.ts';

const cred = (id: string, revision: number, title = id) =>
  ({ id, revision, title }) as unknown as CredentialItem;
const note = (id: string, revision: number) =>
  ({ id, revision }) as unknown as SecretNote;

function vault(credentials: CredentialItem[], notes: SecretNote[] = []): VaultPayload {
  return {
    version: 1,
    vaultId: 'vault-merge-test',
    revision: 3,
    vaultName: 'Teste',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    credentials,
    notes,
    settings: {
      autoLockMinutes: 5,
      theme: 'dark',
      syncEnabled: true,
      syncReauthSecretHex: 'ab'.repeat(32),
    },
  };
}

test('Mesclagem mantém o que só existe aqui e acrescenta o que veio de fora', () => {
  // "local-depois" foi criado depois do desbloqueio: precisa sobreviver à atualização remota.
  const base = vault([cred('a', 1), cred('local-depois', 1)], [note('n1', 1)]);
  const merged = mergeRemoteRecords(base, [cred('remota', 1)], [note('n2', 1)]);
  assert.ok(merged);
  assert.deepEqual(
    merged.credentials.map((c) => c.id).sort(),
    ['a', 'local-depois', 'remota']
  );
  assert.deepEqual(merged.notes.map((n) => n.id).sort(), ['n1', 'n2']);
});

test('Mesclagem fica com a revisão maior e ignora a remota mais velha', () => {
  const base = vault([cred('a', 2, 'local'), cred('b', 5, 'local')]);
  const merged = mergeRemoteRecords(base, [cred('a', 3, 'remota'), cred('b', 4, 'remota')], []);
  assert.ok(merged);
  const byId = new Map(merged.credentials.map((c) => [c.id, c]));
  assert.equal((byId.get('a') as unknown as { title: string }).title, 'remota');
  assert.equal((byId.get('b') as unknown as { title: string }).title, 'local');
});

test('Mesclagem preserva as configurações e o segredo de reconexão, e não grava à toa', () => {
  const base = vault([cred('a', 2)]);
  assert.equal(mergeRemoteRecords(base, [cred('a', 2)], []), null);
  assert.equal(mergeRemoteRecords(base, [cred('a', 1)], []), null);

  const now = new Date('2026-11-08T12:00:00.000Z');
  const merged = mergeRemoteRecords(base, [cred('c', 1)], [], now);
  assert.ok(merged);
  assert.deepEqual(merged.settings, base.settings);
  assert.equal(merged.updatedAt, now.toISOString());
  assert.equal(merged.vaultId, base.vaultId);
});
