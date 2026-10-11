import { hashPassword, hashSessionId, newSessionId, parseUsers, SESSION_TTL_MS, verifyPassword } from '../auth.ts';
import type { Database } from './db.ts';
import { StoreError, type Actor } from './store.ts';

// Usuários da equipe, guardados no banco. Administradores gerenciam contas; analistas trabalham nas listas.

export interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: 'admin' | 'analyst';
  active: boolean;
  must_change_password: boolean;
  session_version: number;
  created_at: string;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

// Bloqueio temporário: depois de MAX_FAILED_LOGINS senhas erradas seguidas, a conta trava por LOCK_MINUTES.
export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
export const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'analyst';
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

const USERNAME_RE = /^[a-z0-9._-]{2,64}$/;
export const MIN_PASSWORD = 10;

export function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lockedUntil: row.locked_until && new Date(row.locked_until).getTime() > Date.now() ? new Date(row.locked_until).toISOString() : null
  };
}

export function toActor(row: UserRow): Actor {
  return { username: row.username, displayName: row.display_name || row.username, role: row.role };
}

function checkPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new StoreError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (password.length > 256) throw new StoreError('Senha longa demais.');
  return password;
}

// Hash fictício para que usuário inexistente custe o mesmo tempo que senha errada.
const dummyHash = hashPassword('guardlist-placeholder-password');

