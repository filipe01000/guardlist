import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  hashTokenSha256,
  recordAuthAuditEvent,
  verifyDeviceSessionInDb,
} from '../db/repository.ts';
import { scannerDetector } from '../services/ScannerDetectionService.ts';
import { cloudflareAccessVerifier } from '../services/CloudflareAccessVerifier.ts';
import { extractClientIp } from './reconDefense.ts';

export interface AuthenticatedSyncRequest extends Request {
  authContext?: {
    userUid: string;
    email: string;
    deviceId: string;
    deviceName: string;
    authMethod: string;
    csrfTokenSha256?: string | null;
  };
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const rawValue = part.slice(idx + 1).trim();
      // decodeURIComponent lança URIError em sequências inválidas (ex.: "%E0").
      // Como isso roda em middleware assíncrono, o erro derrubava o processo Node.
      try {
        out[k] = decodeURIComponent(rawValue);
      } catch {
        // Cookie malformado é ignorado; os nossos são sempre codificados corretamente.
      }
    }
  }
  return out;
}

/**
 * Configura cookies de sessão protegidos (HttpOnly, Secure, SameSite=Strict)
 * para que o stream SSE e as requisições autenticadas por cookie não exponham o token em URLs ou scripts XSS.
 */
export function setSecureSessionCookies(
  res: Response,
  deviceId: string,
  rawSessionToken: string,
  maxAgeSeconds = 30 * 24 * 60 * 60
): void {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `dvlt_sid=${encodeURIComponent(rawSessionToken)}; Path=/api/v1; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secureFlag}`,
    `dvlt_did=${encodeURIComponent(deviceId)}; Path=/api/v1; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secureFlag}`,
  ]);
}

export function clearSecureSessionCookies(res: Response): void {
  res.setHeader('Set-Cookie', [
    'dvlt_sid=; Path=/api/v1; Max-Age=0; HttpOnly; SameSite=Strict',
    'dvlt_did=; Path=/api/v1; Max-Age=0; HttpOnly; SameSite=Strict',
  ]);
}

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

export function checkRateLimit(
  key: string,
  maxRequests = 120,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetAtMs: number } {
  const now = Date.now();
  const bucket = rateLimitStore.get(key);
  if (!bucket || now >= bucket.resetAtMs) {
    const nextBucket: RateLimitBucket = {
      count: 1,
      resetAtMs: now + windowMs,
    };
    rateLimitStore.set(key, nextBucket);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAtMs: nextBucket.resetAtMs,
    };
  }

  bucket.count += 1;
  return {
    allowed: bucket.count <= maxRequests,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetAtMs: bucket.resetAtMs,
  };
}

export function resetRateLimitsForTests(): void {
  rateLimitStore.clear();
  scannerDetector.resetAllForTests();
  cloudflareAccessVerifier.resetForTests();
}

const FORBIDDEN_PLAINTEXT_KEYS = new Set([
  'password',
  'masterPassword',
  'dek',
  'kek',
  'sessionDek',
  'secretKey',
  'recoveryKey',
  'serviceName',
  'content',
  'title',
  'credentials',
  'notes',
]);

function containsForbiddenPlaintextKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenPlaintextKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PLAINTEXT_KEYS.has(k)) {
      return k;
    }
    const nested = containsForbiddenPlaintextKey(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Middleware Zero-Knowledge: Bloqueia imediatamente qualquer requisição HTTP que tente
 * transmitir senhas, notas, títulos, DEK, KEK, Secret Key ou Recovery Key em texto puro para o servidor.
 */
export const enforceZeroPlaintextBodyGuard = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.body && typeof req.body === 'object') {
    const forbiddenKey = containsForbiddenPlaintextKey(req.body);
    if (forbiddenKey) {
      res.status(400).json({
        error: `Violação Zero-Knowledge: O servidor rejeitou o envio do campo sensível "${forbiddenKey}" em texto puro.`,
      });
      return;
    }
  }
  next();
};

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware de Autenticação de Conta e Dispositivo + Proteção Anti-CSRF (Fase 5A — §2):
 * Aceita:
 * 1) Token de Sessão de Dispositivo via Header (`Authorization: Bearer dvlt_sess_...` + `X-Device-Id`)
 *    OU via Cookie `HttpOnly; SameSite=Strict` (`dvlt_sid` + `dvlt_did`), validado no PostgreSQL com expiração e revogação, OU
 * 2) Firebase ID Token (`Bearer <jwt>`) + Header `X-Device-Id`.
 *
 * Proteção Anti-CSRF:
 * - Bloqueia requisições mutáveis (`POST/PUT/PATCH/DELETE`) com `Sec-Fetch-Site: cross-site` ou `Origin` divergente do `Host`.
 * - Quando autenticado via Cookie `HttpOnly` (sem header `Authorization`), exige obrigatoriamente o cabeçalho
 *   `X-CSRF-Token` correspondente ao `csrf_token_sha256` registrado na sessão do dispositivo no PostgreSQL!
 */
