import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name: string) => readFileSync(`src/styles/palettes/${name}.css`, 'utf8');
const tokens = (css: string) => new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
const value = (css: string, block: string, name: string) => {
  const start = css.indexOf(`${block} {`);
  return new RegExp(`${name}: (#[0-9a-fA-F]{6});`).exec(css.slice(start, css.indexOf('}', start)))![1];
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('paletas: a ativa e a guardada têm os mesmos tokens, então a troca é só o @import', () => {
  assert.deepEqual([...tokens(read('evening-mix'))].sort(), [...tokens(read('azul-noite'))].sort());
  assert.match(readFileSync('src/index.css', 'utf8'), /@import "\.\/styles\/palettes\/evening-mix\.css";/);
});

test('paleta ativa: texto legível nos dois temas (WCAG AA)', () => {
  const css = read('evening-mix');
  for (const block of [':root', ':root[data-theme="light"]']) {
    for (const bg of ['--app-bg', '--surface', '--surface-raised']) {
      for (const fg of ['--text', '--text-soft', '--muted']) {
        const ratio = contrast(value(css, block, fg), value(css, block, bg));
        assert.ok(ratio >= 4.5, `${block} ${fg} em ${bg}: ${ratio.toFixed(2)}`);
      }
    }
    const ratio = contrast(value(css, block, '--action-text'), value(css, block, '--action'));
    assert.ok(ratio >= 4.5, `${block} botão principal: ${ratio.toFixed(2)}`);
  }
});
