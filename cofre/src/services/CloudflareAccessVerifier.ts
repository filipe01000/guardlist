import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose';

export interface CloudflareAccessConfig {
  enabled: boolean;
  issuer: string;
  audience: string | string[];
  allowedEmails: string[];
  jwksUrl?: string;
  localJwks?: JSONWebKeySet;
  clockToleranceSeconds?: number;
}

export interface VerifiedCloudflareAccessIdentity {
  sub: string;
  email: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  jti?: string;
  kid?: string;
}

export class CloudflareAccessVerificationError extends Error {
  public readonly statusCode: number;
  public readonly errorCode:
    | 'CF_CONFIG_MISSING_FAIL_CLOSED'
    | 'CF_TOKEN_MISSING'
    | 'CF_TOKEN_MALFORMED'
    | 'CF_ALG_NOT_ALLOWED'
    | 'CF_SIGNATURE_OR_KEY_INVALID'
    | 'CF_TOKEN_EXPIRED'
    | 'CF_ISSUER_MISMATCH'
    | 'CF_AUDIENCE_MISMATCH'
    | 'CF_USER_NOT_AUTHORIZED'
    | 'CF_SESSION_REVOKED';

  constructor(
    message: string,
    statusCode: number,
    errorCode: CloudflareAccessVerificationError['errorCode']
  ) {
    super(message);
    this.name = 'CloudflareAccessVerificationError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Verificador Criptográfico Real de Tokens Cloudflare Access (Fase 5C — §1).
 * Utiliza a biblioteca `jose` para validar:
 * - Assinatura criptográfica RS256 contra o JWKS da organização Cloudflare (ou JWKS injetado para testes de rotação).
 * - Restrição estrita de algoritmo (`algorithms: ['RS256']`), bloqueando `none`, `HS256` ou confusão de chave.
 * - Emissor (`iss`), Audiência (`aud`) e Expiração (`exp` / `nbf`).
 * - Autorização explícita da identidade (`email`) contra a lista de proprietários permitidos.
 * - Revogação imediata de tokens (`jti`) ou sessões de usuário (`sub` / `email` antes de determinado timestamp).
 * - Política Fail-Closed: se ativado sem configuração completa de `iss`, `aud` ou `allowedEmails`,
 *   bloqueia o acesso em vez de desativar silenciosamente a proteção.
 */
export class CloudflareAccessVerifier {
  private customConfig: CloudflareAccessConfig | null = null;
  private remoteJwksCache = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();
  private revokedTokenJtis = new Set<string>();
  private revokedSubjectsBeforeUnix = new Map<string, number>();

  public setConfigOverrideForTests(config: CloudflareAccessConfig | null): void {
    this.customConfig = config;
    this.remoteJwksCache.clear();
  }

  public updateLocalJwksForKeyRotationTest(newJwks: JSONWebKeySet): void {
    if (!this.customConfig) {
      throw new Error(
        'Configure setConfigOverrideForTests antes de rotacionar o JWKS local.'
      );
    }
    this.customConfig = {
      ...this.customConfig,
      localJwks: newJwks,
    };
  }

  public revokeTokenJti(jti: string): void {
    if (jti) {
      this.revokedTokenJtis.add(jti);
    }
  }

  public revokeSubjectSessionsIssuedBefore(
    subjectOrEmail: string,
    unixTimestampSeconds = Math.floor(Date.now() / 1000)
  ): void {
    this.revokedSubjectsBeforeUnix.set(
      subjectOrEmail.toLowerCase().trim(),
      unixTimestampSeconds
    );
  }

  public resetForTests(): void {
    this.customConfig = null;
    this.remoteJwksCache.clear();
    this.revokedTokenJtis.clear();
    this.revokedSubjectsBeforeUnix.clear();
  }

  public resolveActiveConfig(): CloudflareAccessConfig {
    if (this.customConfig) {
      return this.customConfig;
    }

    const explicitEnforce =
      process.env.ENFORCE_CLOUDFLARE_ACCESS === 'true';
    const isProdForceZeroTrust =
      process.env.NODE_ENV === 'production' &&
      process.env.ENFORCE_CLOUDFLARE_ACCESS === 'true';

    const enabled = explicitEnforce || isProdForceZeroTrust;

    const teamDomain = (process.env.CLOUDFLARE_TEAM_DOMAIN || '').trim();
    const issuer = (
      process.env.CLOUDFLARE_ACCESS_ISSUER ||
      (teamDomain ? `https://${teamDomain}.cloudflareaccess.com` : '')
    )
      .trim()
      .replace(/\/+$/, '');

    const rawAud = (process.env.CLOUDFLARE_ACCESS_AUD || '').trim();
    const audience = rawAud
      ? rawAud
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const rawEmails = (process.env.CLOUDFLARE_ALLOWED_EMAILS || '').trim();
    const allowedEmails = rawEmails
      ? rawEmails
          .split(',')
          .map((e) => e.toLowerCase().trim())
          .filter(Boolean)
      : [];

    const jwksUrl = (
      process.env.CLOUDFLARE_ACCESS_JWKS_URL ||
      (issuer ? `${issuer}/cdn-cgi/access/certs` : '')
    ).trim();

    return {
      enabled,
      issuer,
      audience,
      allowedEmails,
      jwksUrl,
      clockToleranceSeconds: 5,
    };
  }

  private getKeyResolver(config: CloudflareAccessConfig) {
    if (config.localJwks) {
      return createLocalJWKSet(config.localJwks);
    }
    if (!config.jwksUrl) {
      throw new CloudflareAccessVerificationError(
        'Fail-Closed Zero Trust (503): URL do JWKS da organização Cloudflare não configurada.',
        503,
        'CF_CONFIG_MISSING_FAIL_CLOSED'
      );
    }
    let remote = this.remoteJwksCache.get(config.jwksUrl);
    if (!remote) {
      remote = createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        timeoutDuration: 5_000,
      });
      this.remoteJwksCache.set(config.jwksUrl, remote);
    }
    return remote;
  }

