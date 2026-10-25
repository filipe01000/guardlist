import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Acesso ao Postgres. Em produção usa DATABASE_URL (Neon); sem ela, sobe um Postgres embutido
// (PGlite) gravado em .data/pglite, só para desenvolvimento e testes locais.

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Database {
  kind: 'postgres' | 'pglite';
  query: Query;
  tx<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  close?: () => Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin', 'analyst')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  indicator TEXT NOT NULL,
  status TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS entries_client_status_idx ON entries (client_id, status);
CREATE INDEX IF NOT EXISTS entries_status_idx ON entries (status);
CREATE INDEX IF NOT EXISTS entries_indicator_idx ON entries (lower(indicator));

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS history_client_idx ON history (client_id, happened_at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_client_idx ON snapshots (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  username TEXT,
  action TEXT NOT NULL,
  detail JSONB
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);

-- Verificação em duas etapas (código de aplicativo autenticador). Segredos criptografados; códigos de recuperação só como hash.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery JSONB;
-- Bloqueio temporário da conta após várias senhas erradas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Sessões abertas (uma por login), para listar e encerrar. O id guardado é o hash do token.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Avisos de acesso novo (navegador ou rede fora do histórico da conta), mostrados nas outras sessões da pessoa.
CREATE TABLE IF NOT EXISTS login_alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  new_device BOOLEAN NOT NULL,
  new_network BOOLEAN NOT NULL,
  dismissed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS login_alerts_user_idx ON login_alerts (user_id, created_at);

-- Conversa curta em cada item da lista.
CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  indicator TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  body TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_entry_idx ON comments (entry_id);
CREATE INDEX IF NOT EXISTS comments_client_idx ON comments (client_id);

-- Importações que aguardam um administrador.
CREATE TABLE IF NOT EXISTS pending_imports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  data JSONB NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS pending_imports_status_idx ON pending_imports (status, requested_at DESC);

-- Reputação dos IPs (AbuseIPDB, GreyNoise, OTX), para triagem e gráficos.
CREATE TABLE IF NOT EXISTS cti_cache (
  indicator TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta detalhada (página Análise de IP e dossiê): 12 meses, com denúncias. Guardada por pouco tempo,
-- separada do cti_cache para não misturar com a contagem de 90 dias da triagem.
CREATE TABLE IF NOT EXISTS cti_analysis_cache (
  indicator TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Casos enviados aos clientes (texto gerado no GuardList): evita informar o mesmo IP duas vezes.
CREATE TABLE IF NOT EXISTS client_cases (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  ticket TEXT NOT NULL,
  indicators JSONB NOT NULL,
  created_by TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, ticket)
);
CREATE INDEX IF NOT EXISTS client_cases_client_idx ON client_cases (client_id, created_at DESC);

-- Detalhe de cada importação (o que entrou, repetidos, dentro de CIDR, inválidos...), para o relatório por lista.
CREATE TABLE IF NOT EXISTS import_reports (
  history_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS import_reports_client_idx ON import_reports (client_id, created_at DESC);

-- Última execução das rotinas automáticas (backup diário, relatório mensal).
CREATE TABLE IF NOT EXISTS job_runs (
  job TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  detail JSONB
);
`;

async function connectPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (error) => console.error('Erro na conexão com o Postgres:', error.message));

  const query: Query = async (sql, params) => (await pool.query(sql, params as unknown[])).rows;
  return {
    kind: 'postgres',
    query,
    close: () => pool.end(),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function connectPglite(dataDir?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const lite = new PGlite(dataDir);
  await lite.waitReady;

  const query: Query = async (sql, params) => {
    // PGlite só aceita parâmetros em comandos únicos; scripts sem parâmetros vão por exec.
    if (!params || params.length === 0) {
      const results = await lite.exec(sql);
      return (results.at(-1)?.rows ?? []) as never[];
    }
    return (await lite.query(sql, params)).rows as never[];
  };
  return {
    kind: 'pglite',
    query,
    close: () => lite.close(),
    tx: (fn) =>
      lite.transaction((tx) =>
        fn(async (sql, params) => (await tx.query(sql, (params ?? []) as unknown[])).rows as never[])
      )
  };
}

// Banco descartável de testes: usa o mesmo schema, sem arquivos e sem ler DATABASE_URL.
export async function openMemoryDatabase(): Promise<Database> {
  const db = await connectPglite();
  try {
    await db.query(SCHEMA);
    return db;
  } catch (error) {
    await db.close?.();
    throw error;
  }
}

export async function openDatabase(rootDir: string): Promise<Database> {
  const url = process.env.DATABASE_URL;
  const db = url
    ? await connectPostgres(url)
    : await connectPglite(path.join(rootDir, '.data', 'pglite'));
  await db.query(SCHEMA);
  return db;
}
