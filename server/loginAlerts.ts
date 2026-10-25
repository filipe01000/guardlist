import { describeAgent, networkOf } from '../src/utils/device.ts';
import type { Database } from './db.ts';
import { StoreError } from './storeCore.ts';

// Aviso de acesso novo: ao abrir uma sessão, compara navegador e rede com o histórico da conta (90 dias).
// O aviso aparece nas outras sessões da pessoa, por 30 dias ou até ela dispensar.

export interface LoginAlert {
  id: number;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  newDevice: boolean;
  newNetwork: boolean;
}

export function createLoginAlerts(db: Database) {
  return {
    async record(userId: number, sessionId: string, ip: string | null, userAgent: string | null) {
      const history = await db.query<{ ip: string | null; user_agent: string | null }>(
        "SELECT ip, user_agent FROM sessions WHERE user_id = $1 AND id <> $2 AND created_at > now() - interval '90 days'",
        [userId, sessionId]
      );
      if (history.length === 0) return;
      const device = describeAgent(userAgent).label;
      const network = networkOf(ip);
      const newDevice = !history.some((h) => describeAgent(h.user_agent).label === device);
      const newNetwork = network !== null && !history.some((h) => networkOf(h.ip) === network);
      if (!newDevice && !newNetwork) return;
      await db.query(
        'INSERT INTO login_alerts (user_id, session_id, ip, user_agent, new_device, new_network) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, sessionId, ip, (userAgent || '').slice(0, 300) || null, newDevice, newNetwork]
      );
      const [user] = await db.query<{ username: string }>('SELECT username FROM users WHERE id = $1', [userId]);
      await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
        user?.username ?? '', 'login.new_access', JSON.stringify({ ip, device, newDevice, newNetwork })
      ]);
    },

    async listFor(userId: number, currentSessionId: string): Promise<LoginAlert[]> {
      const rows = await db.query<{ id: number; created_at: string; ip: string | null; user_agent: string | null; new_device: boolean; new_network: boolean }>(
        `SELECT id, created_at, ip, user_agent, new_device, new_network FROM login_alerts
         WHERE user_id = $1 AND session_id <> $2 AND dismissed_at IS NULL AND created_at > now() - interval '30 days'
         ORDER BY created_at DESC`,
        [userId, currentSessionId]
      );
      return rows.map((r) => ({
        id: r.id,
        createdAt: new Date(r.created_at).toISOString(),
        ip: r.ip,
        userAgent: r.user_agent,
        newDevice: r.new_device,
        newNetwork: r.new_network
      }));
    },

    async dismiss(userId: number, alertId: number) {
      const rows = await db.query('UPDATE login_alerts SET dismissed_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [alertId, userId]);
      if (rows.length === 0) throw new StoreError('Aviso não encontrado.', 404);
    }
  };
}

export type LoginAlerts = ReturnType<typeof createLoginAlerts>;
