import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { ChangePasswordForm } from './ChangePasswordForm';
import { SessionList } from './SessionList';
import { listMySessions, revokeSession, type SessionInfo } from '../db/store';
import { SessionUser } from '../types';

interface AccountModalProps {
  open: boolean;
  currentUser: SessionUser;
  onClose: () => void;
  onPasswordChanged: (user: SessionUser) => void;
}

// Minha conta: trocar a senha e ver/encerrar as sessões abertas em outros computadores.
export const AccountModal: React.FC<AccountModalProps> = ({ open, currentUser, onClose, onPasswordChanged }) => {
  const [tab, setTab] = useState<'password' | 'sessions'>('password');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listMySessions().then((r) => setSessions(r.sessions)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (open) {
      setTab('password');
      setError(null);
      load();
    }
  }, [open, load]);

  return (
    <Modal open={open} onClose={onClose} title="Minha conta" subtitle={`${currentUser.displayName} · ${currentUser.username}`} size="md">
      <div className="page-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'password'} onClick={() => setTab('password')}>Alterar senha</button>
        <button type="button" role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>
          Sessões abertas <span className="tabs__count">{sessions.length}</span>
        </button>
      </div>
      {tab === 'password' ? (
        <ChangePasswordForm onCancel={onClose} onDone={onPasswordChanged} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Computadores e celulares onde sua conta está conectada. Encerre o que você não reconhece; trocar a senha encerra todas as outras.
          </p>
          {error && <div className="notice notice--danger"><p>{error}</p></div>}
          <SessionList
            sessions={sessions}
            busyId={busyId}
            onRevoke={async (id) => {
              setBusyId(id);
              try {
                await revokeSession(id);
                load();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Falha ao encerrar.');
              } finally {
                setBusyId(null);
              }
            }}
          />
        </div>
      )}
    </Modal>
  );
};
