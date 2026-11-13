import type { Request, Response, NextFunction } from 'express';
import { scannerDetector } from '../services/ScannerDetectionService.ts';
import { recordAuthAuditEvent } from '../db/repository.ts';
import {
  cloudflareAccessVerifier,
  CloudflareAccessVerificationError,
  type VerifiedCloudflareAccessIdentity,
} from '../services/CloudflareAccessVerifier.ts';
import { extractClientIp } from './clientIp.ts';
import { isSessionClaimVerified, readSessionClaim } from './auth.ts';

export { extractClientIp };

export interface ZeroTrustVerifiedRequest extends Request {
  cloudflareIdentity?: VerifiedCloudflareAccessIdentity;
}

// Métodos que o anti-scanner aceita de qualquer origem (os demais só de sessão conferida).
const COMMON_HTTP_METHODS = new Set(['GET', 'POST', 'OPTIONS', 'HEAD']);

// CSP da página do app. As fontes são servidas pelo próprio app. Em produção nada roda inline: o build do Vite só gera arquivos, e o React
// aplica estilos pelo DOM (o que a CSP não bloqueia). No desenvolvimento o Vite injeta script e
// estilo inline e usa WebSocket para recarregar a página.
export const APP_CSP_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  // O canvas-confetti desenha num worker criado a partir de um blob.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const APP_CSP_DEVELOPMENT = APP_CSP_PRODUCTION.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'"
)
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace("connect-src 'self'", "connect-src 'self' ws: wss:");

/**
 * Caminho da requisição a partir de onde o app está montado. Sozinho é o caminho inteiro; dentro do
 * GuardList (app montado em /cofre), /cofre/api/v1/x vira /api/v1/x, para a API manter os cabeçalhos
 * de API e as armadilhas de scanner continuarem valendo.
 */
