import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus, RefreshCw, UserCheck, UserX, Users } from 'lucide-react';
import { SessionUser } from '../types';
import { PageHeader } from './PageHeader';

interface UsersViewProps {
  currentUser: SessionUser;
}

const ROLE_LABEL: Record<SessionUser['role'], string> = { admin: 'Administrador', analyst: 'Analista' };

// Senha provisória legível: 4 blocos de 4 caracteres sem caracteres ambíguos.
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

export const UsersView: React.FC<UsersViewProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; password?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<SessionUser['role']>('analyst');
  const [password, setPassword] = useState(generatePassword);
  const [saving, setSaving] = useState(false);

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

  const showPassword = (text: string, temp: string) => {
    setCopied(false);
    setNotice({ text, password: temp });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ user: SessionUser }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, role, password })
      });
      showPassword(`Usuário ${body.user.username} criado. Envie a senha provisória por um canal seguro; ela será trocada no primeiro acesso.`, password);
      setUsername('');
      setDisplayName('');
      setRole('analyst');
      setPassword(generatePassword());
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

  const handleReset = async (user: SessionUser) => {
    if (!window.confirm(`Gerar uma nova senha provisória para ${user.displayName}? As sessões abertas dessa pessoa serão encerradas.`)) return;
    const temp = generatePassword();
    setError(null);
    try {
      await api(`/api/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: temp }) });
      showPassword(`Nova senha provisória de ${user.displayName}. Ela será trocada no próximo acesso.`, temp);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    }
  };

  const copyPassword = async () => {
    if (!notice?.password) return;
    await navigator.clipboard.writeText(notice.password).catch(() => undefined);
    setCopied(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Quem acessa o GuardList. Todos trabalham na mesma base; administradores também gerenciam contas, backups e restauração."
      />

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
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr_150px_1.3fr_auto] gap-3 items-end">
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
          <div>
            <label className="field-label" htmlFor="nu-pass">Senha provisória</label>
            <span className="flex gap-1.5">
              <input id="nu-pass" className="field w-full font-mono" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required />
              <button type="button" className="btn btn--icon" title="Gerar outra senha" aria-label="Gerar outra senha" onClick={() => setPassword(generatePassword())}>
                <RefreshCw aria-hidden="true" />
              </button>
            </span>
          </div>
          <button type="submit" className="btn btn--primary h-9" disabled={saving}>
            <Plus aria-hidden="true" />
            Criar
          </button>
        </form>
      </section>

      <section className="data-panel" aria-labelledby="team-title">
        <header className="data-panel__header">
          <h2 id="team-title">Equipe</h2>
          <span>{users.filter((u) => u.active).length} ativos</span>
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
            <table className="data-table">
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
                <col />
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
                          className="field h-8 min-h-0 w-[140px] text-[0.74rem]"
                          value={user.role}
                          onChange={(e) => handleUpdate(user, { role: e.target.value as SessionUser['role'] })}
                          aria-label={`Papel de ${user.displayName}`}
                          disabled={!user.active}
                        >
                          <option value="analyst">Analista</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </td>
                      <td>
                        {!user.active ? (
                          <span className="chip">Desativado</span>
                        ) : user.mustChangePassword ? (
                          <span className="chip chip--warn">Senha provisória</span>
                        ) : (
                          <span className="chip chip--ok">Ativo</span>
                        )}
                      </td>
                      <td className="font-mono text-[0.72rem] whitespace-nowrap">{formatDate(user.lastLoginAt)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn btn--sm" onClick={() => handleReset(user)} disabled={!user.active}>
                            <KeyRound aria-hidden="true" />
                            Nova senha
                          </button>
                          {user.active ? (
                            <button type="button" className="btn btn--sm btn--quiet btn--danger" onClick={() => handleUpdate(user, { active: false })} disabled={isSelf} title={isSelf ? 'Você não pode desativar a própria conta' : undefined}>
                              <UserX aria-hidden="true" />
                              Desativar
                            </button>
                          ) : (
                            <button type="button" className="btn btn--sm" onClick={() => handleUpdate(user, { active: true })}>
                              <UserCheck aria-hidden="true" />
                              Reativar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
