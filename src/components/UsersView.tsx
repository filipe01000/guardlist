import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, LockOpen, MonitorSmartphone, Plus, RefreshCw, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { Modal } from './Modal';
import { SessionList } from './SessionList';
import { listUserSessions, revokeAllUserSessions, revokeSession, unlockUser, type SessionInfo } from '../db/store';
import { SessionUser } from '../types';
import { PageHeader } from './PageHeader';

interface UsersViewProps {
  currentUser: SessionUser;
  embedded?: boolean;
}

const ROLE_LABEL: Record<SessionUser['role'], string> = { admin: 'Administrador', analyst: 'Analista' };
const MIN_PASSWORD = 10;

// Senha aleatória legível: 4 blocos de 4 caracteres sem caracteres ambíguos.
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
  return body as T;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- Escolha de senha: aleatória ou definida manualmente ----------

interface PasswordChoiceState {
  mode: 'random' | 'manual';
  random: string;
  manual: string;
  mustChange: boolean;
}

const newPasswordChoice = (): PasswordChoiceState => ({ mode: 'random', random: generatePassword(), manual: '', mustChange: true });
const chosenPassword = (s: PasswordChoiceState) => (s.mode === 'random' ? s.random : s.manual);

const PasswordChoice: React.FC<{
  idPrefix: string;
  value: PasswordChoiceState;
  onChange: (next: PasswordChoiceState) => void;
}> = ({ idPrefix, value, onChange }) => {
  const [visible, setVisible] = useState(false);
  const tooShort = value.mode === 'manual' && value.manual.length > 0 && value.manual.length < MIN_PASSWORD;

  return (
    <div className="password-choice">
      <div className="segmented" role="radiogroup" aria-label="Tipo de senha">
        <button type="button" role="radio" aria-checked={value.mode === 'random'} aria-pressed={value.mode === 'random'} onClick={() => onChange({ ...value, mode: 'random' })}>
          Aleatória
        </button>
        <button type="button" role="radio" aria-checked={value.mode === 'manual'} aria-pressed={value.mode === 'manual'} onClick={() => onChange({ ...value, mode: 'manual' })}>
          Definir manualmente
        </button>
      </div>

      {value.mode === 'random' ? (
        <span className="flex gap-1.5">
          <input
            id={`${idPrefix}-pass`}
            className="field w-full font-mono"
            value={value.random}
            readOnly
            aria-label="Senha aleatória gerada"
          />
          <button type="button" className="btn btn--icon" title="Gerar outra" aria-label="Gerar outra senha" onClick={() => onChange({ ...value, random: generatePassword() })}>
            <RefreshCw aria-hidden="true" />
          </button>
        </span>
      ) : (
        <span className="field-password">
          <input
            id={`${idPrefix}-pass`}
            className="field w-full font-mono"
            type={visible ? 'text' : 'password'}
            value={value.manual}
            onChange={(e) => onChange({ ...value, manual: e.target.value })}
            placeholder={`Mínimo de ${MIN_PASSWORD} caracteres`}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            aria-invalid={tooShort}
            aria-label="Senha definida manualmente"
          />
          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>
            {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </span>
      )}
      {tooShort && <span className="text-[11px] text-rose-400">Faltam {MIN_PASSWORD - value.manual.length} caracteres.</span>}

      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" checked={value.mustChange} onChange={(e) => onChange({ ...value, mustChange: e.target.checked })} className="accent-[var(--accent)]" />
        Pedir para trocar no primeiro acesso
      </label>
    </div>
  );
};

// ---------- Tela ----------

export const UsersView: React.FC<UsersViewProps> = ({ currentUser, embedded = false }) => {
  const [sessionsFor, setSessionsFor] = useState<SessionUser | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState<string | null>(null);

  const openSessions = async (user: SessionUser) => {
    setSessionsFor(user);
    setSessions([]);
    try {
      setSessions((await listUserSessions(user.id)).sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as sessões.');
    }
  };

  const handleUnlock = async (user: SessionUser) => {
    try {
      await unlockUser(user.id);
      setNotice({ text: `A conta de ${user.displayName} foi liberada.` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível liberar a conta.');
    }
  };
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; password?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<SessionUser['role']>('analyst');
  const [createPass, setCreatePass] = useState<PasswordChoiceState>(newPasswordChoice);
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState<SessionUser | null>(null);
  const [resetPass, setResetPass] = useState<PasswordChoiceState>(newPasswordChoice);
  const [resetError, setResetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<{ users: SessionUser[] }>('/api/users');
      setUsers(body.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A senha só é exibida de volta quando foi gerada aqui; senha manual o admin já conhece.
  const announce = (text: string, choice: PasswordChoiceState) => {
    setCopied(false);
    setNotice({ text, password: choice.mode === 'random' ? choice.random : undefined });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const password = chosenPassword(createPass);
    if (password.length < MIN_PASSWORD) return setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    setSaving(true);
    try {
      const body = await api<{ user: SessionUser }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, role, password, mustChangePassword: createPass.mustChange })
      });
      announce(
        `Usuário ${body.user.username} criado.${createPass.mustChange ? ' A senha será trocada no primeiro acesso.' : ''} Envie a senha por um canal seguro.`,
        createPass
      );
      setUsername('');
      setDisplayName('');
      setRole('analyst');
      setCreatePass(newPasswordChoice());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o usuário.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (user: SessionUser, patch: Partial<Pick<SessionUser, 'role' | 'active'>>) => {
    setError(null);
    try {
      await api(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setNotice({
        text:
          patch.active === false
            ? `${user.displayName} foi desativado e saiu de todas as sessões.`
            : patch.active === true
              ? `${user.displayName} foi reativado.`
              : `${user.displayName} agora é ${ROLE_LABEL[patch.role ?? user.role].toLowerCase()}.`
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o usuário.');
    }
  };

  const openReset = (user: SessionUser) => {
    setResetTarget(user);
    setResetPass(newPasswordChoice());
    setResetError(null);
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetTarget) return;
    const password = chosenPassword(resetPass);
    if (password.length < MIN_PASSWORD) return setResetError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    try {
      await api(`/api/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password, mustChangePassword: resetPass.mustChange })
      });
      announce(`Senha de ${resetTarget.displayName} redefinida; as sessões abertas dessa pessoa foram encerradas.`, resetPass);
      setResetTarget(null);
      await load();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    }
  };

  const handleDelete = async (user: SessionUser) => {
    if (!window.confirm(`Apagar ${user.displayName} (${user.username}) definitivamente? A pessoa perde o acesso na hora. As importações feitas por ela continuam no histórico com o nome dela.`)) return;
    setError(null);
    try {
      await api(`/api/users/${user.id}`, { method: 'DELETE' });
      setNotice({ text: `${user.displayName} foi apagado.` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível apagar o usuário.');
    }
  };

  const copyPassword = async () => {
    if (!notice?.password) return;
    await navigator.clipboard.writeText(notice.password).catch(() => undefined);
    setCopied(true);
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Usuários"
          description="Quem acessa o GuardList. Todos trabalham na mesma base; administradores também gerenciam contas, backups, restauração e exclusão de clientes."
        />
      )}

      {notice && (
        <div className="notice notice--ok" role="status">
          <Check aria-hidden="true" />
          <p>{notice.text}</p>
          {notice.password && (
            <span className="flex items-center gap-2">
              <code className="data-tag text-[0.8rem] py-1 px-2.5 select-all">{notice.password}</code>
              <button type="button" className="btn btn--sm" onClick={copyPassword}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copiada' : 'Copiar'}
              </button>
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          <p>{error}</p>
        </div>
      )}

      <section className="data-panel p-5" aria-labelledby="new-user-title">
        <h2 id="new-user-title" className="text-sm font-bold text-white mb-4">Novo usuário</h2>
        <form onSubmit={handleCreate} className="new-user-form">
          <div>
            <label className="field-label" htmlFor="nu-username">Usuário</label>
            <input
              id="nu-username"
              className="field w-full font-mono"
              placeholder="maria.souza"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="nu-name">Nome</label>
            <input id="nu-name" className="field w-full" placeholder="Maria Souza" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="nu-role">Papel</label>
            <select id="nu-role" className="field w-full" value={role} onChange={(e) => setRole(e.target.value as SessionUser['role'])}>
              <option value="analyst">Analista</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="new-user-form__password">
            <span className="field-label">Senha</span>
            <PasswordChoice idPrefix="nu" value={createPass} onChange={setCreatePass} />
          </div>
          <div className="new-user-form__submit">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              <Plus aria-hidden="true" />
              Criar usuário
            </button>
          </div>
        </form>
      </section>

      <section className="data-panel" aria-labelledby="team-title">
        <header className="data-panel__header">
          <h2 id="team-title">Equipe</h2>
          <span>{(() => { const n = users.filter((u) => u.active).length; return `${n} ${n === 1 ? 'ativo' : 'ativos'}`; })()}</span>
        </header>

        {loading ? (
          <div className="empty-state"><p>Carregando…</p></div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <Users aria-hidden="true" />
            <strong>Nenhum usuário</strong>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 1040 }}>
              <colgroup>
                <col />
                <col style={{ width: '200px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '145px' }} />
                <col style={{ width: '420px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Papel</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUser.id;
                  return (
                    <tr key={user.id} className={user.active ? '' : 'opacity-60'}>
                      <td>
                        <span className="block font-semibold text-white">{user.displayName}{isSelf && <span className="text-slate-500 font-normal"> (você)</span>}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{user.username}</span>
                      </td>
                      <td>
                        <select
                          className="field h-8 min-h-0 w-[170px] text-[0.74rem]"
                          value={user.role}
                          onChange={(e) => handleUpdate(user, { role: e.target.value as SessionUser['role'] })}
                          aria-label={`Papel de ${user.displayName}`}
                          disabled={!user.active || isSelf}
                          title={isSelf ? 'Peça a outro administrador para mudar o seu papel' : undefined}
                        >
                          <option value="analyst">Analista</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </td>
                      <td>
                        {!user.active ? (
                          <span className="chip">Desativado</span>
                        ) : user.lockedUntil ? (
                          <span className="chip chip--danger" title={`Bloqueada até ${formatDate(user.lockedUntil)}`}>Bloqueada</span>
                        ) : user.mustChangePassword ? (
                          <span className="chip chip--warn">Senha provisória</span>
                        ) : (
                          <span className="chip chip--ok">Ativo</span>
                        )}
                      </td>
                      <td className="font-mono text-[0.72rem] whitespace-nowrap">{formatDate(user.lastLoginAt)}</td>
                      <td>
                        {isSelf ? (
                          <span className="block text-right text-[11px] text-slate-500 whitespace-nowrap" title="Senha e sessões ficam em Minha conta (clique no seu nome no menu)">Gerencie em Minha conta</span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            {user.lockedUntil && (
                              <button type="button" className="btn btn--sm" onClick={() => handleUnlock(user)} title="Libera a conta travada por senhas erradas">
                                <LockOpen aria-hidden="true" />
                                Liberar
                              </button>
                            )}
                            <button type="button" className="btn btn--sm btn--quiet" onClick={() => openSessions(user)} disabled={!user.active}>
                              <MonitorSmartphone aria-hidden="true" />
                              Sessões
                            </button>
                            <button type="button" className="btn btn--sm" onClick={() => openReset(user)} disabled={!user.active}>
                              <KeyRound aria-hidden="true" />
                              Nova senha
                            </button>
                            {user.active ? (
                              <button type="button" className="btn btn--sm btn--quiet" onClick={() => handleUpdate(user, { active: false })} title="Bloqueia o acesso sem apagar a conta">
                                <UserX aria-hidden="true" />
                                Desativar
                              </button>
                            ) : (
                              <button type="button" className="btn btn--sm" onClick={() => handleUpdate(user, { active: true })}>
                                <UserCheck aria-hidden="true" />
                                Reativar
                              </button>
                            )}
                            <button type="button" className="btn btn--sm btn--quiet btn--danger" onClick={() => handleDelete(user)} aria-label={`Apagar ${user.displayName}`} title="Apagar definitivamente">
                              <Trash2 aria-hidden="true" />
                              Apagar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(sessionsFor)}
        onClose={() => setSessionsFor(null)}
        title={`Sessões de ${sessionsFor?.displayName ?? ''}`}
        subtitle="Onde a conta está conectada agora."
        footer={
          <button
            type="button"
            className="btn btn--danger"
            disabled={sessions.length === 0}
            onClick={async () => {
              if (!sessionsFor) return;
              await revokeAllUserSessions(sessionsFor.id);
              setSessions([]);
              setNotice({ text: `Todas as sessões de ${sessionsFor.displayName} foram encerradas.` });
            }}
          >
            Encerrar todas
          </button>
        }
      >
        <SessionList
          sessions={sessions}
          busyId={sessionsBusy}
          onRevoke={async (id) => {
            if (!sessionsFor) return;
            setSessionsBusy(id);
            try {
              await revokeSession(id);
              setSessions((await listUserSessions(sessionsFor.id)).sessions);
            } finally {
              setSessionsBusy(null);
            }
          }}
        />
      </Modal>

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setResetTarget(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="data-panel w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setResetTarget(null)}
            onSubmit={handleReset}
          >
            <div>
              <h2 id="reset-title" className="text-base font-bold text-white">Nova senha</h2>
              <p className="text-xs text-slate-400 mt-1">
                {resetTarget.displayName} · {resetTarget.username}. As sessões abertas dessa pessoa serão encerradas.
              </p>
            </div>
            <PasswordChoice idPrefix="reset" value={resetPass} onChange={setResetPass} />
            {resetError && <p className="text-xs font-semibold text-rose-400" role="alert">{resetError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setResetTarget(null)}>Cancelar</button>
              <button type="submit" className="btn btn--primary">
                <KeyRound aria-hidden="true" />
                Salvar senha
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
