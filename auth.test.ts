import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from './auth.ts';

test('verifica a senha correta e rejeita senha incorreta', () => {
  const stored = hashPassword('senha-segura-123');
  assert.equal(verifyPassword('senha-segura-123', stored), true);
  assert.equal(verifyPassword('outra-senha-456', stored), false);
});

test('hashes malformados não permitem autenticação', () => {
  const valid = hashPassword('senha-segura-123');
  const [, salt, hash] = valid.split(':');
  for (const stored of [
    `scrypt:${salt}:zz`,
    `scrypt:${salt}:0`,
    `scrypt:${salt}:${hash.slice(2)}`,
    `scrypt:zz:${hash}`,
    `${valid}:extra`,
    ''
  ]) {
    assert.equal(verifyPassword('senha-segura-123', stored), false, stored);
  }
});
