import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

// Usuários vêm de APP_USERS no formato "usuario:scrypt:<salt>:<hash>", separados por vírgula.
// Gere cada linha com `npm run user:add -- <usuario>`.

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'gl_session';
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
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

// Hash fictício para que usuário inexistente custe o mesmo tempo que senha errada.
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

export function checkCredentials(users: Map<string, string>, username: string, password: string): string | null {
  const normalized = username.trim().toLowerCase();
  const stored = users.get(normalized);
  const valid = verifyPassword(password, stored || dummyHash);
  return stored && valid ? normalized : null;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, username: string): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret: string, users: Map<string, string>, req: Request): string | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // Remover o usuário de APP_USERS invalida as sessões dele.
    if (typeof u !== 'string' || typeof exp !== 'number' || exp < Date.now() || !users.has(u)) return null;
    return u;
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
