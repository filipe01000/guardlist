import QRCode from 'qrcode';
import type { Database } from '../db.ts';
import { openSecret, sealSecret, secretKeyAvailable } from '../secretBox.ts';
import { DEFAULT_SETTINGS, StoreError, type Actor } from '../storeCore.ts';
import { registerFailedAttempt, type UserRow } from '../users.ts';
import { consumeRecoveryCode, generateRecoveryCodes } from './recovery.ts';
import { generateSecret, otpauthUri, verifyTotp } from './totp.ts';

// Verificação em duas etapas: cadastro do aplicativo autenticador, conferência do código, códigos de
// recuperação e a exigência ligada pelo administrador (settings.app_settings.mfaRequired).

const KEY = 'MFA_SECRET_KEY';

export function createMfa(db: Database, opts: { env?: NodeJS.ProcessEnv; now?: () => number } = {}) {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => Date.now());

  async function row(userId: number): Promise<UserRow> {
    const rows = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new StoreError('Usuário não encontrado.', 404);
    return rows[0];
  }

  async function log(username: string, action: string, detail: Record<string, unknown> = {}) {
    await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [username, action, JSON.stringify(detail)]);
  }

  // Confere um código do aplicativo e, se valer, grava o período usado (para não valer de novo).
  async function checkCode(user: UserRow, code: string): Promise<boolean> {
    if (!user.mfa_secret) return false;
    const last = user.mfa_last_step == null ? null : Number(user.mfa_last_step);
    const step = verifyTotp(openSecret(user.mfa_secret, KEY, env), code, now(), last);
    if (step === null) return false;
    await db.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [user.id, step]);
    return true;
  }

  async function settings() {
    const rows = await db.query<{ data: Record<string, unknown> }>("SELECT data FROM settings WHERE key = 'app_settings'");
    return { ...DEFAULT_SETTINGS, ...(rows[0]?.data ?? {}) } as Record<string, unknown>;
  }

  return {
    available: () => secretKeyAvailable(KEY, env),

    async isRequired(): Promise<boolean> {
      return (await settings()).mfaRequired === true;
    },

    async setRequired(actor: Actor, actorId: number, on: boolean) {
      if (actor.role !== 'admin') throw new StoreError('Apenas administradores podem fazer isso.', 403);
      if (on) {
        if (!secretKeyAvailable(KEY, env)) throw new StoreError(`Para exigir a verificação em duas etapas, defina ${KEY} no servidor.`, 503);
        if (!(await row(actorId)).mfa_enabled_at) {
          throw new StoreError('Cadastre a sua verificação em duas etapas em "Minha conta" antes de exigir para a equipe.');
        }
      }
      const current = await settings();
      await db.query(
        `INSERT INTO settings (key, data) VALUES ('app_settings', $1::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
        [JSON.stringify({ ...current, mfaRequired: on })]
      );
      await log(actor.username, on ? 'mfa.required.on' : 'mfa.required.off');
    },

    async stats(): Promise<{ enrolled: number; total: number }> {
      const rows = await db.query<{ enrolled: number; total: number }>(
        'SELECT count(*) FILTER (WHERE mfa_enabled_at IS NOT NULL)::int AS enrolled, count(*)::int AS total FROM users WHERE active'
      );
      return { enrolled: rows[0]?.enrolled ?? 0, total: rows[0]?.total ?? 0 };
    },

    // Gera uma chave nova, guardada como pendente até o primeiro código confirmar.
    async startSetup(userId: number, account: string): Promise<{ secret: string; uri: string; qrSvg: string }> {
      const secret = generateSecret();
      await db.query('UPDATE users SET mfa_pending_secret = $2 WHERE id = $1', [userId, sealSecret(secret, KEY, env)]);
      const uri = otpauthUri(secret, account);
      const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1a33', light: '#ffffff' } });
      return { secret, uri, qrSvg };
    },

    async confirmSetup(userId: number, code: string): Promise<string[] | null> {
      const user = await row(userId);
      if (!user.mfa_pending_secret) throw new StoreError('Comece o cadastro de novo: o QR code expirou.');
      const secret = openSecret(user.mfa_pending_secret, KEY, env);
      const step = verifyTotp(secret, code, now(), null);
      if (step === null) return null;
      const { codes, hashes } = generateRecoveryCodes();
      await db.query(
        `UPDATE users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled_at = now(),
           mfa_last_step = $2, mfa_recovery = $3::jsonb WHERE id = $1`,
        [userId, step, JSON.stringify(hashes)]
      );
      await log(user.username, 'mfa.enable');
      return codes;
    },

    // Código do aplicativo ou de recuperação. Erros contam no mesmo bloqueio da senha.
    async verify(userId: number, input: { code?: string; recoveryCode?: string }): Promise<'ok' | 'bad' | { lockedUntil: string }> {
      const user = await row(userId);
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return { lockedUntil: new Date(user.locked_until).toISOString() };
      }
      let ok = false;
      if (input.recoveryCode) {
        const left = consumeRecoveryCode(user.mfa_recovery ?? [], input.recoveryCode);
        if (left) {
          await db.query('UPDATE users SET mfa_recovery = $2::jsonb WHERE id = $1', [userId, JSON.stringify(left)]);
          await log(user.username, 'mfa.recovery.used', { left: left.length });
          ok = true;
        }
      } else if (input.code) {
        ok = await checkCode(user, input.code);
      }
      if (ok) {
        await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [userId]);
        return 'ok';
      }
      const locked = await db.tx((q) => registerFailedAttempt(q, user, 'mfa'));
      return locked ?? 'bad';
    },

    async regenerateRecovery(userId: number, code: string): Promise<string[] | null> {
      const user = await row(userId);
      if (!(await checkCode(user, code))) return null;
      const { codes, hashes } = generateRecoveryCodes();
      await db.query('UPDATE users SET mfa_recovery = $2::jsonb WHERE id = $1', [userId, JSON.stringify(hashes)]);
      await log(user.username, 'mfa.recovery.regenerate');
      return codes;
    },

    async disable(userId: number, code: string): Promise<boolean> {
      if ((await settings()).mfaRequired === true) {
        throw new StoreError('A verificação em duas etapas é exigida pelo administrador e não pode ser desligada.');
      }
      const user = await row(userId);
      if (!(await checkCode(user, code))) return false;
      await db.query(
        'UPDATE users SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery = NULL WHERE id = $1',
        [userId]
      );
      await log(user.username, 'mfa.disable');
      return true;
    },

    // Perdeu o celular e os códigos: o administrador zera, e o usuário cadastra de novo no próximo login.
    async reset(actor: Actor, userId: number) {
      if (actor.role !== 'admin') throw new StoreError('Apenas administradores podem fazer isso.', 403);
      const user = await row(userId);
      await db.tx(async (q) => {
        await q(
          `UPDATE users SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery = NULL,
             session_version = session_version + 1 WHERE id = $1`,
          [userId]
        );
        await q('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
        await q('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [actor.username, 'mfa.reset', JSON.stringify({ username: user.username })]);
      });
    }
  };
}

export type Mfa = ReturnType<typeof createMfa>;