export const requireDeviceOrFirebaseAuth = async (
  req: AuthenticatedSyncRequest,
  res: Response,
  next: NextFunction
) => {
  const clientIp = extractClientIp(req);
  const targetAccountHeader =
    (req.headers['x-user-uid'] as string) || undefined;

  const bfCheck = scannerDetector.checkBruteForceAllowance({
    clientIp,
    targetAccount: targetAccountHeader,
    scope: 'session-auth',
  });
  if (!bfCheck.allowed) {
    res.setHeader('Retry-After', String(bfCheck.retryAfterSeconds));
    res.status(429).json({
      error:
        bfCheck.reason ||
        'Muitas tentativas de autenticação inválidas (429 Too Many Requests).',
      retryAfterSeconds: bfCheck.retryAfterSeconds,
    });
    return;
  }

  const rl = checkRateLimit(`auth:${clientIp}`, 180, 60_000);
  if (!rl.allowed) {
    res.status(429).json({
      error: 'Rate limit excedido (429 Too Many Requests). Aguarde antes de tentar novamente.',
    });
    return;
  }

  const isMutating = STATE_CHANGING_METHODS.has(req.method.toUpperCase());

  // 1. Verificação Anti-CSRF de Origin e Sec-Fetch-Site em métodos mutáveis
  if (isMutating) {
    const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (secFetchSite === 'cross-site') {
      await recordAuthAuditEvent({
        userUid: (req.headers['x-user-uid'] as string) || 'anonymous',
        deviceId: (req.headers['x-device-id'] as string) || 'unknown',
        eventType: 'CSRF_BLOCKED_CROSS_SITE',
        clientIp,
        metadata: { path: req.path, secFetchSite },
      });
      res.status(403).json({
        error: 'Bloqueio de Segurança CSRF (403 Forbidden): Requisição cross-site rejeitada.',
      });
      return;
    }

    const originHeader = req.headers.origin;
    const hostHeader = req.headers.host;
    if (originHeader && hostHeader) {
      try {
        const originUrl = new URL(originHeader);
        if (originUrl.host !== hostHeader) {
          await recordAuthAuditEvent({
            userUid: (req.headers['x-user-uid'] as string) || 'anonymous',
            deviceId: (req.headers['x-device-id'] as string) || 'unknown',
            eventType: 'CSRF_BLOCKED_ORIGIN_MISMATCH',
            clientIp,
            metadata: { path: req.path, originHost: originUrl.host, hostHeader },
          });
          res.status(403).json({
            error: `Bloqueio de Segurança CSRF (403 Forbidden): Origin "${originUrl.host}" diverge do Host "${hostHeader}".`,
          });
          return;
        }
      } catch {
        res.status(403).json({
          error: 'Bloqueio de Segurança CSRF (403 Forbidden): Cabeçalho Origin malformado.',
        });
        return;
      }
    }
  }

  const cookies = parseCookieHeader(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const usingCookieAuth = Boolean(!authHeader && cookies.dvlt_sid);

  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : cookies.dvlt_sid || '';
  const deviceIdHeader =
    (req.headers['x-device-id'] as string) || cookies.dvlt_did || '';

  if (!token) {
    scannerDetector.recordAuthFailure({
      clientIp,
      targetAccount: targetAccountHeader,
      scope: 'session-auth',
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: 401,
      failureThreshold: 8,
    });
    res.status(401).json({
      error: 'Não autorizado (401): Token de autenticação ou cookie de sessão ausente.',
    });
    return;
  }

  try {
    // Caminho 1: Token de Sessão de Dispositivo Zero-Knowledge (`dvlt_sess_...`)
    if (token.startsWith('dvlt_sess_')) {
      if (!deviceIdHeader) {
        scannerDetector.recordAuthFailure({
          clientIp,
          targetAccount: targetAccountHeader,
          scope: 'session-auth',
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: 401,
          failureThreshold: 8,
        });
        res.status(401).json({
          error: 'Identificador do dispositivo (X-Device-Id ou cookie dvlt_did) obrigatório para sessão (401).',
        });
        return;
      }

      const expectedUserUid =
        (req.headers['x-user-uid'] as string) || undefined;
      const device = await verifyDeviceSessionInDb({
        expectedUserUid,
        deviceId: deviceIdHeader,
        rawSessionToken: token,
      });

      // Se a requisição utiliza autenticação por Cookie HttpOnly (ou forneceu X-CSRF-Token em método mutável),
      // valida criptograficamente o token CSRF vinculado à sessão no PostgreSQL!
      const csrfHeader = (req.headers['x-csrf-token'] as string) || '';
      if (isMutating && (usingCookieAuth || csrfHeader)) {
        if (!csrfHeader || !device.csrfTokenSha256) {
          const err = new Error(
            'Bloqueio CSRF (403 Forbidden): Cabeçalho X-CSRF-Token obrigatório para sessões baseadas em cookie.'
          );
          (err as Error & { statusCode?: number }).statusCode = 403;
          throw err;
        }
        if (hashTokenSha256(csrfHeader) !== device.csrfTokenSha256) {
          const err = new Error(
            'Bloqueio CSRF (403 Forbidden): Token X-CSRF-Token inválido ou não vinculado a esta sessão.'
          );
          (err as Error & { statusCode?: number }).statusCode = 403;
          throw err;
        }
      }

      scannerDetector.recordAuthSuccess({
        clientIp,
        targetAccount: device.userUid,
        scope: 'session-auth',
      });

      req.authContext = {
        userUid: device.userUid,
        email: `${device.userUid}@donutvault.local`,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        authMethod: device.authMethod,
        csrfTokenSha256: device.csrfTokenSha256,
      };
      next();
      return;
    }

    // Caminho 2: Firebase Auth ID Token (Google OAuth)
    const decoded = await adminAuth.verifyIdToken(token);
    if (deviceIdHeader) {
      const device = await verifyDeviceSessionInDb({
        expectedUserUid: decoded.uid,
        deviceId: deviceIdHeader,
        rawSessionToken: (req.headers['x-device-session-token'] as string) || '',
      });
      req.authContext = {
        userUid: decoded.uid,
        email: decoded.email || `${decoded.uid}@donutvault.local`,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        authMethod: 'firebase-oauth',
        csrfTokenSha256: device.csrfTokenSha256,
      };
    } else {
      req.authContext = {
        userUid: decoded.uid,
        email: decoded.email || `${decoded.uid}@donutvault.local`,
        deviceId: 'firebase-web-client',
        deviceName: 'Navegador Autenticado',
        authMethod: 'firebase-oauth',
      };
    }
    next();
  } catch (error) {
    const statusCode =
      (error as Error & { statusCode?: number }).statusCode || 401;
    scannerDetector.recordAuthFailure({
      clientIp,
      targetAccount: targetAccountHeader || deviceIdHeader,
      scope: 'session-auth',
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      failureThreshold: 6,
    });
    await recordAuthAuditEvent({
      userUid: (req.headers['x-user-uid'] as string) || 'anonymous',
      deviceId: deviceIdHeader || 'unknown',
      eventType: statusCode === 403 ? 'AUTH_FORBIDDEN_403' : 'AUTH_REJECTED_401',
      clientIp,
      metadata: {
        path: req.path,
        statusCode,
      },
    });
    res.status(statusCode).json({
      error:
        error instanceof Error
          ? error.message
          : 'Não autorizado (401): Token inválido ou revogado.',
    });
  }
};
