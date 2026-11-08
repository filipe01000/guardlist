import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { CryptoEngine } from './CryptoEngine.ts';

export type SecurityAnomalyCategory =
  | 'KNOWN_SCANNER_FINGERPRINT'
  | 'BEHAVIORAL_SCANNER_PATTERN'
  | 'ADMIN_OR_SENSITIVE_PATH_PROBE'
  | 'REPEATED_404_ENUMERATION'
  | 'HIGH_RPM_BURST'
  | 'FUZZING_OR_MALFORMED_INPUT'
  | 'BRUTE_FORCE_AUTH_FAILURE'
  | 'DISTRIBUTED_CREDENTIAL_STUFFING'
  | 'CORS_POLICY_VIOLATION'
  | 'CONCURRENCY_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_ENDPOINT_ACCESS'
  | 'ZERO_TRUST_ACCESS_VIOLATION';

export interface SecurityAlertEvent {
  alertId: string;
  timestamp: string;
  createdAtMs: number;
  category: SecurityAnomalyCategory;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  originPseudonymHmac: string;
  targetAccountPseudonymHmac?: string;
  method: string;
  pathTemplate: string;
  statusCode: number;
  reason: string;
}

export interface BruteForceCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  backoffLevel: number;
  distributedAlertTriggered: boolean;
  reason?: string;
}

export interface SecurityTelemetrySnapshot {
  totalRequestsObserved: number;
  blockedScannerRequests: number;
  blockedFuzzingRequests: number;
  blockedBruteForceAttempts: number;
  blockedCorsViolations: number;
  concurrencyRejections: number;
  notFoundEnumerationCount: number;
  distributedAttackAlerts: number;
  behavioralScannerDetections: number;
  zeroTrustRejections: number;
  pseudonymizationPolicy: {
    algorithm: 'HMAC-SHA256';
    keyBitLength: 256;
    activeKeyEpoch: number;
    keyRotatedAt: string;
    retentionWindowMinutes: number;
    plainSha256IpUsed: false;
  };
  countersByCategory: Record<SecurityAnomalyCategory, number>;
  recentAlerts: Omit<SecurityAlertEvent, 'createdAtMs'>[];
  passiveReconNote: string;
}

interface IpTrafficWindow {
  windowStartMs: number;
  requestCount: number;
  notFoundCount: number;
  distinct404Paths: Set<string>;
  distinctUnauthTargets: Set<string>;
  clientErrorCount: number;
  adminProbeCount: number;
  fuzzingCount: number;
  scannerPenaltyUntilMs: number;
}

interface CompositeAuthFailureBucket {
  failures: number;
  firstFailureMs: number;
  lastFailureMs: number;
  lockoutUntilMs: number;
}

interface DistributedAccountFailureBucket {
  distinctOriginHmacs: Set<string>;
  totalFailures: number;
  windowStartMs: number;
  stepUpCooldownUntilMs: number;
}

const KNOWN_SCANNER_USER_AGENTS = [
  /nuclei/i,
  /projectdiscovery/i,
  /httpx/i,
  /gobuster/i,
  /ffuf/i,
  /feroxbuster/i,
  /dirbuster/i,
  /dirsearch/i,
  /nmap\s+scripting\s+engine/i,
  /nikto/i,
  /sqlmap/i,
  /masscan/i,
  /zgrab/i,
  /wfuzz/i,
  /acunetix/i,
  /nessus/i,
  /openvas/i,
];

const SENSITIVE_OR_ADMIN_TRAP_PATHS = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.aws/i,
  /^\/\.ssh/i,
  /^\/wp-admin/i,
  /^\/wp-login\.php/i,
  /^\/phpmyadmin/i,
  /^\/pma/i,
  /^\/admin(\/|$)/i,
  /^\/administrator/i,
  /^\/actuator/i,
  /^\/server-status/i,
  /^\/debug(\/|$)/i,
  /^\/_debug/i,
  /^\/swagger/i,
  /^\/api-docs/i,
  /^\/v2\/api-docs/i,
  /^\/graphql/i,
  /^\/graphiql/i,
  /^\/console(\/|$)/i,
  /^\/backup/i,
  /^\/dump\.sql/i,
  /^\/db\.sql/i,
  /^\/config\.json/i,
  /^\/api\/v1\/admin(\/|$)/i,
  /^\/api\/v1\/debug(\/|$)/i,
  /^\/api\/v1\/demo(\/|$)/i,
  /^\/api\/v1\/internal(\/|$)/i,
];

const DANGEROUS_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '$where',
  '$ne',
  '$gt',
  '$regex',
]);

const PATH_TRAVERSAL_OR_NULL_BYTE = /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\\|%00|\0)/i;

