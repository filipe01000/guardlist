import { config } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionToken, readSession, setSessionCookie } from './auth.ts';
import { aiConfigured, aiSettings, createAi, type AiEvent } from './server/ai.ts';
import { fetchLogoFromSite, LogoError } from './server/logo.ts';
import { createCti, ctiConfigured } from './server/cti.ts';
import { classifyIndicator, normalizeIndicator } from './src/utils/validator.ts';
import { openDatabase } from './server/db.ts';
import { createJobs } from './server/jobs.ts';
import { recipients, sendMail, smtpConfigured } from './server/mailer.ts';
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
const cti = createCti(db);
const startedAt = Date.now();

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

// Cabeçalhos de segurança: o app não pode ser aberto dentro de outro site e só carrega recursos do próprio domínio.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (production) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self'",
        "connect-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; ')
    );
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

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

// Sessão válida = cookie assinado + sessão aberta no banco + usuário ativo na mesma versão de sessão.
async function currentUser(req: express.Request): Promise<(UserRow & { session_id: string }) | null> {
  const session = readSession(sessionSecret, req);
  if (!session) return null;
  return users.bySession(session.sid);
}

async function startSession(req: express.Request, res: express.Response, row: UserRow) {
  const sid = await users.createSession(row, req.ip || null, req.get('user-agent') || null);
  setSessionCookie(req, res, createSessionToken(sessionSecret, sid));
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof StoreError) return res.status(error.status).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
}

const jsonSmall = express.json({ limit: '8kb' });

app.get('/api/auth/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const row = await currentUser(req).catch(() => null);
  return res.json({ authEnabled: true, user: row ? toPublic(row) : null });
});

app.post('/api/auth/login', loginLimit, jsonSmall, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password || username.length > 64 || password.length > 256) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }
  try {
    const result = await users.authenticate(username, password);
    if (result && 'lockedUntil' in result) {
      const minutes = Math.max(1, Math.ceil((new Date(result.lockedUntil).getTime() - Date.now()) / 60_000));
      return res.status(423).json({ error: `Conta bloqueada por excesso de tentativas. Tente de novo em ${minutes} min ou peça a um administrador para liberar.` });
    }
    if (!result) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    await startSession(req, res, result.row);
    return res.json({ user: toPublic(result.row) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Sair invalida a sessão no servidor: um cookie copiado antes deixa de valer.
app.post('/api/auth/logout', async (req, res) => {
  const row = await currentUser(req).catch(() => null);
  if (row) await users.revokeSessionById(row.session_id).catch((error: unknown) => console.error(error));
  setSessionCookie(req, res, null);
  return res.json({ ok: true });
});

app.post('/api/auth/change-password', passwordLimit, jsonSmall, async (req, res) => {
  const row = await currentUser(req).catch(() => null);
  if (!row) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  try {
    const updated = await users.changeOwnPassword(row.id, req.body?.currentPassword, req.body?.newPassword);
    await startSession(req, res, updated);
    return res.json({ user: toPublic(updated) });
  } catch (error) {
    return sendError(res, error);
  }
});

// Demais rotas de API exigem sessão válida e senha definitiva.
app.use('/api', async (req, res, next) => {
  const row = await currentUser(req).catch(() => null);
  if (!row) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  if (row.must_change_password) return res.status(403).json({ error: 'Troque sua senha para continuar.', code: 'PASSWORD_CHANGE_REQUIRED' });
  res.locals.actor = toActor(row) satisfies Actor;
  res.locals.userId = row.id;
  res.locals.sessionId = row.session_id;
  return next();
});

// Sessões abertas: cada pessoa vê e encerra as suas; administradores, as de qualquer usuário.
app.get('/api/sessions', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ sessions: await users.listSessions(res.locals.userId, res.locals.sessionId) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await users.revokeSession(res.locals.actor as Actor, res.locals.userId, req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
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

app.delete('/api/users/:id', adminOnly, async (req, res) => {
  try {
    await users.remove(res.locals.actor as Actor, Number(req.params.id));
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

app.get('/api/users/:id/sessions', adminOnly, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ sessions: await users.listSessions(Number(req.params.id), res.locals.sessionId) });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/users/:id/sessions/revoke-all', adminOnly, async (req, res) => {
  try {
    await users.revokeAllSessions(res.locals.actor as Actor, Number(req.params.id));
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/users/:id/reset-password', adminOnly, passwordLimit, jsonSmall, async (req, res) => {
  try {
    await users.resetPassword(res.locals.actor as Actor, Number(req.params.id), req.body?.password, req.body?.mustChangePassword);
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

// Reputação de vários IPs de uma vez (triagem da importação e gráficos). Até 100 consultas novas por chamada;
// o restante vem do cache ou fica para a próxima chamada.
const enrichLimit = rateLimit('reputação', Number(process.env.CTI_ENRICH_RATE_LIMIT_PER_MIN || 20));
app.post('/api/cti/enrich', enrichLimit, express.json({ limit: '512kb' }), async (req, res) => {
  const indicators = Array.isArray(req.body?.indicators) ? req.body.indicators.filter((x: unknown) => typeof x === 'string').slice(0, 5000) : [];
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await cti.enrich(indicators, { force: req.body?.force === true }));
  } catch (error) {
    return sendError(res, error);
  }
});

// ---------- Assistente de IA (opcional: só com AI_BASE_URL e AI_MODEL) ----------
const ai = createAi({ db, store, cti });
const aiLimit = rateLimit('assistente de IA', Number(process.env.AI_RATE_LIMIT_PER_MIN || 12));

app.get('/api/ai/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ configured: aiConfigured(), model: aiConfigured() ? aiSettings().model : null });
});

function aiErrorMessage(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string } };
  if (err?.name === 'TimeoutError') return 'A IA demorou demais para responder. Tente uma pergunta mais curta ou tente de novo.';
  if (err?.name === 'AbortError') return 'Resposta interrompida.';
  if (err?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err?.message ?? '')) {
    return `Não foi possível falar com o servidor de IA (${aiSettings().baseUrl}). Verifique se ele está ligado.`;
  }
  return err?.message || 'Falha no assistente de IA.';
}

// Resposta em partes (uma linha JSON por evento): o texto aparece enquanto a IA escreve.
function streamAi(res: express.Response, run: (emit: (e: AiEvent) => void, signal: AbortSignal) => Promise<void>) {
  if (!aiConfigured()) return res.status(404).json({ error: 'Assistente de IA não configurado neste servidor.' });
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const stop = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) stop.abort();
  });
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(aiSettings().timeoutMs)]);
  const emit = (event: AiEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  run(emit, signal)
    .catch((error) => {
      if (!stop.signal.aborted) emit({ type: 'error', error: aiErrorMessage(error) });
    })
    .finally(() => res.end());
}

