import React from 'react';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import type { SessionInfo } from '../db/store';
import { formatDateTimeBR } from '../utils/csv';
import { describeAgent } from '../utils/device';

interface SessionListProps {
  sessions: SessionInfo[];
  onRevoke: (id: string) => void;
  busyId?: string | null;
}

export const SessionList: React.FC<SessionListProps> = ({ sessions, onRevoke, busyId }) => {
  if (sessions.length === 0) return <p className="text-xs text-slate-400">Nenhuma sessão aberta.</p>;
  return (
    <ul className="space-y-2">
      {sessions.map((s) => {
        const agent = describeAgent(s.userAgent);
        const Icon = agent.mobile ? Smartphone : Laptop;
        return (
          <li key={s.id} className="lookup-match" style={{ marginTop: 0 }}>
            <span className="flex items-center gap-2 min-w-0">
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="text-white font-semibold">{agent.label}</span>
                {s.current && <span className="chip chip--ok ml-2">Esta sessão</span>}
                <br />
                <small>
                  IP {s.ip || '—'} · entrou {formatDateTimeBR(s.createdAt)} · ativo {formatDateTimeBR(s.lastSeenAt)}
                </small>
              </span>
            </span>
            {!s.current && (
              <button type="button" className="btn btn--sm btn--quiet btn--danger" disabled={busyId === s.id} onClick={() => onRevoke(s.id)}>
                <LogOut aria-hidden="true" />
                Encerrar
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
};
