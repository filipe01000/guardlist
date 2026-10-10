import { config } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
config({ path: ['.env.local', '.env'], quiet: true });
const port = Number(process.env.PORT || 3000);
const production = process.argv.includes('--production');
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Render (e outros PaaS) ficam atrás de um proxy; sem isso req.ip seria sempre o IP do proxy.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');

// Health check usado pelo Render; fica fora da autenticação.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Autenticação básica opcional: ativa somente quando APP_USERNAME e APP_PASSWORD estão definidos.
const authUser = process.env.APP_USERNAME;
const authPassword = process.env.APP_PASSWORD;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

if (authUser && authPassword) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (separator >= 0 && safeEqual(user, authUser) && safeEqual(password, authPassword)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="GuardList", charset="UTF-8"');
    return res.status(401).send('Autenticação necessária.');
  });
} else if (production) {
  console.warn('Aviso: APP_USERNAME/APP_PASSWORD não definidos; o GuardList está público.');
}

// Limite simples por IP em janela fixa de 1 minuto, para proteger a cota das APIs de CTI.
function rateLimit(name: string, maxPerMinute: number): RequestHandler {
  const hits = new Map<string, { windowStart: number; count: number }>();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [key, entry] of hits) if (entry.windowStart < cutoff) hits.delete(key);
  }, 60_000).unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= 60_000) {
      hits.set(key, { windowStart: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count <= maxPerMinute) return next();
    const retryAfter = Math.ceil((entry.windowStart + 60_000 - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Muitas consultas (${name}). Tente novamente em ${retryAfter}s.` });
  };
}

const ctiLimit = rateLimit('CTI', Number(process.env.CTI_RATE_LIMIT_PER_MIN || 30));
const abuseSummaryLimit = rateLimit('AbuseIPDB', Number(process.env.ABUSE_SUMMARY_RATE_LIMIT_PER_MIN || 120));

type SourceResult = {
  status: 'ok' | 'not_configured' | 'not_found' | 'rate_limited' | 'error';
  data?: unknown;
  message?: string;
};

type AbuseListSummary = {
  indicator: string;
  fetchedAt: string;
  status: SourceResult['status'];
  data?: {
    domain: string | null;
    hostnames: string[];
    totalReports: number;
    lastReportedAt: string | null;
    abuseConfidenceScore: number;
  };
  message?: string;
};

const abuseListCache = new Map<string, { expiresAt: number; value: AbuseListSummary }>();
const ABUSE_LIST_CACHE_MS = 15 * 60 * 1000;

async function getJson(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function providerRequest(
  apiKey: string | undefined,
  request: () => Promise<Response>
): Promise<SourceResult> {
  if (!apiKey) return { status: 'not_configured', message: 'Chave não configurada no servidor.' };
  try {
    const response = await request();
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { status: 'ok', data: body };
    if (response.status === 404) return { status: 'not_found', data: body };
    if (response.status === 429) return { status: 'rate_limited', data: body, message: 'Limite de consultas atingido.' };
    const providerMessage = body?.errors?.[0]?.detail || body?.message || `HTTP ${response.status}`;
    return { status: 'error', message: String(providerMessage) };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Tempo limite de 10 segundos excedido.'
      : 'Não foi possível consultar o provedor.';
    return { status: 'error', message };
  }
}

app.get('/api/cti/:indicator', ctiLimit, async (req, res) => {
  const indicator = String(req.params.indicator || '').trim();
  if (!isIP(indicator)) {
    return res.status(400).json({ error: 'A consulta CTI externa aceita apenas endereços IPv4 ou IPv6 individuais.' });
  }

  const encoded = encodeURIComponent(indicator);
  const abuseKey = process.env.ABUSEIPDB_API_KEY;
  const greyNoiseKey = process.env.GREYNOISE_API_KEY;
  const otxKey = process.env.OTX_API_KEY;
  const otxType = isIP(indicator) === 6 ? 'IPv6' : 'IPv4';

  const [abuseIpDb, greyNoise, alienVaultOtx] = await Promise.all([
    providerRequest(abuseKey, () => getJson(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encoded}&maxAgeInDays=90&verbose=true`,
      { Accept: 'application/json', Key: abuseKey! }
    )),
    providerRequest(greyNoiseKey, () => getJson(
      `https://api.greynoise.io/v3/community/${encoded}`,
      { Accept: 'application/json', key: greyNoiseKey! }
    )),
    providerRequest(otxKey, () => getJson(
      `https://otx.alienvault.com/api/v1/indicators/${otxType}/${encoded}/general`,
      { Accept: 'application/json', 'X-OTX-API-KEY': otxKey! }
    ))
  ]);

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ indicator, fetchedAt: new Date().toISOString(), sources: { abuseIpDb, greyNoise, alienVaultOtx } });
});

app.get('/api/abuse-summary/:indicator', abuseSummaryLimit, async (req, res) => {
  const indicator = String(req.params.indicator || '').trim();
  if (!isIP(indicator)) {
    return res.status(400).json({ error: 'O resumo AbuseIPDB aceita apenas endereços IPv4 ou IPv6 individuais.' });
  }

  const forceRefresh = req.query.refresh === '1';
  const cached = abuseListCache.get(indicator);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'private, max-age=900');
    return res.json({ ...cached.value, cached: true });
  }

  const abuseKey = process.env.ABUSEIPDB_API_KEY;
  const encoded = encodeURIComponent(indicator);
  const result = await providerRequest(abuseKey, () => getJson(
    `https://api.abuseipdb.com/api/v2/check?ipAddress=${encoded}&maxAgeInDays=90`,
    { Accept: 'application/json', Key: abuseKey! }
  ));

  const providerData = result.data && typeof result.data === 'object'
    ? (result.data as { data?: Record<string, unknown> }).data
    : undefined;
  const value: AbuseListSummary = {
    indicator,
    fetchedAt: new Date().toISOString(),
    status: result.status,
    message: result.message,
    data: result.status === 'ok' && providerData ? {
      domain: typeof providerData.domain === 'string' && providerData.domain ? providerData.domain : null,
      hostnames: Array.isArray(providerData.hostnames)
        ? providerData.hostnames.filter((hostname): hostname is string => typeof hostname === 'string' && Boolean(hostname)).slice(0, 5)
        : [],
      totalReports: Number(providerData.totalReports || 0),
      lastReportedAt: typeof providerData.lastReportedAt === 'string' ? providerData.lastReportedAt : null,
      abuseConfidenceScore: Number(providerData.abuseConfidenceScore || 0)
    } : undefined
  };

  if (value.status === 'ok') {
    abuseListCache.set(indicator, { expiresAt: Date.now() + ABUSE_LIST_CACHE_MS, value });
  }
  res.setHeader('Cache-Control', 'private, max-age=900');
  return res.json(value);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota de API não encontrada.' }));

if (production) {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: rootDir, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`GuardList disponível em http://${host}:${port}`);
});
