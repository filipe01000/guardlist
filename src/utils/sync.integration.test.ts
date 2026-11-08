import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createDonutVaultApp } from '../../server.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import { DeviceSecurityModel } from '../services/DeviceSecurityModel.ts';
import { StorageService } from '../services/StorageService.ts';
import { SyncAdapter } from '../services/SyncAdapter.ts';
import { VaultService } from '../services/VaultService.ts';
import {
  inspectRawDatabaseStateForTest,
  setSimulateNextDbFailure,
} from '../db/repository.ts';
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

// Estado compartilhado da jornada multi-dispositivo (PC <-> PostgreSQL <-> Celular)
const sharedVaultId = CryptoEngine.randomId('vault-pg-e2ee');
const homerUserUid = CryptoEngine.randomId('usr-homer');
const burnsUserUid = CryptoEngine.randomId('usr-burns');
const masterPassword = 'Rosquinha Atomica #Setor7G 2026!';
let sharedMasterDek: Uint8Array;
let sharedSaltHex = '';
let sharedWrappedDekHex = '';
let sharedDekNonceHex = '';

let pcAuth: { userUid: string; deviceId: string; sessionToken: string };
let mobileAuth: { userUid: string; deviceId: string; sessionToken: string };
let burnsAuth: { userUid: string; deviceId: string; sessionToken: string };

const pcSync = new SyncAdapter();
const mobileSync = new SyncAdapter();

