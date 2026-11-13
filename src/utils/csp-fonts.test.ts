import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_CSP_PRODUCTION } from '../middleware/reconDefense.ts';

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
