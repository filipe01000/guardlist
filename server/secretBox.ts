import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { StoreError } from './storeCore.ts';

// Guarda segredos no banco criptografados (AES-256-GCM) com uma chave mestra que só existe nas variáveis de
// ambiente (por exemplo, MFA_SECRET_KEY). O prefixo de versão permite trocar a chave no futuro.

function masterKey(envKey: string, env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env[envKey];
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function secretKeyAvailable(envKey: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return masterKey(envKey, env) !== null;
}

function requireKey(envKey: string, env: NodeJS.ProcessEnv): Buffer {
  const key = masterKey(envKey, env);
  if (!key) throw new StoreError(`Recurso indisponível: falta ${envKey} no servidor.`, 503);
  return key;
}

export function sealSecret(value: string, envKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = requireKey(envKey, env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function openSecret(blob: string, envKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = requireKey(envKey, env);
  const [version, iv, tag, data] = String(blob).split(':');
  try {
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('formato');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new StoreError('Segredo ilegível: a chave mestra mudou ou o dado foi alterado.', 500);
  }
}