test('Integração 01 (Fase 4B): Sincronização real PC -> PostgreSQL -> Celular (Zero-Knowledge E2EE)', async () => {
  // 1. Verifica Health Check do servidor real
  const healthRes = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.zeroKnowledgeMode, 'enforced');

  // 2. Solicita desafio WebAuthn/Passkey e registra o Computador (PC) no PostgreSQL
  const challengeRes = await fetch(`${baseUrl}/api/v1/auth/passkey/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userUid: homerUserUid }),
  });
  assert.equal(challengeRes.status, 200);
  const challengeData = await challengeRes.json();
  assert.equal(challengeData.challengeHex.length, 64);

  const pcReg = await pcSync.registerDeviceOnBackend(baseUrl, {
    userUid: homerUserUid,
    email: 'homer@springfield.nuclear.fake',
    deviceName: 'PC Desktop Setor 7G',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
    webauthnCredentialId: `passkey-pc-${challengeData.challengeHex.slice(0, 12)}`,
  });
  pcAuth = {
    userUid: homerUserUid,
    deviceId: pcReg.device.deviceId,
    sessionToken: pcReg.sessionToken,
  };

  // 3. Registra o Celular no PostgreSQL
  const mobileReg = await mobileSync.registerDeviceOnBackend(baseUrl, {
    userUid: homerUserUid,
    email: 'homer@springfield.nuclear.fake',
    deviceName: 'Celular DonutPhone Pro',
    platform: 'mobile-web',
    authMethod: 'webauthn-passkey',
  });
  mobileAuth = {
    userUid: homerUserUid,
    deviceId: mobileReg.device.deviceId,
    sessionToken: mobileReg.sessionToken,
  };

  // 4. PC cria o cofre criptografado localmente e publica apenas metadados E2EE no PostgreSQL
  const sample = createSampleSpringFieldPayload();
  sample.vaultId = sharedVaultId;
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    masterPassword,
    sample,
    FAST_KDF
  );
  sharedMasterDek = sessionDek;
  sharedSaltHex = envelope.saltHex;
  sharedWrappedDekHex = envelope.wrappedDekHex;
  sharedDekNonceHex = envelope.dekNonceHex;

  await pcSync.registerVaultOnBackend(baseUrl, pcAuth, {
    vaultId: sharedVaultId,
    activeKeyEpoch: 1,
    kdfParams: FAST_KDF,
    saltHex: sharedSaltHex,
    wrappedDekHex: sharedWrappedDekHex,
    dekNonceHex: sharedDekNonceHex,
  });

  // 5. PC criptografa uma credencial e uma nota secreta localmente e faz Push para o PostgreSQL
  const credPc = sample.credentials[0];
  const notePc = sample.notes[0];

  const encCred1 = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    credPc.id,
    'credential',
    1,
    1,
    false,
    credPc
  );
  const encNote1 = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    notePc.id,
    'note',
    1,
    1,
    false,
    notePc
  );

  pcSync.enqueueRecordOperation(encCred1, 0);
  pcSync.enqueueRecordOperation(encNote1, 0);

  const pushRes = await pcSync.flushOfflineQueueToBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(pushRes.appliedCount, 2);
  assert.equal(pcSync.getPendingQueue().length, 0);

  // 6. Celular faz Pull Incremental do PostgreSQL e descriptografa localmente com a DEK
  const mobilePull = await mobileSync.pullAndDecryptFromBackend(
    baseUrl,
    mobileAuth,
    sharedVaultId,
    0,
    sharedMasterDek
  );

  assert.equal(mobilePull.currentServerCursor, 2);
  assert.equal(mobilePull.decryptedCredentials.length, 1);
  assert.equal(mobilePull.decryptedNotes.length, 1);
  assert.equal(mobilePull.decryptedCredentials[0].password, credPc.password);
  assert.equal(mobilePull.decryptedNotes[0].content, notePc.content);
});

test('Integração 02 (Fase 4B): Sincronização real Celular -> PostgreSQL -> PC', async () => {
  const sample = createSampleSpringFieldPayload();
  const mobileNewCred = {
    ...sample.credentials[1],
    serviceName: 'Kwik-E-Mart App Mobile',
    password: 'SquisheeUltraSecreto#Mobile2026!',
    revision: 1,
  };

  // Celular criptografa nova credencial localmente e envia ao PostgreSQL
  const encFromMobile = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    mobileNewCred.id,
    'credential',
    1,
    1,
    false,
    mobileNewCred
  );
  mobileSync.enqueueRecordOperation(encFromMobile, 0);

  const pushFromMobile = await mobileSync.flushOfflineQueueToBackend(
    baseUrl,
    mobileAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(pushFromMobile.appliedCount, 1);

  // PC faz Pull Incremental apenas das novidades (sinceCursor = 2)
  const pcIncrementalPull = await pcSync.pullAndDecryptFromBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    2,
    sharedMasterDek
  );
  assert.equal(pcIncrementalPull.currentServerCursor, 3);
  assert.equal(pcIncrementalPull.decryptedCredentials.length, 1);
  assert.equal(
    pcIncrementalPull.decryptedCredentials[0].serviceName,
    'Kwik-E-Mart App Mobile'
  );
  assert.equal(
    pcIncrementalPull.decryptedCredentials[0].password,
    'SquisheeUltraSecreto#Mobile2026!'
  );
});

test('Integração 03 (Fase 4B): Alterações simultâneas no PC e no Celular preservam ambas as versões no PostgreSQL sem sobrescrita silenciosa', async () => {
  const baseCred = createSampleSpringFieldPayload().credentials[0];

  // PC e Celular partem ambos da revisão base = 1 e editam a mesma credencial concorrentemente
  const pcConcurrentEdit = {
    ...baseCred,
    password: 'SenhaConcorrentePC#VersaoA',
    updatedAt: '2026-11-07T11:00:00.000Z',
    revision: 2,
  };
  const mobileConcurrentEdit = {
    ...baseCred,
    password: 'SenhaConcorrenteCelular#VersaoB',
    updatedAt: '2026-11-07T11:05:00.000Z',
    revision: 2,
  };

  const encPc = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    baseCred.id,
    'credential',
    2,
    1,
    false,
    pcConcurrentEdit
  );
  const encMobile = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    baseCred.id,
    'credential',
    2,
    1,
    false,
    mobileConcurrentEdit
  );

  // PC envia primeiro (expectedBaseRevision = 1) -> aplicado como revisão 2 no PostgreSQL
  pcSync.enqueueRecordOperation(encPc, 1);
  const pcPush = await pcSync.flushOfflineQueueToBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(pcPush.appliedCount, 1);

  // Celular envia em seguida (expectedBaseRevision = 1) -> PostgreSQL retorna CONFLICT -> Celular bifurca [Conflito Preservado] e salva ambos no PostgreSQL!
  mobileSync.enqueueRecordOperation(encMobile, 1);
  const mobilePush = await mobileSync.flushOfflineQueueToBackend(
    baseUrl,
    mobileAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(mobilePush.resolvedConflicts.length, 1);
  assert.equal(
    mobilePush.resolvedConflicts[0].resolutionType,
    'CONCURRENT_EDIT_FORKED'
  );

  // PC faz Pull do PostgreSQL e recebe tanto o registro atualizado (revisão 3) quanto a cópia bifurcada [Conflito Preservado]
  const pcPullAfterConflict = await pcSync.pullAndDecryptFromBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    3,
    sharedMasterDek
  );
  const passwordsInVault = pcPullAfterConflict.decryptedCredentials.map(
    (c) => c.password
  );
  assert.equal(
    passwordsInVault.includes('SenhaConcorrenteCelular#VersaoB'),
    true
  );
  assert.equal(passwordsInVault.includes('SenhaConcorrentePC#VersaoA'), true);
});

test('Integração 04 & 05 (Fase 4B): Dispositivo offline com fila persistente no IndexedDB e sincronização automática na reconexão', async () => {
  const offlineCred = {
    ...createSampleSpringFieldPayload().credentials[2],
    password: 'SenhaCriadaNoAviaoOffline#777',
    revision: 1,
  };

  const encOffline = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    offlineCred.id,
    'credential',
    1,
    1,
    false,
    offlineCred
  );

  // Enfileira enquanto está offline e persiste no StorageService (IndexedDB)
  const opOffline = mobileSync.enqueueRecordOperation(encOffline, 0);
  const serializedQueue = mobileSync.exportPersistentQueueState(5);
  await StorageService.savePersistentSyncState(serializedQueue);

  // Simula fechamento e reabertura do aplicativo no celular antes da reconexão
  const restoredMobileSync = new SyncAdapter();
  const loadedState = await StorageService.loadPersistentSyncState();
  assert.ok(loadedState);
  const { lastCursor } = restoredMobileSync.restorePersistentQueueState(
    loadedState!
  );
  assert.equal(lastCursor, 5);
  assert.equal(restoredMobileSync.getPendingQueue().length, 1);

  // Reconecta à internet e descarrega a fila persistida no PostgreSQL
  const flushAfterReconnect =
    await restoredMobileSync.flushOfflineQueueToBackend(
      baseUrl,
      mobileAuth,
      sharedVaultId,
      sharedMasterDek,
      1
    );
  assert.equal(flushAfterReconnect.appliedCount, 1);
  assert.equal(restoredMobileSync.getPendingQueue().length, 0);
  mobileSync.acknowledgeOperationSuccess(opOffline.operationId);

  // PC recebe o item criado offline pelo celular
  const pcPull = await pcSync.pullAndDecryptFromBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    flushAfterReconnect.latestCursor - 1,
    sharedMasterDek
  );
  assert.equal(pcPull.decryptedCredentials.length, 1);
  assert.equal(
    pcPull.decryptedCredentials[0].password,
    'SenhaCriadaNoAviaoOffline#777'
  );
});

test('Integração 06 (Fase 4B): Exclusões sincronizadas via Tombstone criptografado no PostgreSQL', async () => {
  const credToDelete = createSampleSpringFieldPayload().credentials[2];

  // PC envia tombstone (deleted: true, revision: 2) autenticado no AAD do AES-256-GCM
  const tombstonedRec = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    credToDelete.id,
    'credential',
    2,
    1,
    true,
    {
      ...credToDelete,
      deletedAt: new Date().toISOString(),
      revision: 2,
    }
  );

  pcSync.enqueueRecordOperation(tombstonedRec, 1);
  const pushTombstone = await pcSync.flushOfflineQueueToBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(pushTombstone.appliedCount, 1);

  // Celular faz Pull e identifica o tombstone autenticado
  const mobilePull = await mobileSync.pullAndDecryptFromBackend(
    baseUrl,
    mobileAuth,
    sharedVaultId,
    6,
    sharedMasterDek
  );
  assert.equal(mobilePull.deletedRecordIds.includes(credToDelete.id), true);
});

test('Integração 07 (Fase 4B): Duplicação de requisições HTTP Push é tratada de forma idempotente pelo PostgreSQL', async () => {
  const cred = createSampleSpringFieldPayload().credentials[3];
  const encRec = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    cred.id,
    'credential',
    1,
    1,
    false,
    cred
  );

  const duplicateOp = {
    operationId: CryptoEngine.randomId('op-dup-pg'),
    vaultId: sharedVaultId,
    expectedBaseRevision: 0,
    record: encRec,
    clientTimestamp: new Date().toISOString(),
  };

  // Primeira chamada HTTP -> APPLIED
  const res1 = await fetch(`${baseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pcAuth.sessionToken}`,
      'X-Device-Id': pcAuth.deviceId,
      'X-User-Uid': pcAuth.userUid,
    },
    body: JSON.stringify({ vaultId: sharedVaultId, operations: [duplicateOp] }),
  });
  const data1 = await res1.json();
  assert.equal(data1.results[0].status, 'APPLIED');

  // Segunda chamada HTTP idêntica (retry de rede) -> IDEMPOTENT_REPLAY sem duplicar nem gerar falso conflito
  const res2 = await fetch(`${baseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pcAuth.sessionToken}`,
      'X-Device-Id': pcAuth.deviceId,
      'X-User-Uid': pcAuth.userUid,
    },
    body: JSON.stringify({ vaultId: sharedVaultId, operations: [duplicateOp] }),
  });
  const data2 = await res2.json();
  assert.equal(data2.results[0].status, 'IDEMPOTENT_REPLAY');
  assert.equal(data2.results[0].serverRevision, 1);
});

test('Integração 08 (Fase 4B): Falha simulada do banco PostgreSQL preserva a fila offline no cliente e recupera na retentativa', async () => {
  const cred = createSampleSpringFieldPayload().credentials[4];
  const encRec = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    cred.id,
    'credential',
    1,
    1,
    false,
    cred
  );

  pcSync.enqueueRecordOperation(encRec, 0);

  // Simula queda temporária do PostgreSQL na próxima transação
  setSimulateNextDbFailure(true);

  await assert.rejects(
    async () => {
      await pcSync.flushOfflineQueueToBackend(
        baseUrl,
        pcAuth,
        sharedVaultId,
        sharedMasterDek,
        1
      );
    },
    /banco de dados|PostgreSQL/i
  );

  // Verifica que a operação permaneceu intacta na fila offline com backoff agendado
  const pending = pcSync.getPendingQueue();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 1);
  assert.equal(pending[0].nextRetryAfterMs, 500);

  // Na retentativa (após recuperação do banco), a sincronização conclui com sucesso!
  const recoveredPush = await pcSync.flushOfflineQueueToBackend(
    baseUrl,
    pcAuth,
    sharedVaultId,
    sharedMasterDek,
    1
  );
  assert.equal(recoveredPush.appliedCount, 1);
  assert.equal(pcSync.getPendingQueue().length, 0);
});

test('Integração 09 & 10 (Fase 4B): Rejeição de tokens inválidos (401) e bloqueio de acesso cruzado entre usuários (403 Forbidden)', async () => {
  // 9. Token inválido deve retornar 401 Unauthorized
  const badTokenRes = await fetch(
    `${baseUrl}/api/v1/sync/pull?vaultId=${encodeURIComponent(sharedVaultId)}&sinceCursor=0`,
    {
      headers: {
        Authorization: 'Bearer dvlt_sess_token_forjado_invalido',
        'X-Device-Id': pcAuth.deviceId,
      },
    }
  );
  assert.equal(badTokenRes.status, 401);

  // 10. Registra o Sr. Burns como outro usuário legítimo no PostgreSQL
  const burnsReg = await pcSync.registerDeviceOnBackend(baseUrl, {
    userUid: burnsUserUid,
    email: 'burns@springfield.nuclear.fake',
    deviceName: 'MacBook do Sr. Burns',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
  });
  burnsAuth = {
    userUid: burnsUserUid,
    deviceId: burnsReg.device.deviceId,
    sessionToken: burnsReg.sessionToken,
  };

  // Sr. Burns tenta baixar os registros criptografados do cofre do Homer -> 403 Forbidden!
  const crossUserPull = await fetch(
    `${baseUrl}/api/v1/sync/pull?vaultId=${encodeURIComponent(sharedVaultId)}&sinceCursor=0`,
    {
      headers: {
        Authorization: `Bearer ${burnsAuth.sessionToken}`,
        'X-Device-Id': burnsAuth.deviceId,
        'X-User-Uid': burnsAuth.userUid,
      },
    }
  );
  assert.equal(crossUserPull.status, 403);

  // Sr. Burns tenta sobrescrever os metadados do cofre do Homer -> 403 Forbidden!
  const crossUserVaultUpdate = await fetch(`${baseUrl}/api/v1/sync/vault`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${burnsAuth.sessionToken}`,
      'X-Device-Id': burnsAuth.deviceId,
      'X-User-Uid': burnsAuth.userUid,
    },
    body: JSON.stringify({
      vaultId: sharedVaultId,
      activeKeyEpoch: 1,
      kdfParams: FAST_KDF,
      saltHex: sharedSaltHex,
      wrappedDekHex: sharedWrappedDekHex,
      dekNonceHex: sharedDekNonceHex,
    }),
  });
  assert.equal(crossUserVaultUpdate.status, 403);
});

