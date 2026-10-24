import assert from 'node:assert/strict';
import test from 'node:test';
import QRCode from 'qrcode';
import { brandedQrSvg, logoArea } from './qr.ts';

const URI = 'otpauth://totp/GuardList:administrador.sistema?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=GuardList&algorithm=SHA1&digits=6&period=30&image=https%3A%2F%2Fguardlist.onrender.com%2Fbrand%2Fguardlist-icon.png';

test('QR com a logo: SVG com o selo no centro', () => {
  const svg = brandedQrSvg(URI);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /class="gl-qr-logo"/);
});

test('a logo cobre pouco do código e fica longe dos olhos', () => {
  const { size } = QRCode.create(URI, { errorCorrectionLevel: 'H' }).modules;
  const { start, span } = logoArea(size);
  // Nível H recupera até 30%; a logo fica bem abaixo disso.
  assert.ok((span * span) / (size * size) < 0.08);
  // Os olhos ocupam 8 módulos (7 + separador) em cada canto.
  assert.ok(start >= 8 && start + span <= size - 8);
  assert.equal(start * 2 + span, size, 'centralizada');
});
