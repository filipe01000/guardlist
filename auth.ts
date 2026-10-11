import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

// Senhas (scrypt) e cookie de sessão assinado. Os usuários ficam no banco (server/users.ts);
// APP_USERS ("usuario:scrypt:<salt>:<hash>", separados por vírgula) só é lido na primeira subida.

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'gl_session';
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const item of (raw || '').split(',')) {
    const entry = item.trim();
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    users.set(entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim());
  }
  return users;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, userId: number, sessionVersion: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, v: sessionVersion, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

// Valida assinatura e validade; quem chama confere no banco se o usuário segue ativo e na mesma versão.
export function readSession(secret: string, req: Request): { userId: number; version: number } | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const { uid, v, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof uid !== 'number' || typeof v !== 'number' || typeof exp !== 'number' || exp < Date.now()) return null;
    return { userId: uid, version: v };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, token: string | null): void {
  const attributes = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? Math.floor(SESSION_TTL_MS / 1000) : 0}`
  ];
  if (req.secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}