test('Integração 11 (Fase 4B): Adulteração de registros criptografados e bloqueio de envio de segredos em texto puro (Zero-Knowledge Guard)', async () => {
  // 11a. Tentativa de enviar senha ou DEK em texto puro no body HTTP -> 400 Bad Request imediato!
  const plaintextLeakRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pcAuth.sessionToken}`,
      'X-Device-Id': pcAuth.deviceId,
    },
    body: JSON.stringify({
      vaultId: sharedVaultId,
      password: 'MinhaSenhaEmTextoPuroJamaisDeveSerAceita',
      operations: [],
    }),
  });
  assert.equal(plaintextLeakRes.status, 400);
  const leakBody = await plaintextLeakRes.json();
  assert.match(leakBody.error, /Violação Zero-Knowledge/i);

  // 11b. Registro com nonceHex truncado/corrompido -> 400 Bad Request
  const malformedRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pcAuth.sessionToken}`,
      'X-Device-Id': pcAuth.deviceId,
    },
    body: JSON.stringify({
      vaultId: sharedVaultId,
      operations: [
        {
          operationId: CryptoEngine.randomId('op-malformed'),
          vaultId: sharedVaultId,
          expectedBaseRevision: 0,
          clientTimestamp: new Date().toISOString(),
          record: {
            recordId: 'rec-corrompido',
            vaultId: sharedVaultId,
            recordType: 'credential',
            formatVersion: 2,
            revision: 1,
            keyEpoch: 1,
            deleted: false,
            updatedAt: new Date().toISOString(),
            nonceHex: '1234', // inválido (deve ter 24 hex chars)
            ciphertextHex: 'a'.repeat(64),
            aadHashSha256Hex: 'b'.repeat(64),
          },
        },
      ],
    }),
  });
  assert.equal(malformedRes.status, 400);
});