app.post('/api/ai/chat', aiLimit, express.json({ limit: '256kb' }), (req, res) => {
  const raw: unknown[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m): m is { role: 'user' | 'assistant'; content: string } => {
      const msg = m as { role?: unknown; content?: unknown };
      return (msg?.role === 'user' || msg?.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim() !== '';
    })
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages.at(-1)!.role !== 'user') return res.status(400).json({ error: 'Envie uma pergunta.' });
  return streamAi(res, (emit, signal) => ai.chat(res.locals.actor as Actor, messages, emit, signal));
});

app.post('/api/ai/indicator', aiLimit, jsonSmall, (req, res) => {
  const indicator = normalizeIndicator(String(req.body?.indicator ?? ''));
  if (!indicator || !classifyIndicator(indicator).isValid) return res.status(400).json({ error: 'Informe um IP, CIDR ou domínio válido.' });
  return streamAi(res, (emit, signal) => ai.analyzeIndicator(res.locals.actor as Actor, indicator, emit, signal));
});

app.post('/api/ai/case-reason', aiLimit, express.json({ limit: '256kb' }), (req, res) => {
  const pick = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 2000) : []);
  const input = { ips: pick(req.body?.ips), cidrs: pick(req.body?.cidrs), domains: pick(req.body?.domains), note: typeof req.body?.note === 'string' ? req.body.note : undefined };
  if (!input.ips.length && !input.cidrs.length && !input.domains.length) return res.status(400).json({ error: 'Valide os indicadores antes de pedir o texto.' });
  return streamAi(res, (emit, signal) => ai.writeCaseReason(res.locals.actor as Actor, input, emit, signal));
});

// Logo do cliente a partir do site dele (o navegador reduz e grava com setClientLogo).
const logoLimit = rateLimit('busca de logo', 10);
app.post('/api/logo/fetch', logoLimit, jsonSmall, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await fetchLogoFromSite(String(req.body?.site ?? '')));
  } catch (error) {
    return res.status(400).json({ error: error instanceof LogoError ? error.message : 'Não foi possível buscar a logo.' });
  }
});

// Origem pública do app (links e logo nos e-mails).
const configuredOrigin = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const publicOrigin = () => (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(configuredOrigin) ? configuredOrigin : `http://localhost:${port}`);
const jobs = createJobs(db, store, publicOrigin);
jobs.start();

