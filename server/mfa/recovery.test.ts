import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeRecoveryCode, generateRecoveryCodes } from './recovery.ts';

test('gera 10 códigos e guarda só o hash', () => {
  const { codes, hashes } = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-7]{4}-[a-z2-7]{4}$/);
  assert.equal(hashes.some((h) => codes.some((c) => h.includes(c))), false);
});

test('aceita com espaços, sem hífen ou em maiúsculas, e só uma vez', () => {
  const { codes, hashes } = generateRecoveryCodes();
  const typed = ` ${codes[3].replace('-', ' ').toUpperCase()} `;
  const left = consumeRecoveryCode(hashes, typed);
  assert.equal(left?.length, 9);
  assert.equal(consumeRecoveryCode(left!, codes[3]), null);
  assert.equal(consumeRecoveryCode(hashes, 'zzzz-zzzz'), null);
});
