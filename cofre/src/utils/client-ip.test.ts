import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import {
  extractClientIp,
  parseTrustProxyRule,
  resolveClientIpHeaderName,
} from '../middleware/clientIp.ts';

function fakeRequest(
  remoteAddress: string,
  headers: Record<string, string> = {}
): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const CLEAN_ENV = {
  RENDER: undefined,
  CLIENT_IP_HEADER: undefined,
  TRUST_PROXY: undefined,
};

test('IP do cliente: X-Forwarded-For de quem não é proxy é ignorado', () => {
  withEnv(CLEAN_ENV, () => {
    const req = fakeRequest('203.0.113.5', { 'x-forwarded-for': '1.2.3.4' });
    assert.equal(extractClientIp(req), '203.0.113.5');
  });
});

test('IP do cliente: CF-Connecting-IP só vale quando configurado', () => {
  withEnv(CLEAN_ENV, () => {
    const req = fakeRequest('203.0.113.5', { 'cf-connecting-ip': '9.9.9.9' });
    assert.equal(extractClientIp(req), '203.0.113.5');
  });
  withEnv({ ...CLEAN_ENV, CLIENT_IP_HEADER: 'cf-connecting-ip' }, () => {
    const req = fakeRequest('203.0.113.5', { 'cf-connecting-ip': '9.9.9.9' });
    assert.equal(extractClientIp(req), '9.9.9.9');
  });
});

test('IP do cliente: no Render usa CF-Connecting-IP e ignora o X-Forwarded-For', () => {
  withEnv({ ...CLEAN_ENV, RENDER: 'true' }, () => {
    assert.equal(resolveClientIpHeaderName(), 'cf-connecting-ip');
    const req = fakeRequest('10.0.0.7', {
      'cf-connecting-ip': '2001:db8::42',
      'x-forwarded-for': '1.2.3.4, 2001:db8::42, 172.70.1.1',
    });
    assert.equal(extractClientIp(req), '2001:db8::42');

    // Valor inválido: cai no endereço da conexão, nunca no texto enviado.
    const bad = fakeRequest('10.0.0.7', {
      'cf-connecting-ip': 'nao-e-ip',
      'x-forwarded-for': '1.2.3.4',
    });
    assert.equal(extractClientIp(bad), '10.0.0.7');
  });
  withEnv({ ...CLEAN_ENV, RENDER: 'true', CLIENT_IP_HEADER: 'none' }, () => {
    assert.equal(resolveClientIpHeaderName(), null);
  });
});

test('IP do cliente: atrás de proxy local vale o endereço que o proxy acrescentou', () => {
  withEnv(CLEAN_ENV, () => {
    assert.equal(
      extractClientIp(
        fakeRequest('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.7' })
      ),
      '198.51.100.7'
    );
    // O cliente pode pôr o que quiser à esquerda; o proxy acrescenta o endereço real à direita.
    assert.equal(
      extractClientIp(
        fakeRequest('127.0.0.1', { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })
      ),
      '198.51.100.7'
    );
    assert.equal(
      extractClientIp(fakeRequest('::1', { 'x-forwarded-for': 'lixo' })),
      '::1'
    );
    assert.equal(extractClientIp(fakeRequest('127.0.0.1')), '127.0.0.1');
  });
});

test('IP do cliente: TRUST_PROXY com número de saltos e com none', () => {
  withEnv({ ...CLEAN_ENV, TRUST_PROXY: '2' }, () => {
    const req = fakeRequest('10.0.0.1', {
      'x-forwarded-for': '6.6.6.6, 198.51.100.9, 172.16.0.1',
    });
    assert.equal(extractClientIp(req), '198.51.100.9');
  });
  withEnv({ ...CLEAN_ENV, TRUST_PROXY: 'none' }, () => {
    const req = fakeRequest('127.0.0.1', { 'x-forwarded-for': '198.51.100.9' });
    assert.equal(extractClientIp(req), '127.0.0.1');
  });
  assert.deepEqual(parseTrustProxyRule(undefined), { kind: 'loopback' });
  assert.deepEqual(parseTrustProxyRule('qualquer'), { kind: 'loopback' });
  assert.deepEqual(parseTrustProxyRule('99'), { kind: 'hops', hops: 5 });
});
