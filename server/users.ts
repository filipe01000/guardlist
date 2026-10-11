import { hashPassword, parseUsers, verifyPassword } from '../auth.ts';
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
}

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'analyst';
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
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
    lastLoginAt: row.last_login_at
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

    async authenticate(username: string, password: string): Promise<UserRow | null> {
      const normalized = username.trim().toLowerCase();
      const rows = await db.query<UserRow>('SELECT * FROM users WHERE username = $1', [normalized]);
      const row = rows[0];
      const ok = verifyPassword(password, row?.password_hash || dummyHash);
      if (!row || !ok || !row.active) return null;
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
      await audit(row.username, 'auth.login', {});
      return row;
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

    async update(actor: Actor, id: number, input: { displayName?: unknown; role?: unknown; active?: unknown }) {
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
        'UPDATE users SET password_hash = $2, must_change_password = $3, session_version = session_version + 1 WHERE id = $1',
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

    async revokeSessions(id: number) {
      await db.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [id]);
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
