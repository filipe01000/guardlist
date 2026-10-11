import assert from 'node:assert/strict';
import test from 'node:test';
import { runValidatorTests } from './validator.test';

for (const result of runValidatorTests().results) {
  test(`${result.suite}: ${result.name}`, () => {
    assert.ok(result.passed, result.error || `Esperado ${JSON.stringify(result.expected)}, recebido ${JSON.stringify(result.actual)}`);
  });
}
