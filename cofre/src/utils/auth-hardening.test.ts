import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Request } from 'express';
import { createDonutVaultApp } from '../../server.ts';
import { parseCookieHeader } from '../middleware/auth.ts';
import { resolveRpIdAndOrigin } from '../server/syncRoutes.ts';

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: { host: '127.0.0.1:3000' },
    protocol: 'http',
    body: {},
    ...overrides,
  } as Request;
}

test('parseCookieHeader ignora cookies com codificação inválida em vez de lançar', () => {
  assert.doesNotThrow(() => parseCookieHeader('a=%E0; dvlt_did=dev-1'));
  assert.deepEqual(parseCookieHeader('a=%E0; dvlt_did=dev-1'), {
    dvlt_did: 'dev-1',
  });
});

test('cookie malformado não derruba o servidor', async (t) => {
  const app = await createDonutVaultApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const res = await fetch(`${base}/api/v1/auth/devices`, {
    headers: { cookie: 'a=%E0' },
  });
  assert.equal(res.status, 401);

  const stillAlive = await fetch(`${base}/healthz`);
  assert.equal(stillAlive.status, 200);
});

test('WebAuthn ignora rpId e origin enviados pelo cliente', () => {
  const req = fakeRequest({
    body: { rpId: 'evil.example', origin: 'https://evil.example' },
    headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' },
  });
  assert.deepEqual(resolveRpIdAndOrigin(req, { NODE_ENV: 'development' }), {
    rpId: '127.0.0.1',
    expectedOrigin: 'http://127.0.0.1:3000',
  });
});

test('WebAuthn usa a configuração do servidor', () => {
  const req = fakeRequest({ body: { rpId: 'evil.example' } });
  assert.deepEqual(
    resolveRpIdAndOrigin(req, {
      NODE_ENV: 'production',
      WEBAUTHN_RP_ID: 'vault.filipeti.com.br',
      WEBAUTHN_ORIGIN: 'https://vault.filipeti.com.br',
    }),
    {
      rpId: 'vault.filipeti.com.br',
      expectedOrigin: 'https://vault.filipeti.com.br',
    }
  );
  assert.deepEqual(
    resolveRpIdAndOrigin(req, {
      NODE_ENV: 'production',
      RENDER_EXTERNAL_URL: 'https://donutvault-hml.onrender.com',
    }),
    {
      rpId: 'donutvault-hml.onrender.com',
      expectedOrigin: 'https://donutvault-hml.onrender.com',
    }
  );
});

test('WebAuthn sem configuração em produção falha fechado', () => {
  assert.throws(
    () => resolveRpIdAndOrigin(fakeRequest(), { NODE_ENV: 'production' }),
    /WEBAUTHN_RP_ID/
  );
});
