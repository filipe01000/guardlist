import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../auth.ts';
import type { Database, Query } from './db.ts';
import { createUsers, MAX_FAILED_LOGINS } from './users.ts';

test('tentativas concorrentes bloqueiam a conta e senha correta não contorna o bloqueio', async (t) => {
  const lite = new PGlite();
  t.after(() => lite.close());
  await lite.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT,
      active BOOLEAN DEFAULT TRUE, failed_logins INTEGER DEFAULT 0,
      locked_until TIMESTAMPTZ, last_login_at TIMESTAMPTZ
    );
    CREATE TABLE audit_log (username TEXT, action TEXT, detail JSONB);
  `);
  const query: Query = async (sql, params) => (await lite.query(sql, params)).rows as never[];
  const db: Database = {
    kind: 'pglite', query,
    tx: (fn) => lite.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params)).rows as never[]))
  };
  await query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['analista', hashPassword('senha-segura-123')]);
  const users = createUsers(db);
  const attempts = await Promise.all(Array.from({ length: MAX_FAILED_LOGINS }, () => users.authenticate('analista', 'senha-errada')));
  assert.equal(attempts.filter((result) => result && 'lockedUntil' in result).length, 1);
  const locked = await users.authenticate('analista', 'senha-segura-123');
  assert.ok(locked && 'lockedUntil' in locked);
  const audits = await query<{ action: string }>('SELECT action FROM audit_log');
  assert.equal(audits.filter((row) => row.action === 'auth.failed').length, MAX_FAILED_LOGINS - 1);
  assert.equal(audits.filter((row) => row.action === 'auth.locked').length, 1);

  await query("UPDATE users SET locked_until = now() - interval '1 minute', failed_logins = 2");
  const unlocked = await users.authenticate('analista', 'senha-segura-123');
  assert.ok(unlocked && 'row' in unlocked);
  const [row] = await query<{ failed_logins: number; locked_until: string | null }>('SELECT failed_logins, locked_until FROM users');
  assert.equal(row.failed_logins, 0);
  assert.equal(row.locked_until, null);
});
