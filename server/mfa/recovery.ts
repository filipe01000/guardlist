import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp.ts';

// Códigos de recuperação: 10 por usuário, uso único. Só o hash fica guardado; o código aparece uma vez.

const COUNT = 10;

const normalize = (input: string) => String(input ?? '').toLowerCase().replace(/[^a-z2-7]/g, '');
const hash = (normalized: string) => createHash('sha256').update(`guardlist-recovery:${normalized}`).digest('hex');

export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = new Set<string>();
  while (codes.size < COUNT) {
    const raw = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8);
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  const list = [...codes];
  return { codes: list, hashes: list.map((c) => hash(normalize(c))) };
}

// Devolve a lista sem o código usado, ou null se ele não vale.
export function consumeRecoveryCode(hashes: string[], input: string): string[] | null {
  const clean = normalize(input);
  if (clean.length !== 8) return null;
  const h = hash(clean);
  const index = hashes.indexOf(h);
  return index === -1 ? null : hashes.filter((_, i) => i !== index);
}
