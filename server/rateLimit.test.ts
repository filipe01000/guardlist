import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { rateLimit } from './rateLimit.ts';

test('limite: informa os cabeçalhos RateLimit e devolve 429 com Retry-After', async (t) => {
  const app = express();
  app.get('/x', rateLimit('teste', 2), (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;

  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('ratelimit-limit'), '2');
  assert.equal(first.headers.get('ratelimit-remaining'), '1');
  assert.ok(Number(first.headers.get('ratelimit-reset')) > 0);
  assert.equal(first.headers.get('retry-after'), null);

  assert.equal((await fetch(url)).headers.get('ratelimit-remaining'), '0');

  const blocked = await fetch(url);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.match((await blocked.json()).error, /Muitas tentativas \(teste\)/);
});