export function pathWithinApp(req: Pick<Request, 'originalUrl' | 'url'> & { app?: { mountpath?: unknown } }): string {
  const full = req.originalUrl || req.url || '/';
  const mount = typeof req.app?.mountpath === 'string' ? req.app.mountpath : '';
  if (!mount || mount === '/' || !full.startsWith(mount)) return full;
  const rest = full.slice(mount.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

export function appCsp(production: boolean, embedded: boolean): string {
  const base = production ? APP_CSP_PRODUCTION : APP_CSP_DEVELOPMENT;
  return embedded ? base.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : base;
}

/**
 * Domínios oficiais planejados para produção (Fase 5B):
 * - Frontend Web Vault: https://vault.filipeti.com.br
 * - Backend Zero-Knowledge API: https://api-vault.filipeti.com.br
 */
const ALLOWED_PRODUCTION_ORIGINS = new Set([
  'https://vault.filipeti.com.br',
  'https://api-vault.filipeti.com.br',
]);

export function isOriginAllowedForCors(
  originHeader: string | undefined,
  hostHeader: string | undefined
): boolean {
  if (!originHeader) {
    return true;
  }
  if (ALLOWED_PRODUCTION_ORIGINS.has(originHeader)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(originHeader);
    // Permite requisições same-origin (quando Origin bate exatamente com o Host que recebeu a requisição)
    if (hostHeader && parsedOrigin.host === hostHeader) {
      return true;
    }

    // Em ambiente local/homologação (não-produção), permite localhost / 127.0.0.1 e preview controlado
    if (process.env.NODE_ENV !== 'production') {
      if (
        parsedOrigin.hostname === 'localhost' ||
        parsedOrigin.hostname === '127.0.0.1' ||
        parsedOrigin.hostname.endsWith('.run.app')
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * 1. Cabeçalhos de Endurecimento HTTP e Anti-Fingerprinting (Redução de Superfície Pós-Descoberta).
 * Remove cabeçalhos que revelam versão de framework e aplica políticas restritivas de isolamento.
 */
export function securityHeadersAndAntiFingerprintMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  const effectivePath = pathWithinApp(req);
  if (effectivePath.startsWith('/api/')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  } else {
    // Antes a CSP ia numa tag do index.html e liberava script inline também em produção.
    // Dentro do GuardList a página do cofre pode ser aberta num quadro do próprio GuardList (mesma
    // origem); qualquer outro site continua proibido de embutir o cofre.
    const embedded = process.env.DONUTVAULT_EMBEDDED === '1';
    res.setHeader('X-Frame-Options', embedded ? 'SAMEORIGIN' : 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      appCsp(process.env.NODE_ENV === 'production', embedded)
    );
  }

  next();
}

/**
 * 2. Política CORS Restritiva para `vault.filipeti.com.br` e `api-vault.filipeti.com.br`.
 * Rejeita explicitamente origens não autorizadas com 403 Forbidden e nunca utiliza wildcard `*` com credenciais.
 */
export function strictCorsDefenseMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const clientIp = extractClientIp(req);

  if (origin) {
    if (!isOriginAllowedForCors(origin, host)) {
      scannerDetector.recordCorsViolation({
        clientIp,
        origin,
        method: req.method,
        path: req.originalUrl || req.url,
      });
      void recordAuthAuditEvent({
        userUid: 'anonymous',
        deviceId: 'cors-guard',
        eventType: 'CORS_ORIGIN_BLOCKED',
        clientIp,
        metadata: {
          origin: origin.slice(0, 80),
          path: req.path.slice(0, 80),
        },
      });
      res.status(403).json({
        error:
          'Bloqueio de Política CORS (403 Forbidden): Origem não autorizada a interagir com a API Zero-Knowledge.',
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Device-Id, X-User-Uid, X-CSRF-Token'
    );
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method.toUpperCase() === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

/**
 * 3. Armadilha contra Reconhecimento Ativo, Varreduras Automatizadas (Nuclei, Gobuster, FFUF, HTTPx, Nmap)
 *    e Desativação Estrita de Endpoints Administrativos / Debug / Demo.
 */
export async function antiReconAndScannerTrapMiddleware(
  req: ZeroTrustVerifiedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await runAntiReconAndScannerTrap(req, res, next);
  } catch (error) {
    next(error);
  }
}

async function runAntiReconAndScannerTrap(
  req: ZeroTrustVerifiedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientIp = extractClientIp(req);
  const fullPath = req.originalUrl || req.url || '/';

  // A isenção de sessão só vale depois de conferida no banco. Antes bastava mandar um cookie
  // `dvlt_sid=` qualquer (ou `Bearer dvlt_sess_...`) para escapar da penalidade. A conferência só
  // roda quando a isenção muda o resultado: origem penalizada ou método fora do comum.
  let isAuthenticatedSession = Boolean(req.cloudflareIdentity);
  if (
    !isAuthenticatedSession &&
    readSessionClaim(req) &&
    (scannerDetector.isOriginUnderPenalty(clientIp) ||
      !COMMON_HTTP_METHODS.has(req.method.toUpperCase()))
  ) {
    isAuthenticatedSession = await isSessionClaimVerified(req, clientIp);
  }

  // 3A. Verifica assinatura de ferramentas de varredura ativa, métodos HTTP anômalos, penalidade comportamental e rajadas de RPM
  const scannerCheck = scannerDetector.inspectScannerHeaders({
    clientIp,
    userAgent: req.headers['user-agent'],
    headers: req.headers as Record<string, string | string[] | undefined>,
    method: req.method,
    path: fullPath,
    isAuthenticatedSession,
  });

  if (scannerCheck.blocked) {
    const status =
      scannerCheck.statusCode ||
      (scannerCheck.reason?.includes('429') ? 429 : 403);
    void recordAuthAuditEvent({
      userUid: 'anonymous',
      deviceId: 'scanner-shield',
      eventType:
        status === 429 ? 'HIGH_RPM_OR_BEHAVIORAL_BLOCKED' : 'ACTIVE_SCANNER_BLOCKED',
      clientIp,
      metadata: {
        path: fullPath.slice(0, 80),
        method: req.method,
        status,
      },
    });
    res.status(status).json({
      error: scannerCheck.reason,
    });
    return;
  }

  // 3B. Bloqueia sondagens a endpoints administrativos, arquivos ocultos (.env, .git) e rotas de debug/demo
  const trapResult = scannerDetector.isSensitiveOrAdminTrapPath(pathWithinApp(req));
  if (trapResult.trapped) {
    const { shouldThrottle429 } = scannerDetector.recordAdminOrSensitivePathProbe({
      clientIp,
      method: req.method,
      path: fullPath,
      matchedPattern: trapResult.matchedPattern || 'sensitive-trap',
    });

    void recordAuthAuditEvent({
      userUid: 'anonymous',
      deviceId: 'recon-trap',
      eventType: 'ADMIN_OR_SENSITIVE_ENDPOINT_PROBE',
      clientIp,
      metadata: {
        path: fullPath.slice(0, 80),
        method: req.method,
      },
    });

    if (shouldThrottle429) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        error: 'Muitas tentativas de acesso a recursos inexistentes (429).',
      });
      return;
    }

    // Resposta uniforme 404 sem revelar se o recurso existe ou qual tecnologia roda no backend
    res.status(404).json({
      error: 'Recurso não encontrado (404).',
    });
    return;
  }

  // 3C. Controle de Concorrência Simultânea por Origem (IP)
  const maxConcurrentPerIp = Number(
    process.env.MAX_CONCURRENT_REQUESTS_PER_IP || 35
  );
  const slot = scannerDetector.acquireConcurrencySlot({
    clientIp,
    userUid: req.headers['x-user-uid'] as string | undefined,
    maxPerIp: maxConcurrentPerIp,
  });

  if (!slot.acquired) {
    scannerDetector.recordAlert({
      category: 'CONCURRENCY_LIMIT_EXCEEDED',
      severity: 'MEDIUM',
      clientIp,
      method: req.method,
      path: fullPath,
      statusCode: 429,
      reason: 'Limite de requisições simultâneas excedido para esta origem.',
    });
    res.setHeader('Retry-After', '5');
    res.status(429).json({
      error: 'Limite de concorrência simultânea excedido (429 Too Many Requests).',
    });
    return;
  }

  res.on('finish', slot.release);
  res.on('close', slot.release);

  next();
}

/**
 * 4. Validação Rigorosa de Entrada contra Fuzzing (FFUF / Wfuzz / SQLMap / Prototype Pollution)
 *    antes que o payload alcance os controladores de negócio.
 */
export async function inputFuzzingDefenseMiddleware(
  req: ZeroTrustVerifiedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await runInputFuzzingDefense(req, res, next);
  } catch (error) {
    next(error);
  }
}

async function runInputFuzzingDefense(
  req: ZeroTrustVerifiedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const clientIp = extractClientIp(req);
  const fullPath = req.originalUrl || req.url || '/';

  const check = scannerDetector.inspectInputForFuzzing({
    clientIp,
    method: req.method,
    path: fullPath,
    query: req.query,
    body: req.body,
  });

  if (check.blocked) {
    void recordAuthAuditEvent({
      userUid: 'anonymous',
      deviceId: 'fuzzing-guard',
      eventType: 'FUZZING_PAYLOAD_REJECTED',
      clientIp,
      metadata: {
        path: fullPath.slice(0, 80),
        method: req.method,
      },
    });
    res.status(400).json({
      error: check.reason || 'Entrada inválida ou malformada (400 Bad Request).',
    });
    return;
  }

  // Detecção Comportamental de Varredura Horizontal de Contas/Cofres (Account/Vault Sweeping)
  // Independente de User-Agent: se uma origem não autenticada sondar >= 6 contas/cofres distintos na mesma janela, aplica 429!
  const targetCandidate =
    (typeof req.body?.userUid === 'string' && req.body.userUid) ||
    (typeof req.body?.vaultId === 'string' && req.body.vaultId) ||
    (typeof req.query?.vaultId === 'string' && req.query.vaultId) ||
    '';

  const isSweepSensitivePath =
    fullPath.includes('/auth/webauthn/authenticate') ||
    fullPath.includes('/auth/passkey/challenge') ||
    fullPath.includes('/sync/vault/recovery/bundle');

  // Mesma regra do anti-scanner: só sessão conferida no banco fica fora da contagem.
  const isAuthenticatedSession =
    targetCandidate && isSweepSensitivePath
      ? Boolean(req.cloudflareIdentity) ||
        (readSessionClaim(req) !== null &&
          (await isSessionClaimVerified(req, clientIp)))
      : false;

  if (targetCandidate && isSweepSensitivePath && !isAuthenticatedSession) {
    const sweep = scannerDetector.inspectBehavioralTargetSweep({
      clientIp,
      targetIdentifier: targetCandidate,
      method: req.method,
      path: fullPath,
      isAuthenticatedSession: false,
    });
    if (sweep.blocked) {
      res.setHeader('Retry-After', String(sweep.retryAfterSeconds));
      res.status(429).json({
        error: sweep.reason,
        retryAfterSeconds: sweep.retryAfterSeconds,
      });
      return;
    }
  }

  next();
}

/**
 * 5. Validação Criptográfica Real do Cloudflare Access (Fase 5C — §1):
 * - Quando ativado (`ENFORCE_CLOUDFLARE_ACCESS === 'true'` ou via override de teste),
 *   NUNCA aceita requisições apenas pela presença sintática de `CF-Access-Jwt-Assertion`.
 * - Valida assinatura RS256 contra o JWKS da organização via `jose`, `iss`, `aud`, `exp`,
 *   lista de e-mails autorizados do proprietário e revogação de sessão (`jti`/`sub`).
 * - Opera em modo Fail-Closed: se ativado com configuração incompleta, bloqueia com 503.
 */
export async function optionalCloudflareZeroTrustGuard(
  req: ZeroTrustVerifiedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const config = cloudflareAccessVerifier.resolveActiveConfig();
  if (!config.enabled) {
    next();
    return;
  }

  const clientIp = extractClientIp(req);
  const fullPath = req.originalUrl || req.url || '/';
  const rawJwt = req.headers['cf-access-jwt-assertion'] as string | undefined;

  try {
    const verifiedIdentity =
      await cloudflareAccessVerifier.verifyAssertionToken(rawJwt);
    req.cloudflareIdentity = verifiedIdentity;
    next();
  } catch (err) {
    const status =
      err instanceof CloudflareAccessVerificationError ? err.statusCode : 403;
    const errorCode =
      err instanceof CloudflareAccessVerificationError
        ? err.errorCode
        : 'CF_VERIFICATION_FAILED';
    const message =
      err instanceof Error
        ? err.message
        : 'Zero Trust Policy Violation (403 Forbidden).';

    scannerDetector.recordZeroTrustRejection({
      clientIp,
      method: req.method,
      path: fullPath,
      statusCode: status,
      reason: `${errorCode}: ${message}`,
    });

    await recordAuthAuditEvent({
      userUid: 'anonymous',
      deviceId: 'cloudflare-access-guard',
      eventType: `CF_ACCESS_REJECTED_${errorCode}`,
      clientIp,
      metadata: {
        path: fullPath.slice(0, 80),
        method: req.method,
        status,
        errorCode,
      },
    });

    res.status(status).json({
      error: message,
      code: errorCode,
    });
  }
}

/**
 * 6. Tratador Global de Erros de Parsing (JSON Malformado / Payload Excedido 413)
 *    Remove completamente stack traces, caminhos de arquivos internos e detalhes de bibliotecas.
 */
export function sanitizedApiErrorMiddleware(
  err: Error & { status?: number; statusCode?: number; type?: string },
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const clientIp = extractClientIp(req);
  const fullPath = req.originalUrl || req.url || '/';

  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    scannerDetector.recordAlert({
      category: 'FUZZING_OR_MALFORMED_INPUT',
      severity: 'MEDIUM',
      clientIp,
      method: req.method,
      path: fullPath,
      statusCode: 413,
      reason: 'Payload HTTP excedeu o limite máximo permitido (413 Payload Too Large).',
    });
    res.status(413).json({
      error: 'Payload excede o tamanho máximo permitido pelo servidor (413).',
    });
    return;
  }

  if (err instanceof SyntaxError || err.type === 'entity.parse.failed') {
    scannerDetector.recordAlert({
      category: 'FUZZING_OR_MALFORMED_INPUT',
      severity: 'MEDIUM',
      clientIp,
      method: req.method,
      path: fullPath,
      statusCode: 400,
      reason: 'Payload JSON malformado recebido pela API.',
    });
    res.status(400).json({
      error: 'Payload JSON malformado ou inválido (400 Bad Request).',
    });
    return;
  }

  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error:
      statusCode >= 500
        ? 'Erro interno de processamento na API Zero-Knowledge.'
        : 'Requisição inválida.',
  });
}
