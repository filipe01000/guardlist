import assert from 'node:assert/strict';
import test from 'node:test';
import { base32Decode, base32Encode, generateSecret, otpauthUri, totpAt, verifyTotp } from './totp.ts';

// Segredo dos vetores da RFC 6238 (SHA-1): "12345678901234567890".
const RFC = base32Encode(Buffer.from('12345678901234567890'));

test('vetores oficiais da RFC 6238 (SHA-1, 6 dígitos)', () => {
  assert.equal(totpAt(RFC, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(RFC, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpAt(RFC, Math.floor(1234567890 / 30)), '005924');
  assert.equal(totpAt(RFC, Math.floor(2000000000 / 30)), '279037');
});

test('base32 ida e volta', () => {
  const buf = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  assert.match(generateSecret(), /^[A-Z2-7]{32}$/);
});

test('aceita um período para cada lado, recusa dois', () => {
  const now = 1_000_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(RFC, totpAt(RFC, step - 1), now, null), step - 1);
  assert.equal(verifyTotp(RFC, totpAt(RFC, step + 1), now, null), step + 1);
  assert.equal(verifyTotp(RFC, totpAt(RFC, step - 2), now, null), null);
  assert.equal(verifyTotp(RFC, '12345', now, null), null);
});

test('código já usado no mesmo período é recusado', () => {
  const now = 1_000_000_000_000;
  const step = Math.floor(now / 30_000);
  const code = totpAt(RFC, step);
  assert.equal(verifyTotp(RFC, code, now, null), step);
  assert.equal(verifyTotp(RFC, code, now, step), null);
  assert.equal(verifyTotp(RFC, totpAt(RFC, step - 1), now, step), null);
});

test('URI para o aplicativo autenticador', () => {
  const uri = otpauthUri('ABCDEF', 'ana.souza');
  assert.equal(uri, 'otpauth://totp/GuardList:ana.souza?secret=ABCDEF&issuer=GuardList&algorithm=SHA1&digits=6&period=30');
});