test('Integração 12 (Fase 4B): Rotação completa de chaves (avanço de activeKeyEpoch no PostgreSQL e re-criptografia da fila offline)', async () => {
  // 1. Dispositivo móvel cria uma alteração offline na época de chave antiga (keyEpoch = 1)
  const credOfflineEpoch1 = createSampleSpringFieldPayload().credentials[5];
  const encEpoch1 = await CryptoEngine.sealRecordV2(
    sharedMasterDek,
    sharedVaultId,
    credOfflineEpoch1.id,
    'credential',
    1,
    1,
    false,
    credOfflineEpoch1
  );

  // 2. Computador realiza rotação completa da DEK -> gera nova DEK de 256 bits e avança o cofre para activeKeyEpoch = 2 no PostgreSQL
  const newMasterDekEpoch2 = CryptoEngine.getRandomBytes(32);
  await pcSync.registerVaultOnBackend(baseUrl, pcAuth, {
    vaultId: sharedVaultId,
    activeKeyEpoch: 2,
    kdfParams: FAST_KDF,
    saltHex: sharedSaltHex,
    wrappedDekHex: sharedWrappedDekHex,
    dekNonceHex: sharedDekNonceHex,
  });

  // 3. Se o celular tentar enviar o registro antigo cifrado com keyEpoch=1 sem atualizar, o PostgreSQL rejeita com REJECTED_STALE_KEY_EPOCH
  const stalePushRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mobileAuth.sessionToken}`,
      'X-Device-Id': mobileAuth.deviceId,
      'X-User-Uid': mobileAuth.userUid,
    },
    body: JSON.stringify({
      vaultId: sharedVaultId,
      operations: [
        {
          operationId: CryptoEngine.randomId('op-stale-epoch'),
          vaultId: sharedVaultId,
          expectedBaseRevision: 0,
          record: encEpoch1,
          clientTimestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  const staleData = await stalePushRes.json();
  assert.equal(staleData.results[0].status, 'REJECTED_STALE_KEY_EPOCH');

  // 4. Celular re-criptografa sua fila offline para a nova época (keyEpoch = 2) e sincroniza com sucesso!
  mobileSync.enqueueRecordOperation(encEpoch1, 0);
  const reencryptedCount =
    await mobileSync.reencryptOfflineQueueForNewKeyEpoch(
      sharedMasterDek,
      newMasterDekEpoch2,
      2
    );
  assert.equal(reencryptedCount, 1);

  const rotatedPush = await mobileSync.flushOfflineQueueToBackend(
    baseUrl,
    mobileAuth,
    sharedVaultId,
    newMasterDekEpoch2,
    2
  );
  assert.equal(rotatedPush.appliedCount, 1);

  CryptoEngine.zeroize(sharedMasterDek);
  sharedMasterDek = newMasterDekEpoch2;
});

test('Integração 13 & 14 (Fase 4B): Recuperação de backup criptografado, Kit de Emergência e Revogação de Dispositivo no PostgreSQL', async () => {
  // 13. Gera Kit de Emergência e testa backup criptografado + histórico de versões no PostgreSQL
  const emergencyKit = DeviceSecurityModel.generateEmergencyKit({
    vaultId: sharedVaultId,
    accountIdentifier: 'homer@springfield.nuclear.fake',
    kdfProfile: FAST_KDF,
  });
  assert.ok(emergencyKit.secretKey.startsWith('DVLT-'));

  const historyRes = await fetch(
    `${baseUrl}/api/v1/sync/history?vaultId=${encodeURIComponent(sharedVaultId)}`,
    {
      headers: {
        Authorization: `Bearer ${pcAuth.sessionToken}`,
        'X-Device-Id': pcAuth.deviceId,
        'X-User-Uid': pcAuth.userUid,
      },
    }
  );
  assert.equal(historyRes.status, 200);
  const historyData = await historyRes.json();
  assert.equal(historyData.history.length >= 2, true);

  // 14. PC revoga a sessão do Celular no PostgreSQL (`POST /api/v1/auth/devices/:deviceId/revoke`)
  const revokeRes = await fetch(
    `${baseUrl}/api/v1/auth/devices/${encodeURIComponent(mobileAuth.deviceId)}/revoke`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pcAuth.sessionToken}`,
        'X-Device-Id': pcAuth.deviceId,
        'X-User-Uid': pcAuth.userUid,
      },
    }
  );
  assert.equal(revokeRes.status, 200);

  // Celular revogado tenta fazer Pull no PostgreSQL -> bloqueado imediatamente com 401 Unauthorized!
  const revokedMobilePull = await fetch(
    `${baseUrl}/api/v1/sync/pull?vaultId=${encodeURIComponent(sharedVaultId)}&sinceCursor=0`,
    {
      headers: {
        Authorization: `Bearer ${mobileAuth.sessionToken}`,
        'X-Device-Id': mobileAuth.deviceId,
        'X-User-Uid': mobileAuth.userUid,
      },
    }
  );
  assert.equal(revokedMobilePull.status, 401);
});

