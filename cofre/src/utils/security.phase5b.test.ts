import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createDonutVaultApp } from '../../server.ts';
import { resetRateLimitsForTests } from '../middleware/auth.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import { SyncAdapter } from '../services/SyncAdapter.ts';
import { scannerDetector } from '../services/ScannerDetectionService.ts';
import { inspectRawDatabaseStateForTest } from '../db/repository.ts';

const TEST_KDF = { t: 1, m: 4096, p: 1, dkLen: 32 };

async function withHardenedServer(
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
    throw new Error('Falha ao iniciar servidor para testes da Fase 5B.');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

// ============================================================================
// 1. ANTI-RECONHECIMENTO, ANTI-FINGERPRINTING, ENDPOINTS ADMIN E SCANNERS (§1, §4, §5, §7)
// ============================================================================
test('Fase 5B - 01 (§1, §4, §5): Anti-Fingerprinting (sem X-Powered-By), bloqueio de Scanners Ativos (Nuclei/HTTPx/Gobuster/FFUF/Nmap) e armadilha para endpoints administrativos/.env/.git', async () => {
  await withHardenedServer(async (baseUrl) => {
    // 1A. Verifica cabeçalhos de segurança e ausência de X-Powered-By
    const healthRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-Forwarded-For': '198.51.100.10' },
    });
    assert.equal(healthRes.status, 200);
    assert.equal(
      healthRes.headers.get('x-powered-by'),
      null,
      'O cabeçalho X-Powered-By deve ser removido para evitar fingerprinting da stack'
    );
    assert.match(
      healthRes.headers.get('strict-transport-security') || '',
      /max-age=63072000/
    );
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.match(
      healthRes.headers.get('content-security-policy') || '',
      /default-src 'none'/
    );

    // 1B. Cada assinatura recebe uma origem nova para testar o 403 sem a penalidade de uma sondagem anterior.
    const scannerAgents = [
      'Mozilla/5.0 (compatible; Nuclei - Open-source project github.com/projectdiscovery/nuclei)',
      'gobuster/3.6',
      'Fuzz Faster U Fool v2.1.0-dev (ffuf)',
      'Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)',
      'sqlmap/1.8.2#stable (https://sqlmap.org)',
    ];

    for (const [index, ua] of scannerAgents.entries()) {
      const scanRes = await fetch(`${baseUrl}/api/v1/health`, {
        headers: {
          'User-Agent': ua,
          'X-Forwarded-For': `203.0.113.${100 + index}`,
        },
      });
      assert.equal(
        scanRes.status,
        403,
        `Scanner User-Agent "${ua}" deve ser bloqueado com 403 Forbidden`
      );
    }

    const penalizedRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Forwarded-For': '203.0.113.100',
      },
    });
    assert.equal(
      penalizedRes.status,
      429,
      'Uma origem já identificada como scanner deve continuar limitada mesmo trocando o User-Agent'
    );

    // 1C. Sondagem de arquivos sensíveis e rotas de administração/debug (/.env, /.git, /wp-admin, /api/v1/admin, /api/v1/debug)
    const sensitiveProbes = [
      '/.env',
      '/.git/config',
      '/wp-admin/install.php',
      '/phpmyadmin/index.php',
      '/api/v1/admin/users',
      '/api/v1/debug/vars',
      '/api/v1/demo/reset',
    ];

    const statuses: number[] = [];
    for (const probePath of sensitiveProbes) {
      const probeRes = await fetch(`${baseUrl}${probePath}`, {
        headers: { 'X-Forwarded-For': '203.0.113.77' },
      });
      statuses.push(probeRes.status);
    }

    // As primeiras sondagens retornam 404 uniforme e a partir da 5ª tentativa a origem sofre throttling 429!
    assert.equal(statuses[0], 404);
    assert.equal(statuses[1], 404);
    assert.equal(
      statuses.includes(429),
      true,
      'Sondagens repetidas a rotas administrativas/sensíveis devem acionar throttling 429'
    );

    // 1D. Enumeração de diretórios/rotas inexistentes na API (Gobuster/FFUF 404 burst)
    let hit429On404Burst = false;
    for (let i = 1; i <= 8; i++) {
      const enumRes = await fetch(
        `${baseUrl}/api/v1/rota-inexistente-fuzz-${i}`,
        {
          headers: { 'X-Forwarded-For': '203.0.113.88' },
        }
      );
      if (enumRes.status === 429) {
        hit429On404Burst = true;
      }
    }
    assert.equal(
      hit429On404Burst,
      true,
      'Acessos repetidos a rotas inexistentes (Gobuster/FFUF) devem ser detectados e limitados com 429'
    );
  });
});

