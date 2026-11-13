import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_CSP_PRODUCTION, appCsp, pathWithinApp } from '../middleware/reconDefense.ts';

// As fontes são servidas pelo próprio app; a página não depende de nenhum outro domínio.
test('CSP de produção não libera Google Fonts', () => {
  assert.ok(!APP_CSP_PRODUCTION.includes('googleapis'));
  assert.ok(!APP_CSP_PRODUCTION.includes('gstatic'));
  assert.ok(APP_CSP_PRODUCTION.includes("style-src 'self'"));
  assert.ok(APP_CSP_PRODUCTION.includes("font-src 'self' data:"));
  assert.ok(APP_CSP_PRODUCTION.includes("script-src 'self'"));
  assert.ok(!APP_CSP_PRODUCTION.includes("'unsafe-inline'"));
});

test('index.html não carrega nada de fora', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(!/https?:\/\/fonts\./.test(html));
});

// Dentro do GuardList só o próprio endereço pode abrir o cofre num quadro; sozinho, ninguém pode.
test('cofre sozinho não pode ser embutido; dentro do GuardList, só pela mesma origem', () => {
  assert.ok(appCsp(true, false).includes("frame-ancestors 'none'"));
  const embedded = appCsp(true, true);
  assert.ok(embedded.includes("frame-ancestors 'self'"));
  assert.ok(!embedded.includes("frame-ancestors 'none'"));
  assert.ok(!embedded.includes('*'));
});

// Montado em /cofre, a API continua sendo reconhecida como API (cabeçalhos sem quadro e sem cache).
test('caminho a partir do ponto de montagem', () => {
  assert.equal(pathWithinApp({ originalUrl: '/cofre/api/v1/health', url: '/api/v1/health', app: { mountpath: '/cofre' } }), '/api/v1/health');
  assert.equal(pathWithinApp({ originalUrl: '/cofre', url: '/', app: { mountpath: '/cofre' } }), '/');
  assert.equal(pathWithinApp({ originalUrl: '/api/v1/health', url: '/api/v1/health', app: { mountpath: '/' } }), '/api/v1/health');
  assert.equal(pathWithinApp({ originalUrl: '/.env', url: '/.env' }), '/.env');
});