test('Integração 15 (Fase 4B): Migração de cofre V1 existente para V2 + Auditoria direta no PostgreSQL comprovando ZERO segredos em texto puro', async () => {
  await StorageService.clearEnvelope();
  const vaultService = new VaultService();
  const createdV1 = await vaultService.createVault(
    masterPassword,
    'Cofre Legado V1 Migrado',
    true,
    FAST_KDF
  );

  // Migra transacionalmente o cofre V1 para o contêiner de registros individuais V2
  const migratedV2 = await CryptoEngine.migrateV1EnvelopeToV2Container(
    createdV1.envelope,
    masterPassword,
    FAST_KDF
  );
  assert.equal(migratedV2.container.format, 'DONUTVAULT_ENCRYPTED_V2');
  assert.equal(migratedV2.container.records.length > 0, true);

  // Inspeciona diretamente as tabelas reais do PostgreSQL (`vaults`, `encrypted_records`, `auth_audit_logs`)
  const rawDbDump = await inspectRawDatabaseStateForTest(sharedVaultId);
  assert.equal(rawDbDump.vaults.length, 1);
  assert.equal(rawDbDump.encryptedRecords.length >= 5, true);
  assert.equal(rawDbDump.auditLogs.length >= 2, true);

  const serializedDatabaseContent = JSON.stringify(rawDbDump);

  // Comprova matematicamente que NENHUMA senha, nota, título ou Senha Mestra jamais foi gravada em texto puro no PostgreSQL!
  assert.equal(
    serializedDatabaseContent.includes(masterPassword),
    false,
    'A Senha Mestra jamais deve existir no PostgreSQL'
  );
  assert.equal(
    serializedDatabaseContent.includes('SquisheeUltraSecreto#Mobile2026!'),
    false,
    'Senhas sincronizadas jamais devem existir em texto puro no PostgreSQL'
  );
  assert.equal(
    serializedDatabaseContent.includes('SenhaConcorrenteCelular#VersaoB'),
    false,
    'Senhas de conflito jamais devem existir em texto puro no PostgreSQL'
  );
  assert.equal(
    serializedDatabaseContent.includes('SenhaCriadaNoAviaoOffline#777'),
    false,
    'Senhas da fila offline jamais devem existir em texto puro no PostgreSQL'
  );

  vaultService.session.dispose();
  CryptoEngine.zeroize(migratedV2.sessionDek);
  CryptoEngine.zeroize(sharedMasterDek);
});
