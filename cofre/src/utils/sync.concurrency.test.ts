import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createDonutVaultApp } from '../../server.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import { inspectRawDatabaseStateForTest } from '../db/repository.ts';
import { resetRateLimitsForTests } from '../middleware/auth.ts';
import { createSampleSpringFieldPayload } from './seedData.ts';

const FAST_KDF = { t: 1, m: 4096, p: 1, dkLen: 32 };

let server: Server;
let baseUrl = '';

test.before(async () => {
  resetRateLimitsForTests();
  const app = await createDonutVaultApp({ skipVite: true });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Envios simultâneos ao mesmo cofre não duplicam cursor, registro nem aceitam duas edições da mesma revisão', async () => {
  const userUid = CryptoEngine.randomId('usr-concorrencia');
  const vaultId = CryptoEngine.randomId('vault-concorrencia');

  const regRes = await fetch(`${baseUrl}/api/v1/auth/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userUid,
      deviceName: 'PC de teste de concorrência',
      platform: 'desktop-web',
      authMethod: 'webauthn-passkey',
    }),
  });
  assert.equal(regRes.status, 201);
  const reg = await regRes.json();
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${reg.sessionToken}`,
    'X-Device-Id': reg.device.deviceId,
    'X-User-Uid': userUid,
  };

  const payload = createSampleSpringFieldPayload();
  payload.vaultId = vaultId;
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    'Frase de teste longa para concorrência 2026',
    payload,
    FAST_KDF
  );
  const vaultRes = await fetch(`${baseUrl}/api/v1/sync/vault`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      vaultId,
      activeKeyEpoch: 1,
      kdfParams: FAST_KDF,
      saltHex: envelope.saltHex,
      wrappedDekHex: envelope.wrappedDekHex,
      dekNonceHex: envelope.dekNonceHex,
    }),
  });
  assert.equal(vaultRes.status, 200);

  const buildOp = async (
    recordId: string,
    revision: number,
    expectedBaseRevision: number,
    note: string
  ) => ({
    operationId: CryptoEngine.randomId('op'),
    vaultId,
    expectedBaseRevision,
    clientTimestamp: new Date().toISOString(),
    record: await CryptoEngine.sealRecordV2(
      sessionDek,
      vaultId,
      recordId,
      'note',
      revision,
      1,
      false,
      { note }
    ),
  });

  const push = async (operations: unknown[]) => {
    const res = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ vaultId, operations }),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as {
      latestCursor: number;
      results: { status: string }[];
    };
  };

  // 1. Registros diferentes enviados ao mesmo tempo por dois aparelhos
  for (let round = 0; round < 8; round++) {
    const [opA, opB] = await Promise.all([
      buildOp(`rec-pc-${round}`, 1, 0, 'pc'),
      buildOp(`rec-celular-${round}`, 1, 0, 'celular'),
    ]);
    const [resA, resB] = await Promise.all([push([opA]), push([opB])]);
    assert.notEqual(
      resA.latestCursor,
      resB.latestCursor,
      'Dois envios simultâneos não podem receber o mesmo cursor'
    );
  }

  // 2. Duas edições do mesmo registro partindo da mesma revisão: só uma pode ser aceita
  await push([await buildOp('rec-compartilhado', 1, 0, 'original')]);
  const [editPc, editCelular] = await Promise.all([
    buildOp('rec-compartilhado', 2, 1, 'edição do PC'),
    buildOp('rec-compartilhado', 2, 1, 'edição do celular'),
  ]);
  const editResults = await Promise.all([push([editPc]), push([editCelular])]);
  assert.deepEqual(
    editResults.map((r) => r.results[0].status).sort(),
    ['APPLIED', 'CONFLICT'],
    'A segunda edição concorrente deve virar conflito, não sobrescrever a primeira'
  );

  // 3. O mesmo registro novo criado em dois aparelhos ao mesmo tempo
  const [newPc, newCelular] = await Promise.all([
    buildOp('rec-novo-duplo', 1, 0, 'PC'),
    buildOp('rec-novo-duplo', 1, 0, 'celular'),
  ]);
  const newResults = await Promise.all([push([newPc]), push([newCelular])]);
  assert.deepEqual(
    newResults.map((r) => r.results[0].status).sort(),
    ['APPLIED', 'CONFLICT']
  );

  // 4. No banco: cursores e recordIds únicos
  const state = await inspectRawDatabaseStateForTest(vaultId);
  const cursors = state.encryptedRecords.map((r) => r.serverCursor);
  const recordIds = state.encryptedRecords.map((r) => r.recordId);
  assert.equal(new Set(cursors).size, cursors.length, 'Cursor duplicado no banco');
  assert.equal(new Set(recordIds).size, recordIds.length, 'Registro duplicado no banco');
  assert.equal(recordIds.length, 8 * 2 + 2);
});
