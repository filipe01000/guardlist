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
`;

async function connectPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (error) => console.error('Erro na conexão com o Postgres:', error.message));

  const query: Query = async (sql, params) => (await pool.query(sql, params as unknown[])).rows;
  return {
    kind: 'postgres',
    query,
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

async function connectPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync(path.dirname(dataDir), { recursive: true });
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
    tx: (fn) =>
      lite.transaction((tx) =>
        fn(async (sql, params) => (await tx.query(sql, (params ?? []) as unknown[])).rows as never[])
      )
  };
}

export async function openDatabase(rootDir: string): Promise<Database> {
  const url = process.env.DATABASE_URL;
  const db = url
    ? await connectPostgres(url)
    : await connectPglite(path.join(rootDir, '.data', 'pglite'));
  await db.query(SCHEMA);
  return db;
}
