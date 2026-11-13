import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createDonutVaultApp } from '../../server.ts';
import { resetRateLimitsForTests } from '../middleware/auth.ts';
import { cloudflareAccessVerifier } from '../services/CloudflareAccessVerifier.ts';
import { scannerDetector } from '../services/ScannerDetectionService.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import { SyncAdapter } from '../services/SyncAdapter.ts';
import { inspectRawDatabaseStateForTest } from '../db/repository.ts';

const TEST_KDF = { t: 1, m: 4096, p: 1, dkLen: 32 };

async function withZeroTrustServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  resetRateLimitsForTests();
  const app = await createDonutVaultApp({ skipVite: true });
  let server: Server | undefined;
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Falha ao alocar porta para servidor de testes Fase 5C.');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    cloudflareAccessVerifier.resetForTests();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

// ============================================================================
// 1. VALIDAÇÃO CRIPTOGRÁFICA REAL DO CLOUDFLARE ACCESS (JOSE RS256 + 10 CENÁRIOS ADVERSARIAIS) (§1, §2)
// ============================================================================
test('Fase 5C - 01 (§1, §2): Validação criptográfica RS256 do Cloudflare Access via jose (10 cenários adversariais: falso header, assinatura inválida/algoritmo, expirado, aud errado, iss errado, outro usuário, rotação de chaves JWKS, fail-closed sem config, sem token e revogação de sessão)', async () => {
  await withZeroTrustServer(async (baseUrl) => {
    const expectedIssuer = 'https://filipeti-zero-trust.cloudflareaccess.com';
    const expectedAud = 'aud_tag_donutvault_production_998877665544332211';
    const ownerEmail = 'fars290191@gmail.com';

    // Gera 3 pares de chaves RSA-2048 reais para os testes controlados:
    // - keyPairV1: chave inicial do JWKS da organização (kid-cf-v1)
    // - keyPairV2: nova chave após rotação do JWKS (kid-cf-v2)
    // - attackerKeyPair: chave RSA de um invasor tentando falsificar o token (kid-cf-v1 forjado)
    const keyPairV1 = await generateKeyPair('RS256');
    const keyPairV2 = await generateKeyPair('RS256');
    const attackerKeyPair = await generateKeyPair('RS256');

    const jwkV1: JWK = {
      ...(await exportJWK(keyPairV1.publicKey)),
      kid: 'kid-cf-v1',
      alg: 'RS256',
      use: 'sig',
    };
    const jwkV2: JWK = {
      ...(await exportJWK(keyPairV2.publicKey)),
      kid: 'kid-cf-v2',
      alg: 'RS256',
      use: 'sig',
    };

    // CENÁRIO 8: Ausência de configuração obrigatória (Fail-Closed: jamais desativar silenciosamente!)
    cloudflareAccessVerifier.setConfigOverrideForTests({
      enabled: true,
      issuer: '', // Configuração incompleta!
      audience: '',
      allowedEmails: [],
    });
    const missingConfigRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(
      missingConfigRes.status,
      503,
      'Cenário 8: Ausência de configuração obrigatória deve falhar fechado (503) e nunca permitir bypass silencioso'
    );
    const missingConfigBody = await missingConfigRes.json();
    assert.equal(missingConfigBody.code, 'CF_CONFIG_MISSING_FAIL_CLOSED');

    // Configura o Verificador Cloudflare Access com o JWKS controlado contendo apenas a chave V1
    cloudflareAccessVerifier.setConfigOverrideForTests({
      enabled: true,
      issuer: expectedIssuer,
      audience: expectedAud,
      allowedEmails: [ownerEmail],
      localJwks: { keys: [jwkV1] },
      clockToleranceSeconds: 2,
    });

    // CENÁRIO 9: Requisição sem cabeçalho CF-Access-Jwt-Assertion -> 403
    const noTokenRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(noTokenRes.status, 403);
    const noTokenBody = await noTokenRes.json();
    assert.equal(noTokenBody.code, 'CF_TOKEN_MISSING');

    // CENÁRIO 1: Cabeçalho presente com valor falso (ex.: string de 3 partes que passava na Fase 5B!)
    const fakeThreePartJwt =
      'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZC1jZi12MSJ9.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6ImZhcnMyOTAxOTFAZ21haWwuY29tIn0.fake_signature_bytes';
    const fakeHeaderRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': fakeThreePartJwt },
    });
    assert.equal(
      fakeHeaderRes.status,
      403,
      'Cenário 1: Cabeçalho presente com valor falso de 3 partes deve ser rejeitado criptograficamente (403)'
    );
    const fakeHeaderBody = await fakeHeaderRes.json();
    assert.equal(fakeHeaderBody.code, 'CF_SIGNATURE_OR_KEY_INVALID');

    // CENÁRIO 2A: JWT com algoritmo não permitido (alg: "none" ou "HS256") -> 403 CF_ALG_NOT_ALLOWED
    const algNoneHeader = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' })
    ).toString('base64url');
    const algNonePayload = Buffer.from(
      JSON.stringify({
        sub: 'owner-sub',
        email: ownerEmail,
        iss: expectedIssuer,
        aud: expectedAud,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const algNoneRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: {
        'CF-Access-Jwt-Assertion': `${algNoneHeader}.${algNonePayload}.`,
      },
    });
    assert.equal(algNoneRes.status, 403);
    assert.equal((await algNoneRes.json()).code, 'CF_ALG_NOT_ALLOWED');

    // CENÁRIO 2B: JWT assinado por chave RSA falsa de invasor (mesmo falsificando kid="kid-cf-v1") -> 403
    const forgedSigJwt = await new SignJWT({
      sub: 'owner-sub-1',
      email: ownerEmail,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(attackerKeyPair.privateKey);

    const forgedSigRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': forgedSigJwt },
    });
    assert.equal(
      forgedSigRes.status,
      403,
      'Cenário 2B: JWT assinado com chave privada RSA de invasor deve falhar na verificação JWKS (403)'
    );
    assert.equal((await forgedSigRes.json()).code, 'CF_SIGNATURE_OR_KEY_INVALID');

    // CENÁRIO 3: JWT Expirado (`exp` no passado) -> 403 CF_TOKEN_EXPIRED
    const expiredJwt = await new SignJWT({
      sub: 'owner-sub-1',
      email: ownerEmail,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keyPairV1.privateKey);

    const expiredRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': expiredJwt },
    });
    assert.equal(expiredRes.status, 403);
    assert.equal(
      (await expiredRes.json()).code,
      'CF_TOKEN_EXPIRED',
      'Cenário 3: JWT expirado deve ser rejeitado com CF_TOKEN_EXPIRED'
    );

    // CENÁRIO 4: JWT com Audiência (`aud`) incorreta (token emitido para outra aplicação do mesmo tenant) -> 403
    const wrongAudJwt = await new SignJWT({
      sub: 'owner-sub-1',
      email: ownerEmail,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer(expectedIssuer)
      .setAudience('aud_other_internal_application_0000')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keyPairV1.privateKey);

    const wrongAudRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': wrongAudJwt },
    });
    assert.equal(wrongAudRes.status, 403);
    assert.equal(
      (await wrongAudRes.json()).code,
      'CF_AUDIENCE_MISMATCH',
      'Cenário 4: JWT com audiência incorreta deve ser rejeitado com CF_AUDIENCE_MISMATCH'
    );

    // CENÁRIO 5: JWT com Emissor (`iss`) incorreto -> 403
    const wrongIssJwt = await new SignJWT({
      sub: 'owner-sub-1',
      email: ownerEmail,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer('https://other-tenant.cloudflareaccess.com')
      .setAudience(expectedAud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keyPairV1.privateKey);

    const wrongIssRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': wrongIssJwt },
    });
    assert.equal(wrongIssRes.status, 403);
    assert.equal(
      (await wrongIssRes.json()).code,
      'CF_ISSUER_MISMATCH',
      'Cenário 5: JWT com emissor incorreto deve ser rejeitado com CF_ISSUER_MISMATCH'
    );

    // CENÁRIO 6: Token criptograficamente válido, porém pertencente a OUTRO usuário (`intruso@filipeti.com.br`) -> 403
    const otherUserJwt = await new SignJWT({
      sub: 'intruder-sub-999',
      email: 'intruso@filipeti.com.br',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keyPairV1.privateKey);

    const otherUserRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': otherUserJwt },
    });
    assert.equal(otherUserRes.status, 403);
    assert.equal(
      (await otherUserRes.json()).code,
      'CF_USER_NOT_AUTHORIZED',
      'Cenário 6: Token válido de outro usuário fora da allowlist do proprietário deve ser rejeitado com CF_USER_NOT_AUTHORIZED'
    );

    // Token legítimo do proprietário assinado com a chave ativa V1 -> 200 OK!
    const validV1Jwt = await new SignJWT({
      sub: 'owner-sub-fars',
      email: ownerEmail,
      jti: 'jti-valid-v1-session-1',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v1' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keyPairV1.privateKey);

    const validV1Res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': validV1Jwt },
    });
    assert.equal(
      validV1Res.status,
      200,
      'Token legítimo RS256 do proprietário com kid-cf-v1 ativo deve ser aceito (200)'
    );

    // CENÁRIO 7: Rotação das chaves públicas no JWKS (`kid-cf-v1` aposentada -> `kid-cf-v2` ativa)
    cloudflareAccessVerifier.updateLocalJwksForKeyRotationTest({
      keys: [jwkV2],
    });

    // O token antigo assinado com `kid-cf-v1` agora é imediatamente rejeitado após a retirada da chave V1 do JWKS!
    const retiredKeyRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': validV1Jwt },
    });
    assert.equal(
      retiredKeyRes.status,
      403,
      'Cenário 7A: Após rotação e remoção da chave antiga do JWKS, tokens assinados com a chave antiga devem ser rejeitados (403)'
    );

    // Novo token assinado com a nova chave rotacionada `kid-cf-v2` é aceito com sucesso!
    const validV2Jwt = await new SignJWT({
      sub: 'owner-sub-fars',
      email: ownerEmail,
      jti: 'jti-rotated-v2-session-99',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v2' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keyPairV2.privateKey);

    const validV2Res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': validV2Jwt },
    });
    assert.equal(
      validV2Res.status,
      200,
      'Cenário 7B: Token assinado com a nova chave rotacionada kid-cf-v2 no JWKS deve ser aceito (200)'
    );

    // CENÁRIO 10: Revogação de sessão / token Cloudflare Access (`jti` e `sub`)
    cloudflareAccessVerifier.revokeTokenJti('jti-rotated-v2-session-99');
    const revokedJtiRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': validV2Jwt },
    });
    assert.equal(
      revokedJtiRes.status,
      401,
      'Cenário 10A: Token Cloudflare Access cujo jti foi revogado deve ser bloqueado com 401'
    );
    assert.equal((await revokedJtiRes.json()).code, 'CF_SESSION_REVOKED');

    // Testa revogação global de sessões anteriores do usuário (`revokeSubjectSessionsIssuedBefore`)
    const issuedInPastJwt = await new SignJWT({
      sub: 'owner-sub-fars',
      email: ownerEmail,
      jti: 'jti-session-before-global-revoke',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-cf-v2' })
      .setIssuer(expectedIssuer)
      .setAudience(expectedAud)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime('10m')
      .sign(keyPairV2.privateKey);

    cloudflareAccessVerifier.revokeSubjectSessionsIssuedBefore(
      ownerEmail,
      Math.floor(Date.now() / 1000)
    );
    const revokedSubRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'CF-Access-Jwt-Assertion': issuedInPastJwt },
    });
    assert.equal(
      revokedSubRes.status,
      401,
      'Cenário 10B: Sessão emitida antes do timestamp de revogação do usuário deve ser rejeitada com 401'
    );
  });
});