// ============================================================================
// 2. PROTEÇÃO CONTRA FORÇA BRUTA, BACKOFF PROGRESSIVO, ATAQUE DISTRIBUÍDO E
//    NÃO-BLOQUEIO PERMANENTE DE USUÁRIO LEGÍTIMO + ANTI-ENUMERAÇÃO (§3, §7)
// ============================================================================
test('Fase 5B - 02 (§3, §7): Força bruta, Backoff progressivo por (Conta+IP), Detecção de Ataque Distribuído, Preservação de Usuário Legítimo e Anti-Enumeração de Contas', async () => {
  await withHardenedServer(async (baseUrl) => {
    const sync = new SyncAdapter();
    const legitimateUserUid = CryptoEngine.randomId('usr-legit-5b');
    const vaultId = CryptoEngine.randomId('vault-legit-5b');
    const legitimateIp = '192.0.2.10';
    const singleAttackerIp = '203.0.113.50';

    // 1. Usuário legítimo registra seu dispositivo e cofre a partir de seu IP legítimo
    const regRes = await fetch(`${baseUrl}/api/v1/auth/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': legitimateIp,
      },
      body: JSON.stringify({
        userUid: legitimateUserUid,
        email: `${legitimateUserUid}@donutvault.local`,
        deviceName: 'PC Legítimo do Usuário',
        platform: 'desktop-web',
        authMethod: 'webauthn-passkey',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    const legitAuth = {
      userUid: legitimateUserUid,
      deviceId: regData.device.deviceId,
      sessionToken: regData.sessionToken,
    };

    await sync.registerVaultOnBackend(
      baseUrl,
      legitAuth,
      {
        vaultId,
        activeKeyEpoch: 1,
        kdfParams: TEST_KDF,
        saltHex: '11'.repeat(16),
        wrappedDekHex: '22'.repeat(32),
        dekNonceHex: '33'.repeat(12),
      }
    );

    // 2. ANTI-ENUMERAÇÃO DE CONTAS (§3):
    // Consultar `/auth/webauthn/authenticate/options` para conta existente vs conta inexistente
    // deve retornar o MESMO status 200 OK e a MESMA estrutura JSON (sem revelar se a conta existe!).
    const existingOptRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': legitimateIp,
        },
        body: JSON.stringify({ userUid: legitimateUserUid }),
      }
    );
    const nonExistentOptRes = await fetch(
      `${baseUrl}/api/v1/auth/webauthn/authenticate/options`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': legitimateIp,
        },
        body: JSON.stringify({ userUid: 'usuario-fantasma-nao-existe-999' }),
      }
    );
    assert.equal(existingOptRes.status, 200);
    assert.equal(
      nonExistentOptRes.status,
      200,
      'Não deve retornar 404 para conta sem Passkey a fim de impedir enumeração de contas'
    );
    const existingOptBody = await existingOptRes.json();
    const nonExistentOptBody = await nonExistentOptRes.json();
    assert.deepEqual(
      Object.keys(existingOptBody).sort(),
      Object.keys(nonExistentOptBody).sort(),
      'A estrutura da resposta de opções de autenticação deve ser indistinguível'
    );

    // 3. Anti-Enumeração de Cofres no endpoint de Recuperação (`/sync/vault/recovery/bundle`):
    // Tanto um cofre inexistente quanto um cofre existente com compromisso incorreto retornam 401 uniforme!
    const fakeVaultProbeRes = await fetch(
      `${baseUrl}/api/v1/sync/vault/recovery/bundle`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.200',
        },
        body: JSON.stringify({
          vaultId: 'cofre-inexistente-enum-test',
          recoveryAuthToken: 'a'.repeat(64),
        }),
      }
    );
    assert.equal(
      fakeVaultProbeRes.status,
      401,
      'Cofre inexistente no recovery bundle deve retornar 401 uniforme em vez de 404 (Anti-Enumeração)'
    );

    // 4. FORÇA BRUTA DE ORIGEM ÚNICA + BACKOFF PROGRESSIVO:
    // O atacante em `singleAttackerIp` dispara múltiplas tentativas de token inválido contra `legitimateUserUid`.
    let attackerGot429 = false;
    let retryAfterHeader = '';
    for (let attempt = 1; attempt <= 8; attempt++) {
      const bruteRes = await fetch(
        `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
        {
          headers: {
            Authorization: `Bearer dvlt_sess_forged_brute_attempt_${attempt}`,
            'X-Device-Id': legitAuth.deviceId,
            'X-User-Uid': legitimateUserUid,
            'X-Forwarded-For': singleAttackerIp,
          },
        }
      );
      if (bruteRes.status === 429) {
        attackerGot429 = true;
        retryAfterHeader = bruteRes.headers.get('retry-after') || '';
        break;
      }
    }
    assert.equal(
      attackerGot429,
      true,
      'Atacante executando força bruta deve sofrer bloqueio 429 com backoff progressivo'
    );
    assert.ok(
      Number(retryAfterHeader) >= 1,
      'Cabeçalho Retry-After deve indicar o tempo de backoff em segundos'
    );

    // 5. ATAQUE DISTRIBUÍDO (Botnet de múltiplos IPs atacando a mesma conta `legitimateUserUid`):
    const botnetIps = [
      '198.51.100.101',
      '198.51.100.102',
      '198.51.100.103',
      '198.51.100.104',
      '198.51.100.105',
    ];
    for (const botIp of botnetIps) {
      for (let i = 0; i < 2; i++) {
        await fetch(
          `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
          {
            headers: {
              Authorization: 'Bearer dvlt_sess_botnet_invalid_token',
              'X-Device-Id': legitAuth.deviceId,
              'X-User-Uid': legitimateUserUid,
              'X-Forwarded-For': botIp,
            },
          }
        );
      }
    }

    const telemetryAfterBotnet = scannerDetector.getTelemetrySnapshot();
    assert.ok(
      telemetryAfterBotnet.distributedAttackAlerts >= 1,
      'O motor de segurança deve detectar e alertar ataques distribuídos contra a mesma conta'
    );

    // 6. REGRA DE OURO (§3): O USUÁRIO LEGÍTIMO NÃO PODE SER BLOQUEADO PELO ABUSO DE TERCEIROS!
    // Mesmo durante o bloqueio do `singleAttackerIp` e o ataque da botnet, o usuário legítimo em `legitimateIp`
    // acessa seu cofre normalmente com 200 OK!
    const legitPullRes = await fetch(
      `${baseUrl}/api/v1/sync/pull?vaultId=${vaultId}&sinceCursor=0`,
      {
        headers: {
          Authorization: `Bearer ${legitAuth.sessionToken}`,
          'X-Device-Id': legitAuth.deviceId,
          'X-User-Uid': legitimateUserUid,
          'X-Forwarded-For': legitimateIp,
        },
      }
    );
    assert.equal(
      legitPullRes.status,
      200,
      'Usuário legítimo em sua origem/sessão válida NUNCA deve ser bloqueado por força bruta de terceiros!'
    );
  });
});

// ============================================================================
// 3. PROTEÇÃO DA API: ACESSO NÃO AUTENTICADO, CORS RESTRITIVO, FUZZING,
//    LIMITES DE PAYLOAD E CONCORRÊNCIA (§2, §4, §7)
// ============================================================================
test('Fase 5B - 03 (§2, §4, §7): Bloqueio de acesso não autenticado (401), CORS restritivo para vault.filipeti.com.br (403), Fuzzing/SQLi/Traversal/Prototype Pollution (400), Limite de Payload (413) e Concorrência (429)', async () => {
  await withHardenedServer(async (baseUrl) => {
    // 1. Acesso não autenticado a todos os endpoints privados -> 401 Unauthorized
    const privateEndpoints = [
      { method: 'GET', path: '/api/v1/auth/devices' },
      { method: 'POST', path: '/api/v1/auth/logout' },
      { method: 'POST', path: '/api/v1/sync/vault' },
      { method: 'POST', path: '/api/v1/sync/push' },
      { method: 'GET', path: '/api/v1/sync/pull?vaultId=v1&sinceCursor=0' },
      { method: 'GET', path: '/api/v1/sync/history?vaultId=v1' },
      { method: 'GET', path: '/api/v1/security/telemetry' },
    ];

    for (const ep of privateEndpoints) {
      const unauthRes = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'X-Forwarded-For': '192.0.2.55' },
      });
      assert.equal(
        unauthRes.status,
        401,
        `Endpoint privado ${ep.method} ${ep.path} deve exigir autenticação (401)`
      );
    }

    // 2. POLÍTICA CORS RESTRITIVA (§4):
    // 2A. Origem oficial planejada `https://vault.filipeti.com.br` -> permitida
    const allowedCorsRes = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://vault.filipeti.com.br',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(allowedCorsRes.status, 204);
    assert.equal(
      allowedCorsRes.headers.get('access-control-allow-origin'),
      'https://vault.filipeti.com.br'
    );

    // 2B. Origem não autorizada / tentativa de bypass de subdomínio -> 403 Forbidden
    const blockedOrigins = [
      'https://evil-attacker.com',
      'https://vault.filipeti.com.br.evil.com',
      'http://vault.filipeti.com.br', // HTTP inseguro no domínio de produção não é permitido!
    ];
    for (const badOrigin of blockedOrigins) {
      const badCorsRes = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'GET',
        headers: {
          Origin: badOrigin,
          'X-Forwarded-For': '198.51.100.70',
        },
      });
      assert.equal(
        badCorsRes.status,
        403,
        `Origem CORS não autorizada "${badOrigin}" deve ser bloqueada com 403 Forbidden`
      );
      assert.equal(
        badCorsRes.headers.get('access-control-allow-origin'),
        null,
        'Jamais deve refletir Access-Control-Allow-Origin para origens bloqueadas'
      );
    }

    // 3. FUZZING DE ENTRADAS (Null Byte, Path Traversal, SQLi em identificadores, Prototype Pollution, JSON malformado)
    // 3A. JSON sintaticamente corrompido -> 400 Bad Request sem stack trace
    const malformedJsonRes = await fetch(
      `${baseUrl}/api/v1/auth/passkey/challenge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.81',
        },
        body: '{"userUid": "homer", "brokenJson": [1, 2, ',
      }
    );
    assert.equal(malformedJsonRes.status, 400);
    const malformedBody = await malformedJsonRes.json();
    assert.match(malformedBody.error, /JSON malformado/i);
    assert.equal(
      JSON.stringify(malformedBody).includes('at JSON.parse'),
      false,
      'Respostas de erro nunca devem expor stack traces internos'
    );

    // 3B. Vetor de SQL Injection / Command Injection no identificador `userUid` -> 400 Bad Request
    const sqliFuzzRes = await fetch(
      `${baseUrl}/api/v1/auth/passkey/challenge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.82',
        },
        body: JSON.stringify({
          userUid: "admin' UNION SELECT password FROM users; --",
        }),
      }
    );
    assert.equal(sqliFuzzRes.status, 400);

    // 3C. Path Traversal / Null Byte na query string -> 400 Bad Request
    const traversalRes = await fetch(
      `${baseUrl}/api/v1/sync/pull?vaultId=../../etc/passwd%00&sinceCursor=0`,
      {
        headers: { 'X-Forwarded-For': '198.51.100.83' },
      }
    );
    assert.equal(traversalRes.status, 400);

    // 3D. Prototype Pollution payload (`__proto__`) -> 400 Bad Request
    const protoPollutionRes = await fetch(
      `${baseUrl}/api/v1/auth/passkey/challenge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.84',
        },
        body: '{"userUid":"test-user","__proto__":{"isAdmin":true}}',
      }
    );
    assert.equal(protoPollutionRes.status, 400);

    // 4. LIMITE DE PAYLOAD ( > 512 KB ) -> 413 Payload Too Large
    const oversizedString = 'A'.repeat(600 * 1024);
    const oversizedRes = await fetch(
      `${baseUrl}/api/v1/auth/passkey/challenge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.85',
        },
        body: JSON.stringify({ userUid: 'test', padding: oversizedString }),
      }
    );
    assert.equal(
      oversizedRes.status,
      413,
      'Payloads acima de 512 KB devem ser rejeitados com 413 Payload Too Large'
    );

    // 5. LIMITE DE CONCORRÊNCIA SIMULTÂNEA (§4)
    const testIp = '198.51.100.90';
    const heldSlots = [];
    for (let i = 0; i < 35; i++) {
      heldSlots.push(
        scannerDetector.acquireConcurrencySlot({
          clientIp: testIp,
          maxPerIp: 35,
        })
      );
    }
    const overflowRes = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-Forwarded-For': testIp },
    });
    assert.equal(
      overflowRes.status,
      429,
      'Exceder o limite de concorrência simultânea por IP deve retornar 429 Too Many Requests'
    );
    for (const s of heldSlots) {
      s.release();
    }
  });
});

