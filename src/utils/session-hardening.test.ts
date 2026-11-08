import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { createDonutVaultApp } from '../../server.ts';
import { resetRateLimitsForTests } from '../middleware/auth.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import {
  MAX_ACTIVE_DEVICES_PER_ACCOUNT,
  consumeSingleUseChallengeInDb,
  createSingleUseChallengeInDb,
  recordAuthAuditEvent,
  saveWebAuthnCredentialInDb,
  verifyAndAdvanceWebAuthnCounterInDb,
} from '../db/repository.ts';
import { db } from '../db/index.ts';
import { authAuditLogs } from '../db/schema.ts';

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  resetRateLimitsForTests();
  const app = await createDonutVaultApp({ skipVite: true });
  let server: Server | undefined;
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Falha ao iniciar servidor de teste.');
  }
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

async function registerDevice(
  baseUrl: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const res = await fetch(`${baseUrl}/api/v1/auth/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { res, data };
}

function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function deviceBody(userUid: string, deviceName = 'Navegador de teste') {
  return { userUid, deviceName, platform: 'desktop-web', authMethod: 'session-token' };
}

const FAKE_TOKEN = `dvlt_sess_${'ab'.repeat(24)}`;
const FAKE_COOKIE = `dvlt_sid=${FAKE_TOKEN}; dvlt_did=dev-00000000-fake`;

test('Cadastro repetido no mesmo navegador renova a sessão em vez de criar outro aparelho', async () => {
  await withServer(async (baseUrl) => {
    const userUid = CryptoEngine.randomId('usr-renew');
    const first = await registerDevice(baseUrl, deviceBody(userUid));
    assert.equal(first.res.status, 201);
    const cookie = cookieHeaderFrom(first.res);
    assert.match(cookie, /dvlt_sid=/);

    const second = await registerDevice(baseUrl, deviceBody(userUid), { Cookie: cookie });
    assert.equal(second.res.status, 200);
    assert.equal(second.data.device.deviceId, first.data.device.deviceId);
    assert.notEqual(second.data.sessionToken, first.data.sessionToken);

    const deviceId = first.data.device.deviceId;
    const authHeaders = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'X-Device-Id': deviceId,
    });

    const oldTokenRes = await fetch(`${baseUrl}/api/v1/auth/devices`, {
      headers: authHeaders(first.data.sessionToken),
    });
    assert.equal(oldTokenRes.status, 401, 'o token anterior deixa de valer');

    const listRes = await fetch(`${baseUrl}/api/v1/auth/devices`, {
      headers: authHeaders(second.data.sessionToken),
    });
    assert.equal(listRes.status, 200);
    const { devices } = (await listRes.json()) as {
      devices: { deviceId: string; revokedAt: string | null }[];
    };
    assert.equal(devices.filter((d) => !d.revokedAt).length, 1);

    // Pareamento explícito (sessão de outro aparelho nos cabeçalhos) segue criando aparelho novo
    // e não derruba a sessão de quem pareou.
    const paired = await registerDevice(
      baseUrl,
      deviceBody(userUid, 'Celular'),
      authHeaders(second.data.sessionToken)
    );
    assert.equal(paired.res.status, 201);
    assert.notEqual(paired.data.device.deviceId, deviceId);
    const ownerStillValid = await fetch(`${baseUrl}/api/v1/auth/devices`, {
      headers: authHeaders(second.data.sessionToken),
    });
    assert.equal(ownerStillValid.status, 200);
  });
});

test('Uma conta não acumula mais sessões ativas que o teto', async () => {
  await withServer(async (baseUrl) => {
    const userUid = CryptoEngine.randomId('usr-cap');
    const owner = await registerDevice(baseUrl, deviceBody(userUid, 'Dono'));
    assert.equal(owner.res.status, 201);
    const ownerHeaders = {
      Authorization: `Bearer ${owner.data.sessionToken}`,
      'X-Device-Id': owner.data.device.deviceId,
    };

    let newestPairedId = '';
    for (let i = 0; i < MAX_ACTIVE_DEVICES_PER_ACCOUNT + 2; i++) {
      const paired = await registerDevice(
        baseUrl,
        deviceBody(userUid, `Aparelho ${i}`),
        ownerHeaders
      );
      assert.equal(paired.res.status, 201);
      newestPairedId = paired.data.device.deviceId;
    }

    const listRes = await fetch(`${baseUrl}/api/v1/auth/devices`, {
      headers: ownerHeaders,
    });
    assert.equal(listRes.status, 200, 'o aparelho em uso não é revogado');
    const { devices } = (await listRes.json()) as {
      devices: { deviceId: string; revokedAt: string | null }[];
    };
    const active = devices.filter((d) => !d.revokedAt);
    assert.equal(active.length, MAX_ACTIVE_DEVICES_PER_ACCOUNT);
    assert.ok(active.some((d) => d.deviceId === owner.data.device.deviceId));
    assert.ok(active.some((d) => d.deviceId === newestPairedId));
  });
});

test('Cookie ou Bearer de sessão falsos não livram uma origem penalizada', async () => {
  await withServer(async (baseUrl) => {
    const penalizedIp = '198.51.100.231';
    const scan = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'User-Agent': 'sqlmap/1.8.2#stable', 'X-Forwarded-For': penalizedIp },
    });
    assert.equal(scan.status, 403);

    const withFakeCookie = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-Forwarded-For': penalizedIp, Cookie: FAKE_COOKIE },
    });
    assert.equal(withFakeCookie.status, 429);

    const withFakeBearer = await fetch(`${baseUrl}/api/v1/health`, {
      headers: {
        'X-Forwarded-For': penalizedIp,
        Authorization: `Bearer ${FAKE_TOKEN}`,
        'X-Device-Id': 'dev-00000000-fake',
      },
    });
    assert.equal(withFakeBearer.status, 429);

    // Sessão real continua isenta, mesmo saindo da origem penalizada (ex.: mesma rede de um scanner).
    const reg = await registerDevice(
      baseUrl,
      deviceBody(CryptoEngine.randomId('usr-penalty')),
      { 'X-Forwarded-For': '198.51.100.232' }
    );
    assert.equal(reg.res.status, 201);
    const withRealCookie = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-Forwarded-For': penalizedIp, Cookie: cookieHeaderFrom(reg.res) },
    });
    assert.equal(withRealCookie.status, 200);
  });
});

test('Cookie de sessão falso não esconde varredura de contas', async () => {
  await withServer(async (baseUrl) => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/passkey/challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.241',
          Cookie: FAKE_COOKIE,
        },
        body: JSON.stringify({ userUid: `usr-sweep-target-${i}` }),
      });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.includes(429),
      `varredura com cookie falso deve ser contida (status: ${statuses.join(',')})`
    );
  });
});

test('Eventos anônimos repetidos da mesma origem gravam uma linha só', async () => {
  resetRateLimitsForTests();
  const eventType = `TEST_ANON_SAMPLING_${CryptoEngine.randomId('evt')}`;
  for (let i = 0; i < 5; i++) {
    await recordAuthAuditEvent({
      userUid: 'anonymous',
      deviceId: 'test-probe',
      eventType,
      clientIp: '198.51.100.250',
    });
  }
  await recordAuthAuditEvent({
    userUid: 'anonymous',
    deviceId: 'test-probe',
    eventType,
    clientIp: '198.51.100.251',
  });
  const rows = await db
    .select()
    .from(authAuditLogs)
    .where(eq(authAuditLogs.eventType, eventType));
  assert.equal(rows.length, 2, 'uma linha por origem na janela');

  // Eventos de conta identificada não são amostrados.
  const userEventType = `${eventType}_USER`;
  for (let i = 0; i < 3; i++) {
    await recordAuthAuditEvent({
      userUid: 'usr-sampling-check',
      deviceId: 'dev-sampling-check',
      eventType: userEventType,
      clientIp: '198.51.100.250',
    });
  }
  const userRows = await db
    .select()
    .from(authAuditLogs)
    .where(eq(authAuditLogs.eventType, userEventType));
  assert.equal(userRows.length, 3);
});

test('Desafio de uso único: dois consumos simultâneos, só um vale', async () => {
  const userUid = CryptoEngine.randomId('usr-chal');
  const challenge = CryptoEngine.randomId('chal-text');
  const saved = await createSingleUseChallengeInDb({
    userUid,
    challenge,
    purpose: 'authentication',
    rpId: 'localhost',
    expectedOrigin: 'http://localhost:3000',
  });
  const consume = () =>
    consumeSingleUseChallengeInDb({
      challengeId: saved.challengeId,
      userUid,
      purpose: 'authentication',
      expectedChallenge: challenge,
    });
  const results = await Promise.allSettled([consume(), consume(), consume()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('Contador de passkey: duas assinaturas simultâneas com o mesmo contador, só uma vale', async () => {
  const userUid = CryptoEngine.randomId('usr-counter');
  const credentialId = CryptoEngine.randomId('cred-counter');
  await saveWebAuthnCredentialInDb({
    credentialId,
    userUid,
    email: `${userUid}@donutvault.local`,
    publicKeyBytes: new Uint8Array(65),
    counter: 5,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  const advance = () =>
    verifyAndAdvanceWebAuthnCounterInDb({
      credentialId,
      expectedUserUid: userUid,
      newCounter: 6,
    });
  const results = await Promise.allSettled([advance(), advance(), advance()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
