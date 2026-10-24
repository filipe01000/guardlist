import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
  // Buffer.from ignora hex inválido; um hash vazio acabava comparando dois buffers vazios.
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored)) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
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

// Cada login gera um segredo aleatório (sid). O banco guarda só o hash dele, na tabela sessions.
export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function hashSessionId(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

export function createSessionToken(secret: string, sid: string): string {
  const payload = Buffer.from(JSON.stringify({ sid, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

// Valida assinatura e validade; quem chama confere no banco se a sessão segue aberta e o usuário ativo.
export function readSession(secret: string, req: Request): { sid: string } | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const { sid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof sid !== 'string' || !sid || typeof exp !== 'number' || exp < Date.now()) return null;
    return { sid };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    // Cookie com codificação inválida conta como ausente (decodeURIComponent lança URIError).
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

// Etapa pendente do login (senha certa, falta o código de verificação ou o cadastro dele). Não é uma sessão:
// só vale para as rotas /api/auth/mfa*, por 5 minutos, e carrega a versão de sessão do usuário.
export const STEP_COOKIE = 'gl_mfa';
const STEP_TTL_MS = 5 * 60_000;
export type StepKind = 'mfa' | 'mfa-setup';
export interface StepToken { uid: number; ver: number; kind: StepKind }

export function createStepToken(secret: string, step: StepToken, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...step, exp: nowMs + STEP_TTL_MS, t: 'step' })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function readStepToken(secret: string, req: Request, nowMs = Date.now()): StepToken | null {
  const token = readCookie(req, STEP_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.t !== 'step' || typeof data.exp !== 'number' || data.exp < nowMs) return null;
    if (!Number.isInteger(data.uid) || !Number.isInteger(data.ver) || (data.kind !== 'mfa' && data.kind !== 'mfa-setup')) return null;
    return { uid: data.uid, ver: data.ver, kind: data.kind };
  } catch {
    return null;
  }
}

export function setStepCookie(req: Request, res: Response, token: string | null): void {
  const attributes = [
    `${STEP_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? Math.floor(STEP_TTL_MS / 1000) : 0}`
  ];
  if (req.secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
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
  res.append('Set-Cookie', attributes.join('; '));
}
