import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkMasterPasswordPolicy,
  evaluatePasswordStrength,
} from './generator.ts';
import { getStrengthEngine, loadStrengthEngine } from './strengthEngine.ts';

// Este arquivo roda em processo próprio, com o medidor ainda não carregado no começo.
const STRONG_PASSPHRASE = 'Cometa-Laranja-Teclado-Veludo-8142!';

test('Antes de o medidor carregar, nenhuma senha é aprovada', () => {
  assert.equal(getStrengthEngine(), null);
  const policy = checkMasterPasswordPolicy(STRONG_PASSPHRASE);
  assert.equal(policy.ok, false);
  assert.match(policy.ok ? '' : policy.reason, /carregando/);

  const pending = evaluatePasswordStrength(STRONG_PASSPHRASE);
  assert.equal(pending.level, 'weak');
  assert.equal(pending.label, 'Calculando…');
});

test('Depois de carregar, o medidor avalia de verdade', async () => {
  await loadStrengthEngine();
  assert.notEqual(getStrengthEngine(), null);
  assert.deepEqual(checkMasterPasswordPolicy(STRONG_PASSPHRASE), { ok: true });
  assert.equal(evaluatePasswordStrength('123456').level, 'weak');
  assert.equal(evaluatePasswordStrength(STRONG_PASSPHRASE).level, 'strong');
});
