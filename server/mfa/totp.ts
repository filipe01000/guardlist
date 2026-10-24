import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Códigos de aplicativo autenticador (TOTP, RFC 6238): SHA-1, 6 dígitos, período de 30 segundos.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_MS = 30_000;
const WINDOW = 1; // um período para cada lado, para relógios levemente fora de hora

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// Devolve o período aceito, ou null. Períodos até lastStep (já usados) não valem de novo.
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = Math.floor(nowMs / PERIOD_MS);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(typed))) return step;
  }
  return null;
}

// `image` é o ícone da conta; alguns aplicativos (FreeOTP, por exemplo) mostram, os demais ignoram.
export function otpauthUri(secret: string, account: string, image?: string, issuer = 'GuardList'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const icon = image ? `&image=${encodeURIComponent(image)}` : '';
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30${icon}`;
}