// ============================================================================
// 2. SEGURANÇA DA TELEMETRIA: PSEUDONIMIZAÇÃO HMAC-SHA256 COM CHAVE SECRETA
//    ROTATIVA, EXPURGO DE RETENÇÃO E PROIBIÇÃO DE SHA-256 SIMPLES DE IPV4 (§3)
// ============================================================================
test('Fase 5C - 02 (§3): Pseudonimização de IP via HMAC-SHA256 com chave secreta de 256 bits, rotação de chave com zeroização, retenção temporal e ausência de SHA-256 simples de IPv4', async () => {
  await withZeroTrustServer(async (baseUrl) => {
    const sampleIp = '203.0.113.195';

    // 1. Verifica que o pseudônimo gerado NÃO é um hash SHA-256 simples (que seria reversível no espaço 2^32 IPv4)
    const rawSha256Hex = createHash('sha256').update(sampleIp).digest('hex');
    const staticSaltedSha256 = createHash('sha256')
      .update(`DONUTVAULT_TELEMETRY_V1:${sampleIp}`)
      .digest('hex');

    const hmacEpoch1 = scannerDetector.pseudonymizeIdentifierHmac(sampleIp, 'ip');
    assert.match(
      hmacEpoch1,
      /^ke\d+_[0-9a-f]{24}$/,
      'O pseudônimo deve identificar a época da chave HMAC (ke<N>_<hmac>)'
    );
    assert.equal(
      hmacEpoch1.includes(rawSha256Hex.slice(0, 16)),
      false,
      'Jamais deve usar SHA-256 simples de IPv4'
    );
    assert.equal(
      hmacEpoch1.includes(staticSaltedSha256.slice(0, 16)),
      false,
      'Jamais deve usar prefixo estático sem chave secreta CSPRNG'
    );

    // 2. Rotação da chave secreta HMAC-SHA256 (Zeroiza a chave anterior e invalida correlação com épocas passadas)
    const rotation = scannerDetector.rotateTelemetryHmacKey();
    assert.equal(rotation.newEpoch, rotation.previousEpoch + 1);

    const hmacEpoch2 = scannerDetector.pseudonymizeIdentifierHmac(sampleIp, 'ip');
    assert.notEqual(
      hmacEpoch1,
      hmacEpoch2,
      'Após rotação da chave secreta HMAC-SHA256, o mesmo IP deve produzir um pseudônimo completamente distinto e incorrelacionável'
    );

    // 3. Política de retenção temporal (expurgo automático de alertas expirados)
    scannerDetector.recordAlert({
      category: 'ADMIN_OR_SENSITIVE_PATH_PROBE',
      severity: 'HIGH',
      clientIp: sampleIp,
      method: 'GET',
      path: '/.env?secret=should_be_stripped',
      statusCode: 404,
      reason: 'Teste de retenção e minimização de dados.',
    });

    const snapBeforePrune = scannerDetector.getTelemetrySnapshot();
    assert.equal(snapBeforePrune.pseudonymizationPolicy.algorithm, 'HMAC-SHA256');
    assert.equal(snapBeforePrune.pseudonymizationPolicy.plainSha256IpUsed, false);
    assert.equal(snapBeforePrune.recentAlerts.length, 1);
    assert.equal(
      snapBeforePrune.recentAlerts[0].pathTemplate,
      '/.env',
      'Query strings devem ser removidas por minimização de dados na telemetria'
    );

    // Expira a janela de retenção no futuro e verifica expurgo
    const prunedCount = scannerDetector.pruneExpiredTelemetry(
      Date.now() + 20 * 60 * 1000
    );
    assert.equal(
      prunedCount,
      1,
      'Eventos fora da janela de retenção devem ser expurgados automaticamente da memória'
    );
    assert.equal(scannerDetector.getTelemetrySnapshot().recentAlerts.length, 0);

    // 4. Verifica no PostgreSQL (`auth_audit_logs`) que o campo `ip_hash_sha256` usa o pseudônimo HMAC-SHA256 (`ke<N>_...`)
    await fetch(`${baseUrl}/.env`, {
      headers: { 'X-Forwarded-For': sampleIp },
    });
    const dbDump = await inspectRawDatabaseStateForTest('none');
    const latestAudit = dbDump.auditLogs[dbDump.auditLogs.length - 1];
    assert.ok(latestAudit);
    assert.match(
      latestAudit.ipHashSha256,
      /^ke\d+_[0-9a-f]{24}$/,
      'Logs de auditoria no PostgreSQL devem gravar apenas o pseudônimo HMAC-SHA256 com época de chave'
    );
  });
});

