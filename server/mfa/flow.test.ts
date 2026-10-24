import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { createStepToken, readStepToken, STEP_COOKIE } from '../../auth.ts';

const secret = 'segredo-de-teste';
const req = (token: string) => ({ headers: { cookie: `${STEP_COOKIE}=${encodeURIComponent(token)}` } }) as unknown as Request;

test('etapa pendente: lê usuário, versão e tipo', () => {
  const token = createStepToken(secret, { uid: 7, ver: 3, kind: 'mfa' }, 1_000);
  assert.deepEqual(readStepToken(secret, req(token), 2_000), { uid: 7, ver: 3, kind: 'mfa' });
});

test('etapa pendente expira em 5 minutos', () => {
  const token = createStepToken(secret, { uid: 7, ver: 3, kind: 'mfa-setup' }, 1_000);
  assert.ok(readStepToken(secret, req(token), 1_000 + 5 * 60_000 - 1));
  assert.equal(readStepToken(secret, req(token), 1_000 + 5 * 60_000 + 1), null);
});

test('assinatura ou segredo diferentes invalidam', () => {
  const token = createStepToken(secret, { uid: 7, ver: 3, kind: 'mfa' }, 1_000);
  assert.equal(readStepToken('outro-segredo', req(token), 2_000), null);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 1, ver: 3, kind: 'mfa', exp: 9e15 })).toString('base64url');
  assert.equal(readStepToken(secret, req(`${forged}.${sig}`), 2_000), null);
  assert.equal(readStepToken(secret, req(`${payload}.x`), 2_000), null);
});

test('cookie de sessão não serve como etapa', () => {
  assert.equal(readStepToken(secret, { headers: { cookie: 'gl_session=abc.def' } } as unknown as Request, 2_000), null);
});