  public async verifyAssertionToken(
    rawJwt: string | undefined
  ): Promise<VerifiedCloudflareAccessIdentity> {
    const config = this.resolveActiveConfig();

    // 1. Fail-Closed: nunca desativa silenciosamente a validação se variáveis obrigatórias faltarem!
    const hasAudience = Array.isArray(config.audience)
      ? config.audience.length > 0
      : Boolean(config.audience);

    if (
      !config.issuer ||
      !hasAudience ||
      !config.allowedEmails ||
      config.allowedEmails.length === 0 ||
      (!config.localJwks && !config.jwksUrl)
    ) {
      throw new CloudflareAccessVerificationError(
        'Fail-Closed Zero Trust (503): Configuração obrigatória do Cloudflare Access incompleta (issuer, audience, allowedEmails ou JWKS ausentes). Acesso bloqueado por segurança.',
        503,
        'CF_CONFIG_MISSING_FAIL_CLOSED'
      );
    }

    if (!rawJwt || typeof rawJwt !== 'string' || !rawJwt.trim()) {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Cabeçalho CF-Access-Jwt-Assertion ausente.',
        403,
        'CF_TOKEN_MISSING'
      );
    }

    const parts = rawJwt.trim().split('.');
    if (parts.length !== 3) {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Formato de token JWT inválido.',
        403,
        'CF_TOKEN_MALFORMED'
      );
    }

    // 2. Inspeciona preliminarmente o cabeçalho JOSE para rejeitar imediatamente algoritmos diferentes de RS256
    let headerObj: { alg?: string; kid?: string };
    try {
      headerObj = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8')
      );
    } catch {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Cabeçalho JOSE malformado.',
        403,
        'CF_TOKEN_MALFORMED'
      );
    }

    if (headerObj.alg !== 'RS256') {
      throw new CloudflareAccessVerificationError(
        `Zero Trust Access Negado (403): Algoritmo JWT "${String(headerObj.alg)}" não permitido. Apenas RS256 é aceito.`,
        403,
        'CF_ALG_NOT_ALLOWED'
      );
    }

    const keyResolver = this.getKeyResolver(config);

    // 3. Executa verificação criptográfica completa via `jose` (RS256, iss, aud, exp, nbf)
    let payload: JWTPayload;
    let protectedHeader: { alg?: string; kid?: string };
    try {
      const verified = await jwtVerify(rawJwt.trim(), keyResolver, {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        clockTolerance: config.clockToleranceSeconds ?? 5,
      });
      payload = verified.payload;
      protectedHeader = verified.protectedHeader;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : String(err);

      if (code === 'ERR_JWT_EXPIRED') {
        throw new CloudflareAccessVerificationError(
          'Zero Trust Access Negado (403): O token CF-Access-Jwt-Assertion expirou (exp).',
          403,
          'CF_TOKEN_EXPIRED'
        );
      }
      if (
        code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' &&
        msg.includes('"iss"')
      ) {
        throw new CloudflareAccessVerificationError(
          'Zero Trust Access Negado (403): Emissor (iss) do token Cloudflare Access inválido.',
          403,
          'CF_ISSUER_MISMATCH'
        );
      }
      if (
        code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' &&
        msg.includes('"aud"')
      ) {
        throw new CloudflareAccessVerificationError(
          'Zero Trust Access Negado (403): Audiência (aud) do token Cloudflare Access incorreta para esta aplicação.',
          403,
          'CF_AUDIENCE_MISMATCH'
        );
      }

      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Assinatura criptográfica RS256 inválida ou chave pública (kid) revogada/desconhecida no JWKS.',
        403,
        'CF_SIGNATURE_OR_KEY_INVALID'
      );
    }

    // 4. Verifica presença obrigatória de `exp`, `sub` e `email` no payload assinado
    if (typeof payload.exp !== 'number') {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Claim de expiração (exp) ausente no JWT.',
        403,
        'CF_TOKEN_EXPIRED'
      );
    }

    const email = String(payload.email || '')
      .toLowerCase()
      .trim();
    const sub = String(payload.sub || '').trim();

    if (!email || !sub) {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (403): Claims de identidade (sub/email) ausentes no token assinado.',
        403,
        'CF_USER_NOT_AUTHORIZED'
      );
    }

    // 5. Verifica se a identidade assinada no JWT pertence exclusivamente ao proprietário autorizado
    const allowedSet = new Set(
      config.allowedEmails.map((e) => e.toLowerCase().trim())
    );
    if (!allowedSet.has(email)) {
      throw new CloudflareAccessVerificationError(
        `Zero Trust Access Negado (403): O usuário autenticado no Cloudflare Access não possui permissão para acessar este cofre.`,
        403,
        'CF_USER_NOT_AUTHORIZED'
      );
    }

    // 6. Verifica revogação explícita de token (`jti`) ou de sessão (`sub` / `email`)
    const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
    if (jti && this.revokedTokenJtis.has(jti)) {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (401): Este token Cloudflare Access (jti) foi explicitamente revogado.',
        401,
        'CF_SESSION_REVOKED'
      );
    }

    const iat =
      typeof payload.iat === 'number'
        ? payload.iat
        : Math.floor(Date.now() / 1000);
    const revokedSubBefore = this.revokedSubjectsBeforeUnix.get(
      sub.toLowerCase()
    );
    const revokedEmailBefore = this.revokedSubjectsBeforeUnix.get(email);
    if (
      (typeof revokedSubBefore === 'number' && iat <= revokedSubBefore) ||
      (typeof revokedEmailBefore === 'number' && iat <= revokedEmailBefore)
    ) {
      throw new CloudflareAccessVerificationError(
        'Zero Trust Access Negado (401): A sessão Cloudflare Access deste usuário foi revogada.',
        401,
        'CF_SESSION_REVOKED'
      );
    }

    return {
      sub,
      email,
      iss: String(payload.iss),
      aud: payload.aud as string | string[],
      exp: payload.exp,
      iat: payload.iat,
      jti,
      kid: protectedHeader.kid,
    };
  }
}

export const cloudflareAccessVerifier = new CloudflareAccessVerifier();
