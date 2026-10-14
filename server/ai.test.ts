import assert from 'node:assert/strict';
import test from 'node:test';
import { thinkFilter } from './ai.ts';

const run = (chunks: string[]) => {
  let out = '';
  const f = thinkFilter((t) => { out += t; });
  for (const c of chunks) f.push(c);
  f.flush();
  return out;
};

test('remove o bloco <think> e mantém a resposta', () => {
  assert.equal(run(['<think>pensando…</think>', 'Resposta final.']), 'Resposta final.');
});

test('marcação partida entre pedaços do stream', () => {
  assert.equal(run(['Olá <th', 'ink>segredo</th', 'ink> mundo']), 'Olá mundo');
});

test('texto comum com "<" não é engolido', () => {
  assert.equal(run(['IPs < 10 e ', 'CIDR <24']), 'IPs < 10 e CIDR <24');
});

test('sem raciocínio, o texto passa intacto', () => {
  assert.equal(run(['- **CREA**: ', 'vence em 2 dias.']), '- **CREA**: vence em 2 dias.');
});