const SQLI_OR_TEMPLATE_FUZZ_PATTERNS =
  /(\bunion\s+select\b|\bwaitfor\s+delay\b|\bsleep\(\d+\)|\bpg_sleep\s*\(|\$\{jndi:|;\s*drop\s+table\b)/i;

const DEFAULT_RETENTION_WINDOW_MS = 15 * 60 * 1000; // 15 minutos de retenção máxima em memória
const KEY_AUTO_ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // Rotação diária automática da chave HMAC

export class ScannerDetectionEngine {
  private hmacSecretKey: Uint8Array = CryptoEngine.getRandomBytes(32);
  private hmacKeyEpoch = 1;
  private hmacKeyRotatedAtMs = Date.now();
  private retentionWindowMs = DEFAULT_RETENTION_WINDOW_MS;

  private ipWindows = new Map<string, IpTrafficWindow>();
  private compositeAuthBuckets = new Map<string, CompositeAuthFailureBucket>();
  private distributedAccountBuckets = new Map<
    string,
    DistributedAccountFailureBucket
  >();
  private inFlightByIp = new Map<string, number>();
  private inFlightByUser = new Map<string, number>();

  private totalRequestsObserved = 0;
  private blockedScannerRequests = 0;
  private blockedFuzzingRequests = 0;
  private blockedBruteForceAttempts = 0;
  private blockedCorsViolations = 0;
  private concurrencyRejections = 0;
  private notFoundEnumerationCount = 0;
  private distributedAttackAlerts = 0;
  private behavioralScannerDetections = 0;
  private zeroTrustRejections = 0;

  private countersByCategory: Record<SecurityAnomalyCategory, number> = {
    KNOWN_SCANNER_FINGERPRINT: 0,
    BEHAVIORAL_SCANNER_PATTERN: 0,
    ADMIN_OR_SENSITIVE_PATH_PROBE: 0,
    REPEATED_404_ENUMERATION: 0,
    HIGH_RPM_BURST: 0,
    FUZZING_OR_MALFORMED_INPUT: 0,
    BRUTE_FORCE_AUTH_FAILURE: 0,
    DISTRIBUTED_CREDENTIAL_STUFFING: 0,
    CORS_POLICY_VIOLATION: 0,
    CONCURRENCY_LIMIT_EXCEEDED: 0,
    UNAUTHORIZED_ENDPOINT_ACCESS: 0,
    ZERO_TRUST_ACCESS_VIOLATION: 0,
  };

  private recentAlerts: SecurityAlertEvent[] = [];

  /**
   * Fase 5C (§3): Pseudonimização resistente a força bruta de espaço IPv4 (2^32) via HMAC-SHA256
   * com chave secreta de 256 bits e política de rotação + zeroização criptográfica.
   * Nunca utiliza SHA-256 simples sem chave secreta para endereços IP.
   */
  public pseudonymizeIdentifierHmac(
    value: string,
    domain: 'ip' | 'account' | 'device' = 'ip'
  ): string {
    this.checkAutoKeyRotationAndRetention();
    const message = utf8ToBytes(
      `DONUTVAULT_HMAC_TELEMETRY_V2:epoch=${this.hmacKeyEpoch}:domain=${domain}:${value || 'unknown'}`
    );
    const macHex = bytesToHex(hmac(sha256, this.hmacSecretKey, message)).slice(
      0,
      24
    );
    return `ke${this.hmacKeyEpoch}_${macHex}`;
  }

  public hashIdentifier(value: string): string {
    return this.pseudonymizeIdentifierHmac(value, 'ip');
  }

  /**
   * Rotaciona a chave secreta HMAC-SHA256 de 256 bits, zeroizando a chave anterior em memória
   * para tornar pseudônimos de épocas passadas matematicamente irreversíveis.
   */
  public rotateTelemetryHmacKey(): {
    previousEpoch: number;
    newEpoch: number;
    rotatedAt: string;
  } {
    const previousEpoch = this.hmacKeyEpoch;
    CryptoEngine.zeroize(this.hmacSecretKey);
    this.hmacSecretKey = CryptoEngine.getRandomBytes(32);
    this.hmacKeyEpoch += 1;
    this.hmacKeyRotatedAtMs = Date.now();
    this.ipWindows.clear();
    return {
      previousEpoch,
      newEpoch: this.hmacKeyEpoch,
      rotatedAt: new Date(this.hmacKeyRotatedAtMs).toISOString(),
    };
  }

  public setRetentionWindowMsForTests(ms: number): void {
    this.retentionWindowMs = Math.max(100, ms);
    this.pruneExpiredTelemetry();
  }

  public pruneExpiredTelemetry(now = Date.now()): number {
    const cutoff = now - this.retentionWindowMs;
    const beforeLen = this.recentAlerts.length;
    this.recentAlerts = this.recentAlerts.filter(
      (ev) => ev.createdAtMs >= cutoff
    );
    return beforeLen - this.recentAlerts.length;
  }

  private checkAutoKeyRotationAndRetention(now = Date.now()): void {
    if (now - this.hmacKeyRotatedAtMs >= KEY_AUTO_ROTATION_INTERVAL_MS) {
      this.rotateTelemetryHmacKey();
    }
    this.pruneExpiredTelemetry(now);
  }

  public resetAllForTests(): void {
    this.ipWindows.clear();
    this.compositeAuthBuckets.clear();
    this.distributedAccountBuckets.clear();
    this.inFlightByIp.clear();
    this.inFlightByUser.clear();
    this.totalRequestsObserved = 0;
    this.blockedScannerRequests = 0;
    this.blockedFuzzingRequests = 0;
    this.blockedBruteForceAttempts = 0;
    this.blockedCorsViolations = 0;
    this.concurrencyRejections = 0;
    this.notFoundEnumerationCount = 0;
    this.distributedAttackAlerts = 0;
    this.behavioralScannerDetections = 0;
    this.zeroTrustRejections = 0;
    this.retentionWindowMs = DEFAULT_RETENTION_WINDOW_MS;
    for (const k of Object.keys(
      this.countersByCategory
    ) as SecurityAnomalyCategory[]) {
      this.countersByCategory[k] = 0;
    }
    this.recentAlerts = [];
  }

  private getOrCreateIpWindow(
    originHmac: string,
    now = Date.now()
  ): IpTrafficWindow {
    let win = this.ipWindows.get(originHmac);
    if (!win || now - win.windowStartMs >= 60_000) {
      win = {
        windowStartMs: now,
        requestCount: 0,
        notFoundCount: 0,
        distinct404Paths: new Set<string>(),
        distinctUnauthTargets: new Set<string>(),
        clientErrorCount: 0,
        adminProbeCount: 0,
        fuzzingCount: 0,
        scannerPenaltyUntilMs: win?.scannerPenaltyUntilMs || 0,
      };
      this.ipWindows.set(originHmac, win);
    }
    return win;
  }

  public recordAlert(params: {
    category: SecurityAnomalyCategory;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    clientIp: string;
    targetAccount?: string;
    method: string;
    path: string;
    statusCode: number;
    reason: string;
  }): SecurityAlertEvent {
    const now = Date.now();
    const originPseudonymHmac = this.pseudonymizeIdentifierHmac(
      params.clientIp,
      'ip'
    );
    const targetAccountPseudonymHmac = params.targetAccount
      ? this.pseudonymizeIdentifierHmac(params.targetAccount, 'account')
      : undefined;

    this.countersByCategory[params.category] =
      (this.countersByCategory[params.category] || 0) + 1;

    // Minimização de dados (§3): remove query strings e trunca segmentos dinâmicos longos
    const safePathTemplate = String(params.path || '/')
      .split('?')[0]
      .slice(0, 96);

    const event: SecurityAlertEvent = {
      alertId: `alrt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(now).toISOString(),
      createdAtMs: now,
      category: params.category,
      severity: params.severity,
      originPseudonymHmac,
      targetAccountPseudonymHmac,
      method: String(params.method || 'GET').toUpperCase().slice(0, 12),
      pathTemplate: safePathTemplate,
      statusCode: params.statusCode,
      reason: params.reason.slice(0, 220),
    };

    this.recentAlerts.unshift(event);
    if (this.recentAlerts.length > 50) {
      this.recentAlerts.pop();
    }
    return event;
  }

  public recordZeroTrustRejection(params: {
    clientIp: string;
    method: string;
    path: string;
    statusCode: number;
    reason: string;
  }): void {
    this.zeroTrustRejections += 1;
    this.recordAlert({
      category: 'ZERO_TRUST_ACCESS_VIOLATION',
      severity: 'HIGH',
      clientIp: params.clientIp,
      method: params.method,
      path: params.path,
      statusCode: params.statusCode,
      reason: params.reason,
    });
  }

  /**
   * 1. Inspeção Combinada: Assinaturas de Scanners + Detecção Comportamental Independente de User-Agent (§4).
   * - Se uma origem não autenticada já estiver sob penalidade comportamental (varredura de rotas/contas/fuzzing)
   *   mesmo usando User-Agent de navegador comum (Chrome/Safari), bloqueia com 429.
   * - Se a requisição pertencer a uma sessão autenticada legítima (`isAuthenticatedSession = true`),
   *   garante isenção de falso positivo de heurísticas de varredura não autenticada.
   */
  public inspectScannerHeaders(params: {
    clientIp: string;
    userAgent?: string;
    headers?: Record<string, string | string[] | undefined>;
    method: string;
    path: string;
    isAuthenticatedSession?: boolean;
  }): { blocked: boolean; statusCode?: number; reason?: string } {
    this.totalRequestsObserved += 1;
    const now = Date.now();
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const win = this.getOrCreateIpWindow(originHmac, now);
    win.requestCount += 1;

    // 1A. Penalidade comportamental ativa para origens não autenticadas (independente de User-Agent!)
    if (!params.isAuthenticatedSession && now < win.scannerPenaltyUntilMs) {
      this.blockedScannerRequests += 1;
      return {
        blocked: true,
        statusCode: 429,
        reason:
          'Bloqueio Comportamental de Varredura (429): Origem temporariamente contida por padrão anômalo de enumeração/fuzzing.',
      };
    }

    // 1B. Métodos HTTP anômalos / abuso de protocolo (PROPFIND, TRACE, TRACK, CONNECT, DELETE em rotas não-REST)
    const upperMethod = String(params.method || 'GET').toUpperCase();
    if (
      !['GET', 'POST', 'OPTIONS', 'HEAD'].includes(upperMethod) &&
      !params.isAuthenticatedSession
    ) {
      this.blockedScannerRequests += 1;
      this.behavioralScannerDetections += 1;
      win.clientErrorCount += 1;
      this.recordAlert({
        category: 'BEHAVIORAL_SCANNER_PATTERN',
        severity: 'MEDIUM',
        clientIp: params.clientIp,
        method: upperMethod,
        path: params.path,
        statusCode: 405,
        reason: `Método HTTP não permitido (${upperMethod}) usado em sondagem de superfície.`,
      });
      return {
        blocked: true,
        statusCode: 405,
        reason: `Método HTTP ${upperMethod} não permitido (405 Method Not Allowed).`,
      };
    }

    // 1C. Assinaturas conhecidas no User-Agent ou cabeçalhos de ferramentas de scanner (defesa complementar)
    const ua = String(params.userAgent || '');
    for (const regex of KNOWN_SCANNER_USER_AGENTS) {
      if (regex.test(ua)) {
        this.blockedScannerRequests += 1;
        win.scannerPenaltyUntilMs = now + 30_000;
        this.recordAlert({
          category: 'KNOWN_SCANNER_FINGERPRINT',
          severity: 'HIGH',
          clientIp: params.clientIp,
          method: params.method,
          path: params.path,
          statusCode: 403,
          reason: `Assinatura de scanner automatizado detectada (${regex.source}).`,
        });
        return {
          blocked: true,
          statusCode: 403,
          reason: 'Acesso automatizado de varredura bloqueado (403).',
        };
      }
    }

    const rawHeaders = params.headers || {};
    if (
      rawHeaders['x-nuclei-template'] ||
      rawHeaders['x-scanner'] ||
      rawHeaders['acunetix-product']
    ) {
      this.blockedScannerRequests += 1;
      this.recordAlert({
        category: 'KNOWN_SCANNER_FINGERPRINT',
        severity: 'HIGH',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 403,
        reason: 'Cabeçalho de ferramenta de varredura ativa detectado.',
      });
      return {
        blocked: true,
        statusCode: 403,
        reason: 'Acesso automatizado de varredura bloqueado (403).',
      };
    }

    // 1D. Alto RPM por origem (> 240 req/minuto)
    if (win.requestCount > 240) {
      this.blockedScannerRequests += 1;
      this.recordAlert({
        category: 'HIGH_RPM_BURST',
        severity: 'MEDIUM',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 429,
        reason: `Rajada anormal de tráfego por minuto (${win.requestCount} req/min).`,
      });
      return {
        blocked: true,
        statusCode: 429,
        reason: 'Limite de requisições por minuto excedido (429).',
      };
    }

    return { blocked: false };
  }

  /**
   * 2. Detecção Comportamental de Varredura Horizontal de Contas / Cofres (Account/Vault Sweeping)
   * Mesmo que o atacante utilize User-Agent legítimo do Chrome e faça apenas 1 requisição por conta,
   * sondar >= 6 contas/cofres distintos a partir da mesma origem não autenticada aciona contenção comportamental!
   */
  public inspectBehavioralTargetSweep(params: {
    clientIp: string;
    targetIdentifier: string;
    method: string;
    path: string;
    isAuthenticatedSession?: boolean;
  }): { blocked: boolean; retryAfterSeconds: number; reason?: string } {
    if (params.isAuthenticatedSession || !params.targetIdentifier) {
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const now = Date.now();
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const targetHmac = this.pseudonymizeIdentifierHmac(
      params.targetIdentifier,
      'account'
    );
    const win = this.getOrCreateIpWindow(originHmac, now);
    win.distinctUnauthTargets.add(targetHmac);

    if (win.distinctUnauthTargets.size >= 6) {
      this.behavioralScannerDetections += 1;
      this.blockedScannerRequests += 1;
      win.scannerPenaltyUntilMs = now + 15_000;
      this.recordAlert({
        category: 'BEHAVIORAL_SCANNER_PATTERN',
        severity: 'HIGH',
        clientIp: params.clientIp,
        targetAccount: params.targetIdentifier,
        method: params.method,
        path: params.path,
        statusCode: 429,
        reason: `Detecção comportamental (independente de User-Agent): sondagem horizontal de ${win.distinctUnauthTargets.size} contas/cofres distintos na mesma janela.`,
      });
      return {
        blocked: true,
        retryAfterSeconds: 15,
        reason:
          'Padrão comportamental de enumeração horizontal de contas/cofres bloqueado (429).',
      };
    }

    return { blocked: false, retryAfterSeconds: 0 };
  }

  /**
   * 3. Detecção de enumeração de endpoints administrativos, arquivos de configuração (.env, .git) e rotas de debug.
   */
  public isSensitiveOrAdminTrapPath(
    rawPath: string
  ): { trapped: boolean; matchedPattern?: string } {
    const cleanPath = String(rawPath || '/').split('?')[0];
    for (const pattern of SENSITIVE_OR_ADMIN_TRAP_PATHS) {
      if (pattern.test(cleanPath)) {
        return { trapped: true, matchedPattern: pattern.source };
      }
    }
    return { trapped: false };
  }

  public recordAdminOrSensitivePathProbe(params: {
    clientIp: string;
    method: string;
    path: string;
    matchedPattern: string;
  }): { shouldThrottle429: boolean } {
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const win = this.getOrCreateIpWindow(originHmac);
    win.adminProbeCount += 1;
    win.clientErrorCount += 1;
    this.blockedScannerRequests += 1;

    if (win.adminProbeCount >= 5) {
      this.behavioralScannerDetections += 1;
    }

    this.recordAlert({
      category: 'ADMIN_OR_SENSITIVE_PATH_PROBE',
      severity: win.adminProbeCount >= 3 ? 'CRITICAL' : 'HIGH',
      clientIp: params.clientIp,
      method: params.method,
      path: params.path,
      statusCode: win.adminProbeCount >= 5 ? 429 : 404,
      reason: `Tentativa de enumeração de endpoint sensível/administrativo (${params.matchedPattern}).`,
    });

    return { shouldThrottle429: win.adminProbeCount >= 5 };
  }

  /**
   * 4. Rastreamento Comportamental de Acessos Repetidos a Rotas Inexistentes (404 Directory Enumeration).
   * Detecta scanners mesmo quando falsificam User-Agent de navegador legítimo.
   */
  public recordNotFoundRoute(params: {
    clientIp: string;
    method: string;
    path: string;
  }): { isEnumerationBurst: boolean; notFoundCountInWindow: number } {
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const win = this.getOrCreateIpWindow(originHmac);
    const cleanPath = String(params.path || '/').split('?')[0].slice(0, 96);

    win.notFoundCount += 1;
    win.distinct404Paths.add(cleanPath);
    win.clientErrorCount += 1;
    this.notFoundEnumerationCount += 1;

    const isBurst =
      win.notFoundCount >= 6 || win.distinct404Paths.size >= 5;
    if (isBurst) {
      this.behavioralScannerDetections += 1;
      this.recordAlert({
        category: 'REPEATED_404_ENUMERATION',
        severity: 'HIGH',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 429,
        reason: `Detecção comportamental de varredura de rotas (${win.distinct404Paths.size} rotas distintas / ${win.notFoundCount} erros 404 na janela).`,
      });
    }

    return {
      isEnumerationBurst: isBurst,
      notFoundCountInWindow: win.notFoundCount,
    };
  }

  /**
   * 5. Inspeção profunda contra Fuzzing, Path Traversal, Null Bytes, Prototype Pollution e Injeções.
   */
  public inspectInputForFuzzing(params: {
    clientIp: string;
    method: string;
    path: string;
    query?: unknown;
    body?: unknown;
  }): { blocked: boolean; reason?: string } {
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const win = this.getOrCreateIpWindow(originHmac);

    if (PATH_TRAVERSAL_OR_NULL_BYTE.test(params.path)) {
      this.blockedFuzzingRequests += 1;
      win.fuzzingCount += 1;
      win.clientErrorCount += 1;
      if (win.fuzzingCount >= 3) {
        this.behavioralScannerDetections += 1;
      }
      this.recordAlert({
        category: 'FUZZING_OR_MALFORMED_INPUT',
        severity: 'HIGH',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 400,
        reason: 'Padrão de Path Traversal ou Null Byte detectado na URL.',
      });
      return {
        blocked: true,
        reason: 'Requisição malformada rejeitada pela validação de entrada (400).',
      };
    }

    const queryViolation = this.scanValueForAnomalies(params.query, 0, true);
    if (queryViolation) {
      this.blockedFuzzingRequests += 1;
      win.fuzzingCount += 1;
      win.clientErrorCount += 1;
      if (win.fuzzingCount >= 3) {
        this.behavioralScannerDetections += 1;
      }
      this.recordAlert({
        category: 'FUZZING_OR_MALFORMED_INPUT',
        severity: 'HIGH',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 400,
        reason: `Anomalia de fuzzing em query string: ${queryViolation}`,
      });
      return {
        blocked: true,
        reason: 'Parâmetros de consulta inválidos ou malformados (400).',
      };
    }

    const bodyViolation = this.scanValueForAnomalies(params.body, 0, false);
    if (bodyViolation) {
      this.blockedFuzzingRequests += 1;
      win.fuzzingCount += 1;
      win.clientErrorCount += 1;
      if (win.fuzzingCount >= 3) {
        this.behavioralScannerDetections += 1;
      }
      this.recordAlert({
        category: 'FUZZING_OR_MALFORMED_INPUT',
        severity: 'HIGH',
        clientIp: params.clientIp,
        method: params.method,
        path: params.path,
        statusCode: 400,
        reason: `Anomalia de fuzzing no payload: ${bodyViolation}`,
      });
      return {
        blocked: true,
        reason: 'Estrutura de payload inválida ou malformada (400).',
      };
    }

    return { blocked: false };
  }

  private scanValueForAnomalies(
    value: unknown,
    depth: number,
    checkSqlPatternsInStrings: boolean
  ): string | null {
    if (depth > 7) {
      return 'Profundidade máxima de objeto JSON excedida ( > 7 níveis )';
    }
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      if (value.includes('\0') || value.includes('%00')) {
        return 'Caractere nulo (Null Byte) detectado';
      }
      if (value.length > 262_144) {
        return 'Campo de texto excede o tamanho máximo permitido (256 KB)';
      }
      if (
        checkSqlPatternsInStrings &&
        (PATH_TRAVERSAL_OR_NULL_BYTE.test(value) ||
          SQLI_OR_TEMPLATE_FUZZ_PATTERNS.test(value))
      ) {
        return 'Vetor de injeção ou traversal detectado em parâmetro de URL';
      }
      return null;
    }
    if (Array.isArray(value)) {
      if (value.length > 500) {
        return 'Array excede o limite máximo de 500 elementos por lote';
      }
      for (const item of value) {
        const res = this.scanValueForAnomalies(
          item,
          depth + 1,
          checkSqlPatternsInStrings
        );
        if (res) return res;
      }
      return null;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 100) {
        return 'Objeto JSON excede o limite máximo de 100 chaves';
      }
      for (const [rawKey, propVal] of entries) {
        if (DANGEROUS_OBJECT_KEYS.has(rawKey)) {
          return `Chave proibida de Prototype Pollution / NoSQLi ("${rawKey}")`;
        }
        if (rawKey.includes('\0') || rawKey.length > 128) {
          return 'Nome de propriedade JSON inválido';
        }
        const isIdentifierField =
          rawKey === 'userUid' ||
          rawKey === 'vaultId' ||
          rawKey === 'recordId' ||
          rawKey === 'deviceId' ||
          rawKey === 'challengeId';
        if (isIdentifierField && typeof propVal === 'string') {
          if (
            propVal.length > 160 ||
            PATH_TRAVERSAL_OR_NULL_BYTE.test(propVal) ||
            SQLI_OR_TEMPLATE_FUZZ_PATTERNS.test(propVal) ||
            /[<>'"`;]/.test(propVal)
          ) {
            return `Identificador "${rawKey}" contém caracteres inválidos ou vetor de fuzzing`;
          }
        }
        const nested = this.scanValueForAnomalies(
          propVal,
          depth + 1,
          checkSqlPatternsInStrings
        );
        if (nested) return nested;
      }
    }
    return null;
  }

  /**
   * 6. Proteção contra Força Bruta com Backoff Progressivo Exponencial e Isolamento por Par (Conta + IP).
   */
  public checkBruteForceAllowance(params: {
    clientIp: string;
    targetAccount?: string;
    scope: string;
  }): BruteForceCheckResult {
    const now = Date.now();
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const accountHmac = params.targetAccount
      ? this.pseudonymizeIdentifierHmac(params.targetAccount, 'account')
      : 'anon';
    const compositeKey = `${params.scope}:${accountHmac}:${originHmac}`;
    const ipScopeKey = `${params.scope}:ip:${originHmac}`;

    const compositeBucket = this.compositeAuthBuckets.get(compositeKey);
    if (compositeBucket && now < compositeBucket.lockoutUntilMs) {
      this.blockedBruteForceAttempts += 1;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((compositeBucket.lockoutUntilMs - now) / 1000)
      );
      return {
        allowed: false,
        retryAfterSeconds,
        backoffLevel: compositeBucket.failures,
        distributedAlertTriggered: false,
        reason: `Backoff progressivo ativo para esta origem e conta. Aguarde ${retryAfterSeconds}s (429).`,
      };
    }

    const ipBucket = this.compositeAuthBuckets.get(ipScopeKey);
    if (ipBucket && now < ipBucket.lockoutUntilMs) {
      this.blockedBruteForceAttempts += 1;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((ipBucket.lockoutUntilMs - now) / 1000)
      );
      return {
        allowed: false,
        retryAfterSeconds,
        backoffLevel: ipBucket.failures,
        distributedAlertTriggered: false,
        reason: `Origem temporariamente limitada por excesso de falhas de autenticação. Aguarde ${retryAfterSeconds}s (429).`,
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      backoffLevel: compositeBucket?.failures || 0,
      distributedAlertTriggered: false,
    };
  }

  public recordAuthFailure(params: {
    clientIp: string;
    targetAccount?: string;
    scope: string;
    method: string;
    path: string;
    statusCode: number;
    failureThreshold?: number;
  }): BruteForceCheckResult {
    const now = Date.now();
    const threshold = params.failureThreshold ?? 5;
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const accountHmac = params.targetAccount
      ? this.pseudonymizeIdentifierHmac(params.targetAccount, 'account')
      : 'anon';
    const compositeKey = `${params.scope}:${accountHmac}:${originHmac}`;
    const ipScopeKey = `${params.scope}:ip:${originHmac}`;

    const comp = this.updateFailureBucket(compositeKey, now, threshold, 60_000);
    this.updateFailureBucket(ipScopeKey, now, threshold + 3, 60_000);

    let distributedAlertTriggered = false;
    if (params.targetAccount) {
      let dist = this.distributedAccountBuckets.get(accountHmac);
      if (!dist || now - dist.windowStartMs > 120_000) {
        dist = {
          distinctOriginHmacs: new Set<string>(),
          totalFailures: 0,
          windowStartMs: now,
          stepUpCooldownUntilMs: 0,
        };
        this.distributedAccountBuckets.set(accountHmac, dist);
      }
      dist.distinctOriginHmacs.add(originHmac);
      dist.totalFailures += 1;

      if (dist.distinctOriginHmacs.size >= 4 && dist.totalFailures >= 8) {
        distributedAlertTriggered = true;
        this.distributedAttackAlerts += 1;
        dist.stepUpCooldownUntilMs = now + 15_000;
        this.recordAlert({
          category: 'DISTRIBUTED_CREDENTIAL_STUFFING',
          severity: 'CRITICAL',
          clientIp: params.clientIp,
          targetAccount: params.targetAccount,
          method: params.method,
          path: params.path,
          statusCode: params.statusCode,
          reason: `Ataque distribuído detectado contra a conta a partir de ${dist.distinctOriginHmacs.size} origens distintas (${dist.totalFailures} falhas). Conta legítima preservada sem bloqueio permanente.`,
        });
      }
    }

    if (comp.failures >= threshold) {
      this.recordAlert({
        category: 'BRUTE_FORCE_AUTH_FAILURE',
        severity: comp.failures >= threshold + 3 ? 'HIGH' : 'MEDIUM',
        clientIp: params.clientIp,
        targetAccount: params.targetAccount,
        method: params.method,
        path: params.path,
        statusCode: 429,
        reason: `Múltiplas falhas de autenticação (${comp.failures} tentativas). Backoff progressivo ativado por ${Math.ceil((comp.lockoutUntilMs - now) / 1000)}s para esta origem.`,
      });
    }

    return {
      allowed: now >= comp.lockoutUntilMs,
      retryAfterSeconds: Math.max(
        0,
        Math.ceil((comp.lockoutUntilMs - now) / 1000)
      ),
      backoffLevel: comp.failures,
      distributedAlertTriggered,
    };
  }

  public recordAuthSuccess(params: {
    clientIp: string;
    targetAccount?: string;
    scope: string;
  }): void {
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const accountHmac = params.targetAccount
      ? this.pseudonymizeIdentifierHmac(params.targetAccount, 'account')
      : 'anon';
    this.compositeAuthBuckets.delete(
      `${params.scope}:${accountHmac}:${originHmac}`
    );
  }

  private updateFailureBucket(
    key: string,
    now: number,
    threshold: number,
    maxLockoutMs: number
  ): CompositeAuthFailureBucket {
    let bucket = this.compositeAuthBuckets.get(key);
    if (!bucket || now - bucket.lastFailureMs > 120_000) {
      bucket = {
        failures: 0,
        firstFailureMs: now,
        lastFailureMs: now,
        lockoutUntilMs: 0,
      };
      this.compositeAuthBuckets.set(key, bucket);
    }
    bucket.failures += 1;
    bucket.lastFailureMs = now;

    if (bucket.failures >= threshold) {
      const exponent = Math.min(6, bucket.failures - threshold);
      const backoffMs = Math.min(maxLockoutMs, 1000 * Math.pow(2, exponent));
      bucket.lockoutUntilMs = now + backoffMs;
    }

    return bucket;
  }

  /**
   * 7. Controle de Concorrência Simultânea por Origem e por Usuário Autenticado.
   */
  public acquireConcurrencySlot(params: {
    clientIp: string;
    userUid?: string;
    maxPerIp?: number;
    maxPerUser?: number;
  }): { acquired: boolean; release: () => void } {
    const originHmac = this.pseudonymizeIdentifierHmac(params.clientIp, 'ip');
    const maxIp = params.maxPerIp ?? 35;
    const maxUser = params.maxPerUser ?? 40;

    const currentIp = this.inFlightByIp.get(originHmac) || 0;
    if (currentIp >= maxIp) {
      this.concurrencyRejections += 1;
      return { acquired: false, release: () => {} };
    }

    const userKey = params.userUid
      ? this.pseudonymizeIdentifierHmac(params.userUid, 'account')
      : null;
    if (userKey) {
      const currentUser = this.inFlightByUser.get(userKey) || 0;
      if (currentUser >= maxUser) {
        this.concurrencyRejections += 1;
        return { acquired: false, release: () => {} };
      }
      this.inFlightByUser.set(userKey, currentUser + 1);
    }

    this.inFlightByIp.set(originHmac, currentIp + 1);

    let released = false;
    return {
      acquired: true,
      release: () => {
        if (released) return;
        released = true;
        const nextIp = (this.inFlightByIp.get(originHmac) || 1) - 1;
        if (nextIp <= 0) this.inFlightByIp.delete(originHmac);
        else this.inFlightByIp.set(originHmac, nextIp);

        if (userKey) {
          const nextUser = (this.inFlightByUser.get(userKey) || 1) - 1;
          if (nextUser <= 0) this.inFlightByUser.delete(userKey);
          else this.inFlightByUser.set(userKey, nextUser);
        }
      },
    };
  }

  public recordCorsViolation(params: {
    clientIp: string;
    origin: string;
    method: string;
    path: string;
  }): void {
    this.blockedCorsViolations += 1;
    this.recordAlert({
      category: 'CORS_POLICY_VIOLATION',
      severity: 'MEDIUM',
      clientIp: params.clientIp,
      method: params.method,
      path: params.path,
      statusCode: 403,
      reason: `Origem CORS não autorizada bloqueada: "${params.origin.slice(0, 80)}".`,
    });
  }

  public getTelemetrySnapshot(): SecurityTelemetrySnapshot {
    this.checkAutoKeyRotationAndRetention();
    return {
      totalRequestsObserved: this.totalRequestsObserved,
      blockedScannerRequests: this.blockedScannerRequests,
      blockedFuzzingRequests: this.blockedFuzzingRequests,
      blockedBruteForceAttempts: this.blockedBruteForceAttempts,
      blockedCorsViolations: this.blockedCorsViolations,
      concurrencyRejections: this.concurrencyRejections,
      notFoundEnumerationCount: this.notFoundEnumerationCount,
      distributedAttackAlerts: this.distributedAttackAlerts,
      behavioralScannerDetections: this.behavioralScannerDetections,
      zeroTrustRejections: this.zeroTrustRejections,
      pseudonymizationPolicy: {
        algorithm: 'HMAC-SHA256',
        keyBitLength: 256,
        activeKeyEpoch: this.hmacKeyEpoch,
        keyRotatedAt: new Date(this.hmacKeyRotatedAtMs).toISOString(),
        retentionWindowMinutes: Math.round(this.retentionWindowMs / 60_000),
        plainSha256IpUsed: false,
      },
      countersByCategory: { ...this.countersByCategory },
      recentAlerts: this.recentAlerts
        .slice(0, 25)
        .map(({ createdAtMs: _c, ...rest }) => rest),
      passiveReconNote:
        'Ferramentas de reconhecimento passivo (ex.: Subfinder / Amass consultando Certificate Transparency ou DNS público) não geram pacotes HTTP no servidor de origem e são mitigadas por redução da superfície pós-descoberta, Cloudflare Tunnel privado e monitoramento de CT logs.',
    };
  }
}

export const scannerDetector = new ScannerDetectionEngine();