// Status do sistema (somente administradores): banco, chaves, e-mail, rotinas, última importação e proxy.
app.get('/api/status', adminOnly, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    const dbLatencyMs = Date.now() - t0;
    const [counts, lastImport, runs, pending, cacheCount] = await Promise.all([
      db.query<{ clients: number; entries: number; users: number }>(
        "SELECT (SELECT count(*)::int FROM clients) AS clients, (SELECT count(*)::int FROM entries WHERE status = 'active') AS entries, (SELECT count(*)::int FROM users WHERE active) AS users"
      ),
      db.query<{ happened_at: string; data: { clientName?: string; importedBy?: string; addedCount?: number } }>('SELECT happened_at, data FROM history ORDER BY happened_at DESC LIMIT 1'),
      jobs.runs(),
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM pending_imports WHERE status = 'pending'"),
      db.query<{ n: number }>('SELECT count(*)::int AS n FROM cti_cache')
    ]);
    const hops = app.get('trust proxy');
    return res.json({
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database: { kind: db.kind, ok: true, latencyMs: dbLatencyMs, ...counts[0] },
      cti: { ...ctiConfigured(), cachedIps: cacheCount[0]?.n ?? 0 },
      ai: { configured: aiConfigured(), model: aiSettings().model || null, baseUrl: aiSettings().baseUrl || null },
      email: {
        configured: smtpConfigured(),
        reportRecipients: recipients('REPORT_EMAILS').length,
        backupRecipients: recipients('BACKUP_EMAILS').length
      },
      jobs: runs,
      pendingApprovals: pending[0]?.n ?? 0,
      lastImport: lastImport[0]
        ? { at: new Date(lastImport[0].happened_at).toISOString(), client: lastImport[0].data.clientName, by: lastImport[0].data.importedBy, added: lastImport[0].data.addedCount }
        : null,
      proxy: {
        trustProxyHops: hops,
        seenIp: req.ip,
        forwardedChain: req.get('x-forwarded-for') || null,
        ips: req.ips
      }
    });
  } catch (error) {
    return res.json({ database: { kind: db.kind, ok: false, error: error instanceof Error ? error.message : 'Falha' } });
  }
});

// Contagem leve de pendências para o menu (qualquer usuário: admin vê as da equipe; analista, as próprias).
app.get('/api/notifications', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const actor = res.locals.actor as Actor;
    const pending = await db.query<{ n: number }>(
      actor.role === 'admin'
        ? "SELECT count(*)::int AS n FROM pending_imports WHERE status = 'pending'"
        : "SELECT count(*)::int AS n FROM pending_imports WHERE status = 'pending' AND requested_by = $1",
      actor.role === 'admin' ? [] : [actor.username]
    );
    const failed = actor.role === 'admin' ? (await jobs.runs()).filter((r) => r.lastError) : [];
    return res.json({ pendingApprovals: pending[0]?.n ?? 0, failedJobs: failed.map((r) => r.job) });
  } catch (error) {
    return sendError(res, error);
  }
});

const adminAction = rateLimit('ação administrativa', 6);
app.post('/api/status/test-cti', adminOnly, adminAction, async (_req, res) => {
  try {
    return res.json(await cti.testKeys());
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/api/status/test-ai', adminOnly, adminAction, async (_req, res) => {
  try {
    return res.json(await ai.test());
  } catch (error) {
    return res.status(400).json({ error: aiErrorMessage(error) });
  }
});

app.post('/api/status/test-email', adminOnly, adminAction, async (_req, res) => {
  try {
    const to = [...new Set([...recipients('REPORT_EMAILS'), ...recipients('BACKUP_EMAILS')])];
    await sendMail(to, 'GuardList · teste de e-mail', '<p>O envio de e-mails do GuardList está funcionando.</p>');
    return res.json({ ok: true, to });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Falha no envio.' });
  }
});

app.post('/api/status/run/:job', adminOnly, adminAction, async (req, res) => {
  try {
    const actor = res.locals.actor as Actor;
    const detail = req.params.job === 'backup' ? await jobs.runBackup(actor) : req.params.job === 'monthly_report' ? await jobs.runMonthlyReport(actor) : null;
    if (!detail) return res.status(404).json({ error: 'Rotina desconhecida.' });
    return res.json({ ok: true, detail });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Falha ao executar.' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota de API não encontrada.' }));

if (production) {
  // index.html recebe a origem pública para que og:image tenha URL absoluta (exigida pelas prévias de link).
  const indexHtml = readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
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
