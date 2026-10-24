import assert from 'node:assert/strict';
import test from 'node:test';
import { openSecret, sealSecret, secretKeyAvailable } from './secretBox.ts';

const env = { MFA_SECRET_KEY: Buffer.alloc(32, 4).toString('base64') };

test('ida e volta sem expor o valor', () => {
  const blob = sealSecret('JBSWY3DPEHPK3PXP', 'MFA_SECRET_KEY', env);
  assert.match(blob, /^v1:/);
  assert.equal(blob.includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(openSecret(blob, 'MFA_SECRET_KEY', env), 'JBSWY3DPEHPK3PXP');
});

test('dado adulterado é recusado', () => {
  const [v, iv, tag, data] = sealSecret('abc', 'MFA_SECRET_KEY', env).split(':');
  const bad = Buffer.from(data, 'base64');
  bad[0] ^= 1;
  assert.throws(() => openSecret([v, iv, tag, bad.toString('base64')].join(':'), 'MFA_SECRET_KEY', env));
});

test('sem chave fica indisponível', () => {
  assert.equal(secretKeyAvailable('MFA_SECRET_KEY', {}), false);
  assert.equal(secretKeyAvailable('MFA_SECRET_KEY', env), true);
  assert.throws(() => sealSecret('x', 'MFA_SECRET_KEY', {}), /MFA_SECRET_KEY/);
});