// ============================================================================
// 4. OBSERVABILIDADE SEM SEGREDOS E GUARDIÃO CLOUDFLARE ZERO TRUST (§2, §5, §7)
// ============================================================================
test('Fase 5B - 04 (§2, §5, §7): Telemetria de Scanners sem vazamento de segredos/IPs e validação do Guardião Cloudflare Zero Trust (CF-Access-Jwt-Assertion)', async () => {
  await withHardenedServer(async (baseUrl) => {
    const sync = new SyncAdapter();
    const ownerUid = CryptoEngine.randomId('usr-secops-5b');
    const reg = await sync.registerDeviceOnBackend(baseUrl, {
      userUid: ownerUid,
      email: 'fars290191@gmail.com',
      deviceName: 'Console SecOps Barnaby',
      platform: 'desktop-web',
      authMethod: 'webauthn-passkey',
    });

    // Gera alguns eventos de scanner e força bruta para popular as métricas
    await fetch(`${baseUrl}/.env`, {
      headers: { 'X-Forwarded-For': '203.0.113.111' },
    });
    await fetch(`${baseUrl}/api/v1/health`, {
      headers: {
        'User-Agent': 'sqlmap/1.8',
        'X-Forwarded-For': '203.0.113.222',
      },
    });

    // Consulta o endpoint protegido de telemetria
    const telRes = await fetch(`${baseUrl}/api/v1/security/telemetry`, {
      headers: {
        Authorization: `Bearer ${reg.sessionToken}`,
        'X-Device-Id': reg.device.deviceId,
      },
    });
    assert.equal(telRes.status, 200);
    const telemetry = await telRes.json();

    assert.ok(telemetry.blockedScannerRequests >= 2);
    assert.ok(telemetry.countersByCategory.ADMIN_OR_SENSITIVE_PATH_PROBE >= 1);
    assert.ok(telemetry.countersByCategory.KNOWN_SCANNER_FINGERPRINT >= 1);
    assert.ok(Array.isArray(telemetry.recentAlerts));

    // Comprova que NENHUM segredo, token de sessão ou IP bruto existe na telemetria ou nos logs do banco!
    const serializedTelemetry = JSON.stringify(telemetry);
    assert.equal(
      serializedTelemetry.includes(reg.sessionToken),
      false,
      'Token de sessão jamais deve aparecer na telemetria'
    );
    assert.equal(
      serializedTelemetry.includes('203.0.113.111'),
      false,
      'Endereços IP nas métricas de telemetria devem estar anonimizados via SHA-256'
    );

    const dbState = await inspectRawDatabaseStateForTest('non-existent');
    const serializedAudit = JSON.stringify(dbState.auditLogs);
    assert.equal(
      serializedAudit.includes(reg.sessionToken),
      false,
      'Logs de auditoria no PostgreSQL jamais devem conter tokens de sessão'
    );

    // Testa que o Guardião Cloudflare Zero Trust opera em modo Fail-Closed (503) se ativado sem JWKS/iss/aud
    process.env.ENFORCE_CLOUDFLARE_ACCESS = 'true';
    try {
      const failClosedRes = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(
        failClosedRes.status,
        503,
        'Quando ENFORCE_CLOUDFLARE_ACCESS=true sem iss/aud/JWKS configurados, deve falhar fechado (503)'
      );
    } finally {
      delete process.env.ENFORCE_CLOUDFLARE_ACCESS;
    }
  });
});
