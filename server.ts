import { config } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionToken, readSession, setSessionCookie } from './auth.ts';
import { openDatabase } from './server/db.ts';
import { seedDemoData } from './server/seed.ts';
import { createStore, PUBLIC_OPS, StoreError, type Actor } from './server/store.ts';
import { createUsers, toActor, toPublic, type UserRow } from './server/users.ts';

const app = express();
config({ path: ['.env.local', '.env'], quiet: true });
const port = Number(process.env.PORT || 3000);
const production = process.argv.includes('--production');
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Render (e outros PaaS) ficam atrás de um proxy; sem isso req.ip seria sempre o IP do proxy.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');

// Base compartilhada da equipe.
const db = await openDatabase(rootDir);
const store = createStore(db);
const users = createUsers(db);

if (db.kind === 'pglite') {
  if (production) console.warn('Aviso: DATABASE_URL não definido; usando banco local temporário. Configure o Neon no Render.');
  if (await store.isEmpty()) await seedDemoData(db);
}
const bootstrapped = await users.bootstrapFromEnv();
if (bootstrapped > 0) console.log(`Usuários iniciais criados: ${bootstrapped}.`);
if ((await users.count()) === 0) {
  console.warn('Aviso: nenhum usuário cadastrado. Defina APP_USERS ou ADMIN_INITIAL_PASSWORD para criar o primeiro administrador.');
}

const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('Aviso: SESSION_SECRET não definido; as sessões expiram a cada reinício do servidor.');
}

// Health check usado pelo Render; fica fora da autenticação.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Limite simples por IP em janela fixa, para proteger a cota das APIs de CTI e o login.
function rateLimit(name: string, maxPerWindow: number, windowMs = 60_000): RequestHandler {
  const hits = new Map<string, { windowStart: number; count: number }>();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.windowStart < cutoff) hits.delete(key);
  }, 60_000).unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(key, { windowStart: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count <= maxPerWindow) return next();
    const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Muitas tentativas (${name}). Tente novamente em ${retryAfter}s.` });
  };
}

const ctiLimit = rateLimit('CTI', Number(process.env.CTI_RATE_LIMIT_PER_MIN || 30));
const abuseSummaryLimit = rateLimit('AbuseIPDB', Number(process.env.ABUSE_SUMMARY_RATE_LIMIT_PER_MIN || 120));
const loginLimit = rateLimit('login', 20, 15 * 60_000);
const passwordLimit = rateLimit('senha', 10, 15 * 60_000);

// Sessão válida = cookie assinado + usuário ativo na mesma versão de sessão.
async function currentUser(req: express.Request): Promise<UserRow | null> {
  const session = readSession(sessionSecret, req);
  if (!session) return null;
  const row = await users.byId(session.userId);
  return row && row.active && row.session_version === session.version ? row : null;
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof StoreError) return res.status(error.status).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
}

const jsonSmall = express.json({ limit: '8kb' });

app.get('/api/auth/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const row = await currentUser(req);
  return res.json({ authEnabled: true, user: row ? toPublic(row) : null });
});

app.post('/api/auth/login', loginLimit, jsonSmall, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password || username.length > 64 || password.length > 256) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }
  try {
    const row = await users.authenticate(username, password);
    if (!row) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    setSessionCookie(req, res, createSessionToken(sessionSecret, row.id, row.session_version));
    return res.json({ user: toPublic(row) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  setSessionCookie(req, res, null);
  return res.json({ ok: true });
});

app.post('/api/auth/change-password', passwordLimit, jsonSmall, async (req, res) => {
  const row = await currentUser(req);
  if (!row) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  try {
    const updated = await users.changeOwnPassword(row.id, req.body?.currentPassword, req.body?.newPassword);
    setSessionCookie(req, res, createSessionToken(sessionSecret, updated.id, updated.session_version));
    return res.json({ user: toPublic(updated) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Demais rotas de API exigem sessão válida e senha definitiva.
app.use('/api', async (req, res, next) => {
  const row = await currentUser(req).catch(() => null);
  if (!row) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  if (row.must_change_password) return res.status(403).json({ error: 'Troque sua senha para continuar.' });
  res.locals.actor = toActor(row) satisfies Actor;
  res.locals.userId = row.id;
  return next();
});

// Dados da equipe: cada operação do app vira POST /api/data/<operação> com { args: [...] }.
const publicOps = new Set<string>(PUBLIC_OPS);
app.post('/api/data/:op', express.json({ limit: '30mb' }), async (req, res) => {
  const op = req.params.op;
  if (!publicOps.has(op)) return res.status(404).json({ error: 'Operação desconhecida.' });
  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  try {
    const fn = store[op as keyof typeof store] as (actor: Actor, ...rest: unknown[]) => Promise<unknown>;
    const result = await fn(res.locals.actor as Actor, ...args);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ result: result ?? null });
  } catch (error) {
    return sendError(res, error);
  }
});

// Gestão de usuários (somente administradores).
const adminOnly: RequestHandler = (_req, res, next) =>
  (res.locals.actor as Actor).role === 'admin' ? next() : res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });

app.get('/api/users', adminOnly, async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ users: await users.list() });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/users', adminOnly, jsonSmall, async (req, res) => {
  try {
    return res.status(201).json({ user: await users.create(res.locals.actor as Actor, req.body ?? {}) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.patch('/api/users/:id', adminOnly, jsonSmall, async (req, res) => {
  try {
    return res.json({ user: await users.update(res.locals.actor as Actor, Number(req.params.id), req.body ?? {}) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/users/:id/reset-password', adminOnly, passwordLimit, jsonSmall, async (req, res) => {
  try {
    await users.resetPassword(res.locals.actor as Actor, Number(req.params.id), req.body?.password);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

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
  // index.html recebe a origem pública para que og:image tenha URL absoluta (exigida pelas prévias de link).
  const indexHtml = readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
  const configuredOrigin = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const originFor = (req: express.Request): string => {
    if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configuredOrigin)) return configuredOrigin;
    const hostHeader = req.get('host') || '';
    return /^[a-z0-9.-]+(:\d+)?$/i.test(hostHeader) ? `${req.protocol}://${hostHeader}` : '';
  };
  const sendIndex: RequestHandler = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml.replaceAll('__APP_ORIGIN__', originFor(req)));
  };

  app.use(express.static(path.join(rootDir, 'dist'), { index: false }));
  app.get('*', sendIndex);
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: rootDir, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`GuardList disponível em http://${host}:${port}`);
});
