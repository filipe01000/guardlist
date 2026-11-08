import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMasterPasswordPolicy, MASTER_PASSWORD_MIN_LENGTH } from './generator.ts';
import { loadStrengthEngine } from './strengthEngine.ts';
import {
  ARGON2_PROFILES,
  DEFAULT_ARGON2_PARAMS,
  NEW_VAULT_ARGON2_PARAMS,
} from '../services/CryptoEngine.ts';

await loadStrengthEngine();

test('Senha Mestra curta é recusada', () => {
  const result = checkMasterPasswordPolicy('Ab1!xyz');
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? '' : result.reason,
    new RegExp(`${MASTER_PASSWORD_MIN_LENGTH} caracteres`)
  );
});

test('Senha Mestra longa porém previsível é recusada', () => {
  for (const weak of ['aaaaaaaaaaaaaaaa', 'senha123456789', 'rosquinha2026!']) {
    assert.equal(checkMasterPasswordPolicy(weak).ok, false, weak);
  }
});

test('Frase-senha longa e imprevisível é aceita', () => {
  assert.deepEqual(
    checkMasterPasswordPolicy('Rosquinha Atomica #Setor7G 2026!'),
    { ok: true }
  );
  assert.deepEqual(
    checkMasterPasswordPolicy('girafa trombone janela azul 47'),
    { ok: true }
  );
});

test('Cofres novos usam Argon2id mais forte; o padrão antigo segue para compatibilidade', () => {
  assert.deepEqual(NEW_VAULT_ARGON2_PARAMS, ARGON2_PROFILES['owasp-high-v2']);
  assert.ok(NEW_VAULT_ARGON2_PARAMS.m >= 19456);
  assert.equal(DEFAULT_ARGON2_PARAMS.m, 16384);
});
