import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDonutVaultApp } from '../../server.ts';
import { createPool } from '../db/index.ts';

test('deployment liveness does not query or wake the database', async (t) => {
  const query = t.mock.method(createPool(), 'query', async () => {
    throw new Error('Liveness must not connect to PostgreSQL');
  });
  const app = await createDonutVaultApp({ skipVite: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/healthz`;

  const healthy = await fetch(url);
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { status: 'ok' });
  assert.equal(healthy.headers.get('cache-control'), 'no-store');
  assert.equal(healthy.headers.get('x-powered-by'), null);
  assert.equal(query.mock.callCount(), 0);
});
