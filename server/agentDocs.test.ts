import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { ABOUT, agentRouter, CONTACT, HEAD_MARK, headTags, HOME, notFound, pageHtml, pageMarkdown, PRIVACY, STATIC_HOME_MARK, staticHome } from './agentDocs.ts';

const ORIGIN = 'https://guardlist.example';

async function start(t: TestContext) {
  const app = express();
  app.use(agentRouter(() => ORIGIN));
  app.get('/', (_req, res) => { res.type('html').send(`<div id="root">${staticHome()}</div>`); });
  app.get('*', notFound);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, accept?: string) => fetch(base + path, { headers: accept ? { Accept: accept } : {} });
}

test('home: mais de 500 caracteres em HTML puro, H1 e títulos em sequência', () => {
  const html = staticHome();
  assert.ok(html.replace(/<[^>]+>/g, '').length >= 500);
  assert.equal(html.match(/<h1>/g)?.length, 1);
  assert.deepEqual([...new Set(html.match(/<h[1-6]/g))], ['<h1', '<h2']);
});

test('index.html: conteúdo dentro de #root e escondido só com JavaScript', () => {
  const index = readFileSync('index.html', 'utf8');
  assert.ok(index.includes(`<div id="root">${STATIC_HOME_MARK}</div>`));
  assert.ok(index.includes(HEAD_MARK));
  assert.match(index, /<noscript><style>\.gl-static \{ visibility: visible;/);
});

test('home: URL canônica e JSON-LD válido', () => {
  const head = headTags(ORIGIN);
  assert.ok(head.includes(`<link rel="canonical" href="${ORIGIN}/" />`));
  const data = JSON.parse(head.match(/<script type="application\/ld\+json">(.*)<\/script>/)![1]);
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.name, 'GuardList');
  assert.equal(data.url, `${ORIGIN}/`);
});

test('páginas de confiança: mais de 500 caracteres em HTML, com URL canônica', async (t) => {
  const get = await start(t);
  for (const [path, page] of [['/about', ABOUT], ['/contact', CONTACT], ['/privacy', PRIVACY]] as const) {
    assert.ok(pageHtml(page).replace(/<[^>]+>/g, '').length >= 500, path);
    const html = await (await get(path, 'text/html')).text();
    assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}${path}">`), path);
    assert.match((await get(path, 'text/markdown')).headers.get('content-type')!, /^text\/markdown/);
  }
});

test('home: negocia Markdown e mantém HTML', async (t) => {
  const get = await start(t);
  const md = await get('/', 'text/markdown');
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type')!, /^text\/markdown/);
  assert.match(md.headers.get('vary')!, /Accept/);
  assert.equal(await md.text(), pageMarkdown(HOME));
  for (const accept of ['text/html', 'text/html,application/xhtml+xml,*/*;q=0.8', '*/*']) {
    const html = await get('/', accept);
    assert.match(html.headers.get('content-type')!, /^text\/html/, accept);
    assert.match(html.headers.get('vary')!, /Accept/);
  }
});

test('404 real: Markdown para agentes, HTML para navegadores', async (t) => {
  const get = await start(t);
  const md = await get('/nao-existe', 'text/markdown');
  assert.equal(md.status, 404);
  assert.match(md.headers.get('content-type')!, /^text\/markdown/);
  const body = await md.text();
  assert.ok(body.length >= 20);
  assert.match(body, /\/llms\.txt/);
  const html = await get('/nao-existe', 'text/html');
  assert.equal(html.status, 404);
  assert.match(html.headers.get('content-type')!, /^text\/html/);
  assert.equal((await get('/assets/antigo.js')).status, 404);
});

test('arquivos para máquinas', async (t) => {
  const get = await start(t);
  const llms = await (await get('/llms.txt')).text();
  assert.match(llms, /^# GuardList\n\n> /);
  assert.ok(llms.includes(`${ORIGIN}/openapi.json`));
  assert.match(llms, /## Quando usar/);

  const spec = await (await get('/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.servers[0].url, ORIGIN);
  // Cada caminho publicado existe no servidor, e nenhuma operação interna ou de administração vaza.
  const source = readFileSync('server.ts', 'utf8');
  for (const path of Object.keys(spec.paths)) {
    assert.ok(source.includes(`'${path}'`), path);
    assert.match(path, /^\/(healthz|api\/auth\/)/);
  }

  // Pronta para chamada de função: id único, descrição e resposta tipada em toda operação.
  const operations = Object.values(spec.paths).flatMap((p) => Object.values(p as object)) as Array<Record<string, any>>;
  assert.equal(new Set(operations.map((o) => o.operationId)).size, operations.length);
  for (const op of operations) {
    assert.ok(op.description, op.operationId);
    assert.ok(Object.values(op.responses as object).every((r: any) => r.content), op.operationId);
  }
  assert.ok(spec.components.headers.RetryAfter);

  const robots = await (await get('/robots.txt')).text();
  assert.match(robots, /Disallow: \/api\//);
  assert.ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));

  const sitemap = await get('/sitemap.xml');
  assert.match(sitemap.headers.get('content-type')!, /xml/);
  const map = await sitemap.text();
  for (const path of ['/', '/docs', '/about', '/contact', '/privacy']) assert.ok(map.includes(`<loc>${ORIGIN}${path}</loc><lastmod>`), path);

  const docs = await get('/docs', 'text/html');
  assert.match(await docs.text(), /<title>[^<]*GuardList/);
  assert.match((await get('/docs', 'text/markdown')).headers.get('content-type')!, /^text\/markdown/);
  assert.equal((await get('/docs.md')).status, 200);
  assert.equal((await get('/index.md')).status, 200);
});
