import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSize, logoCandidates } from './logo.ts';

test('logo: prefere a do cabeçalho, depois og:image, ícones e favicon', () => {
  const html = `
    <meta property="og:image" content="/social.jpg">
    <link rel="icon" href="/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
    <img src="/assets/img/logo-principal.png" alt="Empresa">
    <img src="/banner.jpg" alt="Promoção">`;
  const list = logoCandidates(html, new URL('https://exemplo.com.br/'));
  assert.deepEqual(list.slice(0, 4), [
    'https://exemplo.com.br/assets/img/logo-principal.png',
    'https://exemplo.com.br/social.jpg',
    'https://exemplo.com.br/apple.png',
    'https://exemplo.com.br/favicon-32.png'
  ]);
  assert.ok(!list.includes('https://exemplo.com.br/banner.jpg'));
  assert.equal(list.at(-1), 'https://exemplo.com.br/favicon.ico');
});

test('logo: lê largura e altura de PNG e GIF pelo cabeçalho', () => {
  const png = Buffer.alloc(32);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(681, 16);
  png.writeUInt32BE(146, 20);
  assert.deepEqual(imageSize(png, 'image/png'), { w: 681, h: 146 });
  const gif = Buffer.from('GIF89a\x30\x00\x10\x00rest', 'latin1');
  assert.deepEqual(imageSize(gif, 'image/gif'), { w: 48, h: 16 });
  assert.equal(imageSize(Buffer.from('nada'), 'image/x-icon'), null);
});

test('logo: imagem de outro domínio (selo de parceiro) perde para a do próprio site', () => {
  const html = `<img src="https://app.parceiro.com/assets/logo_main.png"><link rel="apple-touch-icon" href="/apple.png" sizes="180x180">`;
  const list = logoCandidates(html, new URL('https://www.cliente.com.br/'));
  assert.equal(list[0], 'https://www.cliente.com.br/apple.png');
});