// ============================================================================
// 3. DETECÇÃO COMPORTAMENTAL DE SCANNERS (INDEPENDENTE DE USER-AGENT) E
//    GARANTIA CONTRA FALSOS POSITIVOS PARA O PROPRIETÁRIO LEGÍTIMO (§4)
// ============================================================================
test('Fase 5C - 03 (§4): Detecção comportamental de scanners camuflados com User-Agent Chrome legítimo (varredura horizontal de contas, métodos anômalos e 404 burst) sem bloquear o proprietário autenticado', async () => {
  await withZeroTrustServer(async (baseUrl) => {
    const normalChromeUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const stealthScannerIp = '198.51.100.250';
    const ownerIp = '192.0.2.200';

    // 1. Proprietário legítimo autentica seu dispositivo
    const sync = new SyncAdapter();
    const ownerUid = CryptoEngine.randomId('usr-owner-5c');
    const vaultId = CryptoEngine.randomId('vault-owner-5c');
    const ownerReg = await sync.registerDeviceOnBackend(baseUrl, {
      userUid: ownerUid,
      email: 'fars290191@gmail.com',
      deviceName: 'MacBook Proprietário Legítimo',
      platform: 'desktop-web',
      authMethod: 'webauthn-passkey',
    });
    const ownerAuth = {
      userUid: ownerUid,
      deviceId: ownerReg.device.deviceId,
      sessionToken: ownerReg.sessionToken,
    };
    await sync.registerVaultOnBackend(baseUrl, ownerAuth, {
      vaultId,
      activeKeyEpoch: 1,
      kdfParams: TEST_KDF,
      saltHex: 'aa'.repeat(16),
      wrappedDekHex: 'bb'.repeat(32),
      dekNonceHex: 'cc'.repeat(12),
    });

    // 2. Scanner camuflado com User-Agent Chrome envia método HTTP anômalo (TRACE / DELETE não autenticado) -> 405
    const traceRes = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'DELETE',
      headers: {
        'User-Agent': normalChromeUa,
        'X-Forwarded-For': stealthScannerIp,
      },
    });
    assert.equal(
      traceRes.status,
      405,
      'Sondagem de método HTTP não permitido com User-Agent comum deve ser bloqueada com 405'
    );

    // 3. Scanner camuflado com User-Agent Chrome faz varredura horizontal de 6 contas distintas (Account Sweeping)
    let sweepBlockedWith429 = false;
    for (let i = 1; i <= 7; i++) {
      const sweepRes = await fetch(
        `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': normalChromeUa,
            'X-Forwarded-For': stealthScannerIp,
          },
          body: JSON.stringify({ userUid: `target-account-sweep-${i}` }),
        }
      );
      if (sweepRes.status === 429) {
        sweepBlockedWith429 = true;
        break;
      }
    }
    assert.equal(
      sweepBlockedWith429,
      true,
      'Scanner camuflado com User-Agent Chrome sondando múltiplas contas distintas deve ser contido comportamentalmente com 429'
    );

    const snap = scannerDetector.getTelemetrySnapshot();
    assert.ok(
      snap.behavioralScannerDetections >= 2,
      'O contador de detecções comportamentais independentes de User-Agent deve registrar os bloqueios'
    );

    // 4. Garantia contra Falsos Positivos: O proprietário legítimo autenticado continua sincronizando sem nenhum bloqueio!
    for (let i = 0; i < 10; i++) {
      const ownerPullRes = await fetch(
        `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
        {
          headers: {
            'User-Agent': normalChromeUa,
            Authorization: `Bearer ${ownerAuth.sessionToken}`,
            'X-Device-Id': ownerAuth.deviceId,
            'X-User-Uid': ownerAuth.userUid,
            'X-Forwarded-For': ownerIp,
          },
        }
      );
      assert.equal(
        ownerPullRes.status,
        200,
        'Proprietário legítimo autenticado jamais deve sofrer falso positivo das regras anti-scanner'
      );
    }
  });
});
