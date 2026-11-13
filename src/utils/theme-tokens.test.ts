import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Os dois temas precisam ter os mesmos tokens e contraste AA nos pares de texto e fundo.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function tokensOf(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `bloco ${selector} não encontrado`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  assert.match(value, /^[0-9a-f]{6}$/i, `cor fora do formato #rrggbb: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Razão de contraste da WCAG 2.1.
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokensOf(':root');
const dark = tokensOf('.dark');

test('os dois temas definem os mesmos tokens', () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

for (const [nome, tema] of [['claro', light], ['escuro', dark]] as const) {
  test(`contraste AA no tema ${nome}`, () => {
    assert.ok(contrast(tema['--foreground'], tema['--background']) >= 4.5);
    assert.ok(contrast(tema['--foreground'], tema['--secondary-background']) >= 4.5);
    assert.ok(contrast(tema['--muted'], tema['--background']) >= 4.5);
    assert.ok(contrast(tema['--muted'], tema['--secondary-background']) >= 4.5);
    assert.ok(contrast(tema['--main-foreground'], tema['--main']) >= 4.5);
    assert.ok(contrast(tema['--destructive-foreground'], tema['--destructive']) >= 4.5);
    assert.ok(contrast(tema['--accent'], tema['--background']) >= 4.5);
    for (const estado of ['--success', '--warning', '--danger']) {
      assert.ok(contrast(tema[estado], tema['--secondary-background']) >= 4.5, estado);
    }
  });
}

test('amarelo é a cor de ação nos dois temas', () => {
  assert.equal(light['--main'].toUpperCase(), '#FFD90F');
  assert.equal(dark['--main'].toUpperCase(), '#FFD90F');
});