export function createUsers(db: Database) {
  async function byId(id: number): Promise<UserRow | null> {
    const rows = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async function activeAdmins(): Promise<number> {
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active");
    return rows[0]?.n ?? 0;
  }

  async function audit(actor: string, action: string, detail: Record<string, unknown>) {
    await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [actor, action, JSON.stringify(detail)]);
  }

  return {
    byId,

    async count(): Promise<number> {
      const rows = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
      return rows[0]?.n ?? 0;
    },

    // Primeira subida: importa os usuários de APP_USERS (já com hash) como administradores.
    async bootstrapFromEnv(): Promise<number> {
      if ((await this.count()) > 0) return 0;
      const legacy = parseUsers(process.env.APP_USERS);
      let created = 0;
      for (const [username, hash] of legacy) {
        await db.query(
          `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $1, $2, 'admin') ON CONFLICT (username) DO NOTHING`,
          [username, hash]
        );
        created++;
      }
      const initial = process.env.ADMIN_INITIAL_PASSWORD;
      if (created === 0 && initial && initial.length >= MIN_PASSWORD) {
        await db.query(
          `INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES ('admin', 'Administrador', $1, 'admin', TRUE)`,
          [hashPassword(initial)]
        );
        created++;
      }
      return created;
    },

    // Resultado do login: usuário, conta travada (com horário de liberação) ou credenciais inválidas.
    async authenticate(username: string, password: string): Promise<{ row: UserRow } | { lockedUntil: string } | null> {
      const normalized = username.trim().toLowerCase();
      const rows = await db.query<UserRow>('SELECT * FROM users WHERE username = $1', [normalized]);
      const row = rows[0];
      const ok = verifyPassword(password, row?.password_hash || dummyHash);
      if (row && row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        return { lockedUntil: new Date(row.locked_until).toISOString() };
      }
      if (row && !ok) {
        const failed = (row.failed_logins || 0) + 1;
        if (failed >= MAX_FAILED_LOGINS) {
          const locked = await db.query<{ locked_until: string }>(
            "UPDATE users SET failed_logins = 0, locked_until = now() + make_interval(mins => $2::int) WHERE id = $1 RETURNING locked_until",
            [row.id, LOCK_MINUTES]
          );
          await audit(row.username, 'auth.locked', { minutes: LOCK_MINUTES });
          return { lockedUntil: new Date(locked[0].locked_until).toISOString() };
        }
        await db.query('UPDATE users SET failed_logins = $2 WHERE id = $1', [row.id, failed]);
        await audit(row.username, 'auth.failed', { attempt: failed });
        return null;
      }
      if (!row || !ok || !row.active) return null;
      await db.query('UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);
      await audit(row.username, 'auth.login', {});
      return { row };
    },

    async createSession(row: UserRow, ip: string | null, userAgent: string | null): Promise<string> {
      const sid = newSessionId();
      await db.query(
        `INSERT INTO sessions (id, user_id, version, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision), $5, $6)`,
        [hashSessionId(sid), row.id, row.session_version, SESSION_TTL_MS / 1000, ip, (userAgent || '').slice(0, 300) || null]
      );
      // Faxina: sessões vencidas ou encerradas há mais de 30 dias.
      await db.query("DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'");
      return sid;
    },

    // Usuário da sessão, se ela segue aberta, dentro da validade e na versão atual do usuário.
    async bySession(sid: string): Promise<(UserRow & { session_id: string }) | null> {
      const id = hashSessionId(sid);
      const rows = await db.query<UserRow & { session_id: string; last_seen_at: string }>(
        `SELECT u.*, s.id AS session_id, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.version = u.session_version AND u.active`,
        [id]
      );
      const row = rows[0];
      if (!row) return null;
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
      }
      return row;
    },

    async listSessions(userId: number, currentSessionId?: string): Promise<SessionInfo[]> {
      const rows = await db.query<{ id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string | null; user_agent: string | null }>(
        `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.ip, s.user_agent FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.version = u.session_version
         ORDER BY s.last_seen_at DESC`,
        [userId]
      );
      return rows.map((r) => ({
        id: r.id,
        createdAt: new Date(r.created_at).toISOString(),
        lastSeenAt: new Date(r.last_seen_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
        ip: r.ip,
        userAgent: r.user_agent,
        current: r.id === currentSessionId
      }));
    },

    // Encerra uma sessão. Quem não é admin só encerra as próprias.
    async revokeSession(actor: Actor, actorId: number, sessionId: string) {
      const rows = await db.query<{ user_id: number; username: string }>(
        'SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
        [String(sessionId)]
      );
      const target = rows[0];
      if (!target) throw new StoreError('Sessão não encontrada.', 404);
      if (target.user_id !== actorId && actor.role !== 'admin') throw new StoreError('Apenas administradores podem fazer isso.', 403);
      await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [String(sessionId)]);
      await audit(actor.username, 'session.revoke', { username: target.username });
      return null;
    },

    // Encerra todas as sessões de um usuário (inclusive as que ainda não estão na tabela).
    async revokeAllSessions(actor: Actor, userId: number) {
      const row = await byId(userId);
      if (!row) throw new StoreError('Usuário não encontrado.', 404);
      await db.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [userId]);
      await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await audit(actor.username, 'session.revoke_all', { username: row.username });
      return null;
    },

    async revokeSessionById(sessionId: string) {
      await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
    },

    async list(): Promise<PublicUser[]> {
      const rows = await db.query<UserRow>('SELECT * FROM users ORDER BY active DESC, role, username');
      return rows.map(toPublic);
    },

    async create(actor: Actor, input: { username?: unknown; displayName?: unknown; role?: unknown; password?: unknown; mustChangePassword?: unknown }) {
      const username = String(input.username ?? '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) {
        throw new StoreError('Usuário inválido: use de 2 a 64 letras minúsculas, números, ponto, hífen ou sublinhado.');
      }
      const role = input.role === 'admin' ? 'admin' : 'analyst';
      const displayName = String(input.displayName ?? '').trim().slice(0, 80) || username;
      const password = checkPassword(input.password);
      const mustChange = input.mustChangePassword !== false;
      const exists = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (exists.length) throw new StoreError('Já existe um usuário com esse nome.', 409);
      const rows = await db.query<UserRow>(
        `INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [username, displayName, hashPassword(password), role, mustChange]
      );
      await audit(actor.username, 'user.create', { username, role, mustChange });
      return toPublic(rows[0]);
    },

    async update(actor: Actor, id: number, input: { displayName?: unknown; role?: unknown; active?: unknown; unlock?: unknown }) {
      const row = await byId(id);
      if (!row) throw new StoreError('Usuário não encontrado.', 404);
      const role = input.role === undefined ? row.role : input.role === 'admin' ? 'admin' : 'analyst';
      const active = input.active === undefined ? row.active : Boolean(input.active);
      const displayName = input.displayName === undefined ? row.display_name : String(input.displayName).trim().slice(0, 80) || row.username;

      // Nunca deixar a equipe sem um administrador ativo.
      const losesAdmin = row.role === 'admin' && row.active && (role !== 'admin' || !active);
      if (losesAdmin && (await activeAdmins()) <= 1) {
        throw new StoreError('É preciso manter pelo menos um administrador ativo.', 409);
      }

      const revoke = !active || role !== row.role;
      if (input.unlock === true) {
        await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [id]);
        await audit(actor.username, 'user.unlock', { username: row.username });
      }
      const rows = await db.query<UserRow>(
        `UPDATE users SET display_name = $2, role = $3, active = $4,
           session_version = session_version + $5 WHERE id = $1 RETURNING *`,
        [id, displayName, role, active, revoke ? 1 : 0]
      );
      await audit(actor.username, 'user.update', { username: row.username, role, active });
      return toPublic(rows[0]);
    },

    async resetPassword(actor: Actor, id: number, password: unknown, mustChangePassword: unknown = true) {
      const row = await byId(id);
      if (!row) throw new StoreError('Usuário não encontrado.', 404);
      if (row.username === actor.username) {
        throw new StoreError('Para a sua própria conta, use Alterar senha clicando no seu nome na barra lateral.');
      }
      const pass = checkPassword(password);
      const mustChange = mustChangePassword !== false;
      await db.query(
        'UPDATE users SET password_hash = $2, must_change_password = $3, session_version = session_version + 1, failed_logins = 0, locked_until = NULL WHERE id = $1',
        [id, hashPassword(pass), mustChange]
      );
      await audit(actor.username, 'user.reset_password', { username: row.username, mustChange });
      return null;
    },

    // Exclusão definitiva. Histórico e auditoria guardam o nome, então seguem legíveis.
    async remove(actor: Actor, id: number) {
      const row = await byId(id);
      if (!row) throw new StoreError('Usuário não encontrado.', 404);
      if (row.username === actor.username) throw new StoreError('Você não pode apagar a própria conta.', 409);
      if (row.role === 'admin' && row.active && (await activeAdmins()) <= 1) {
        throw new StoreError('É preciso manter pelo menos um administrador ativo.', 409);
      }
      await db.query('DELETE FROM users WHERE id = $1', [id]);
      await audit(actor.username, 'user.delete', { username: row.username, displayName: row.display_name, role: row.role });
      return null;
    },

    async changeOwnPassword(id: number, current: unknown, next: unknown): Promise<UserRow> {
      const row = await byId(id);
      if (!row || !row.active) throw new StoreError('Sessão inválida.', 401);
      if (typeof current !== 'string' || !verifyPassword(current, row.password_hash)) {
        throw new StoreError('A senha atual não confere.', 400);
      }
      const pass = checkPassword(next);
      if (pass === current) throw new StoreError('A nova senha precisa ser diferente da atual.');
      const rows = await db.query<UserRow>(
        'UPDATE users SET password_hash = $2, must_change_password = FALSE, session_version = session_version + 1 WHERE id = $1 RETURNING *',
        [id, hashPassword(pass)]
      );
      await audit(row.username, 'user.change_password', {});
      return rows[0];
    }
  };
}

export type Users = ReturnType<typeof createUsers>;
