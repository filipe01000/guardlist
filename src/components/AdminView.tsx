import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles,
  Activity, CheckCircle2, ClipboardList, Database, Inbox, KeyRound, Loader2, Mail, Network, RefreshCw, Search, Server, ShieldCheck, Users, XCircle
} from 'lucide-react';
import { PageHeader } from './PageHeader';
import { UsersView } from './UsersView';
import { MfaPolicyPanel } from './mfa/MfaPolicyPanel';
import { Modal } from './Modal';
import { SessionUser, PendingImport } from '../types';
import {
  decidePendingImport, getAuditLog, getSystemStatus, listPendingImports, runJob, testAi, testCtiKeys, testEmail,
  type AuditRow, type SystemStatus
} from '../db/store';
import { formatDateTimeBR } from '../utils/csv';
import { VerdictBadge } from './CtiBits';
import type { ShowToast } from '../App';

type AdminTab = 'users' | 'approvals' | 'audit' | 'status';

interface AdminViewProps {
  currentUser: SessionUser;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onChanged: () => void;
  showToast: ShowToast;
}

export const AdminView: React.FC<AdminViewProps> = ({ currentUser, tab, onTabChange, onChanged, showToast }) => {
  const tabs: Array<{ id: AdminTab; label: string; icon: React.ElementType }> = [
    { id: 'users', label: 'Usuários', icon: Users },
    { id: 'approvals', label: 'Aprovações', icon: Inbox },
    { id: 'audit', label: 'Auditoria', icon: ClipboardList },
    { id: 'status', label: 'Status do sistema', icon: Activity }
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Administração" description="Contas da equipe, importações que aguardam aprovação, trilha de auditoria e saúde do sistema." />
      <div className="page-tabs" role="tablist" aria-label="Seções da administração">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}>
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div key={tab} className="view-enter">
        {tab === 'users' && (
          <>
            <MfaPolicyPanel />
            <UsersView currentUser={currentUser} embedded />
          </>
        )}
        {tab === 'approvals' && <ApprovalsPanel onChanged={onChanged} showToast={showToast} />}
        {tab === 'audit' && <AuditPanel />}
        {tab === 'status' && <StatusPanel showToast={showToast} />}
      </div>
    </div>
  );
};

// ---------- Aprovações ----------

const ApprovalsPanel: React.FC<{ onChanged: () => void; showToast: ShowToast }> = ({ onChanged, showToast }) => {
  const [items, setItems] = useState<PendingImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState<PendingImport | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listPendingImports().then(setItems).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const decide = async (item: PendingImport, decision: 'approve' | 'reject', reason?: string) => {
    setBusy(item.id);
    try {
      const outcome = await decidePendingImport(item.id, decision, reason);
      showToast(
        decision === 'approve'
          ? `Importação de ${item.requestedByName} aprovada: ${outcome?.added ?? 0} gravados${outcome?.retired ? `, ${outcome.retired} retirados` : ''}.`
          : `Importação de ${item.requestedByName} recusada.`
      );
      setRejecting(null);
      setNote('');
      load();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao decidir.', 'info');
    } finally {
      setBusy(null);
    }
  };

  const pending = items.filter((i) => i.status === 'pending');
  const decided = items.filter((i) => i.status !== 'pending');

  return (
    <div className="space-y-5">
      <section className="data-panel">
        <header className="data-panel__header">
          <h2>Aguardando aprovação</h2>
          <span>{pending.length}</span>
        </header>
        {loading ? (
          <div className="empty-state"><Loader2 className="animate-spin" aria-hidden="true" /></div>
        ) : pending.length === 0 ? (
          <div className="empty-state">
            <Inbox aria-hidden="true" />
            <strong>Nada pendente</strong>
            <p>Analistas precisam de aprovação para substituir uma lista ou importar mais itens do que o limite definido em Backup e ajustes.</p>
          </div>
        ) : (
          <ul className="p-3 space-y-3">
            {pending.map((item) => (
              <li key={item.id} className="lookup-result">
                <div className="lookup-result__head">
                  <div>
                    <strong className="text-white">{item.clientName}</strong>{' '}
                    <span className={item.mode === 'replace' ? 'chip chip--warn' : 'chip'}>{item.mode === 'replace' ? 'Substituir lista' : 'Adicionar à lista'}</span>
                    <p className="text-xs text-slate-400 mt-1">
                      {item.itemCount} itens · pedido por {item.requestedByName} em {formatDateTimeBR(item.requestedAt)}
                      {item.sourceTicket ? ` · ticket ${item.sourceTicket}` : ''}
                    </p>
                    {item.notes && <p className="text-xs text-slate-300 mt-1">{item.notes}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === item.id} onClick={() => decide(item, 'approve')}>
                      <CheckCircle2 aria-hidden="true" /> Aprovar
                    </button>
                    <button type="button" className="btn btn--sm btn--quiet btn--danger" disabled={busy === item.id} onClick={() => setRejecting(item)}>
                      <XCircle aria-hidden="true" /> Recusar
                    </button>
                  </div>
                </div>
                <p className="font-mono text-[11px] text-slate-400 mt-2 break-all">
                  {item.sample.join('  ')}{item.itemCount > item.sample.length ? `  … +${item.itemCount - item.sample.length}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="data-panel">
          <header className="data-panel__header"><h2>Decididas recentemente</h2></header>
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 760 }}>
              <thead><tr><th>Cliente</th><th>Tipo</th><th>Itens</th><th>Pedido por</th><th>Decisão</th><th>Observação</th></tr></thead>
              <tbody>
                {decided.map((item) => (
                  <tr key={item.id}>
                    <td className="text-white">{item.clientName}</td>
                    <td>{item.mode === 'replace' ? 'Substituir' : 'Adicionar'}</td>
                    <td className="font-mono">{item.itemCount}</td>
                    <td>{item.requestedByName}</td>
                    <td>
                      <span className={item.status === 'approved' ? 'chip chip--ok' : 'chip chip--danger'}>{item.status === 'approved' ? 'Aprovada' : 'Recusada'}</span>
                      <small className="block text-slate-500 mt-1">{item.decidedBy} · {formatDateTimeBR(item.decidedAt)}</small>
                    </td>
                    <td><span className="data-table__clamp">{item.decisionNote || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Recusar importação"
        subtitle={rejecting ? `${rejecting.clientName} · ${rejecting.itemCount} itens de ${rejecting.requestedByName}` : ''}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRejecting(null)}>Cancelar</button>
            <button type="button" className="btn btn--danger" disabled={!rejecting || busy === rejecting.id} onClick={() => rejecting && decide(rejecting, 'reject', note)}>Recusar</button>
          </>
        }
      >
        <label className="field-label" htmlFor="reject-note">Motivo (aparece para quem pediu)</label>
        <textarea id="reject-note" className="field w-full py-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Modal>
    </div>
  );
};

// ---------- Auditoria ----------

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.failed': 'Senha errada',
  'auth.locked': 'Conta bloqueada por tentativas',
  'user.create': 'Criou usuário',
  'user.update': 'Alterou usuário',
  'user.delete': 'Apagou usuário',
  'user.reset_password': 'Redefiniu senha',
  'user.change_password': 'Trocou a própria senha',
  'user.unlock': 'Liberou conta',
  'session.revoke': 'Encerrou sessão',
  'session.revoke_all': 'Encerrou todas as sessões',
  'client.save': 'Salvou cliente',
  'client.rename': 'Renomeou cliente',
  'client.update': 'Editou cliente',
  'client.delete': 'Apagou cliente',
  'client.archive': 'Arquivou cliente',
  'client.unarchive': 'Reativou cliente',
  'client.exceptions': 'Alterou exceções',
  'entries.import': 'Importou lista',
  'entries.dedupe': 'Retirou repetidos/cobertos',
  'entries.delete': 'Excluiu itens',
  'entries.clear': 'Zerou lista',
  'entry.status': 'Mudou situação de item',
  'snapshot.restore': 'Restaurou versão',
  'snapshot.delete': 'Apagou versão',
  'settings.save': 'Alterou ajustes',
  'backup.restore': 'Restaurou backup completo',
  'import.pending': 'Enviou importação para aprovação',
  'import.approve': 'Aprovou importação',
  'import.reject': 'Recusou importação',
  'review.keep': 'Manteve na revisão',
  'review.remove': 'Removeu na revisão',
  'comment.add': 'Comentou',
  'job.backup': 'Backup automático',
  'job.backup.failed': 'Falha no backup automático',
  'job.monthly_report': 'Relatório mensal enviado',
  'job.monthly_report.failed': 'Falha no relatório mensal'
};

function describeDetail(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  const d = detail as Record<string, any>;
  if (d.name) parts.push(String(d.name));
  if (d.username) parts.push(String(d.username));
  if (d.indicator) parts.push(String(d.indicator));
  if (d.added !== undefined) parts.push(`+${d.added}`);
  if (d.removed) parts.push(`-${d.removed}`);
  if (d.count !== undefined) parts.push(`${d.count} itens`);
  if (d.items !== undefined) parts.push(`${d.items} itens`);
  if (d.mode) parts.push(d.mode === 'replace' ? 'substituir' : 'adicionar');
  if (d.status) parts.push(d.status === 'removed' ? 'removido' : 'ativo');
  if (d.role) parts.push(d.role === 'admin' ? 'administrador' : 'analista');
  if (d.renamedTo) parts.push(`→ ${d.renamedTo}`);
  if (d.error) parts.push(String(d.error));
  if (d.note) parts.push(`"${d.note}"`);
  return parts.join(' · ');
}

const AuditPanel: React.FC = () => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<Array<{ username: string; displayName: string }>>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [filters, setFilters] = useState({ username: '', action: '', q: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const PAGE = 100;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      getAuditLog({
        username: filters.username || undefined,
        action: filters.action || undefined,
        q: filters.q || undefined,
        from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
        to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
        offset,
        limit: PAGE
      })
        .then((r) => {
          if (cancelled) return;
          setRows(r.rows);
          setTotal(r.total);
          setUsers(r.users);
          setActions(r.actions);
        })
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters, offset]);

  const set = (patch: Partial<typeof filters>) => {
    setOffset(0);
    setFilters((f) => ({ ...f, ...patch }));
  };

  return (
    <div className="space-y-4">
      <div className="toolbar">
        <div className="toolbar__group">
          <select className="field" value={filters.username} onChange={(e) => set({ username: e.target.value })} aria-label="Pessoa">
            <option value="">Todas as pessoas</option>
            {users.map((u) => <option key={u.username} value={u.username}>{u.displayName}</option>)}
          </select>
          <select className="field" value={filters.action} onChange={(e) => set({ action: e.target.value })} aria-label="Ação">
            <option value="">Todas as ações</option>
            {actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
          </select>
          <input type="date" className="field" value={filters.from} onChange={(e) => set({ from: e.target.value })} aria-label="De" />
          <input type="date" className="field" value={filters.to} onChange={(e) => set({ to: e.target.value })} aria-label="Até" />
        </div>
        <label className="field field--search">
          <Search aria-hidden="true" />
          <input placeholder="Buscar cliente, IP, nome…" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </label>
      </div>

      <section className="data-panel">
        <header className="data-panel__header">
          <h2>Registro de atividades</h2>
          <span>{total.toLocaleString('pt-BR')} eventos</span>
        </header>
        <div className="overflow-x-auto">
          <table className={`data-table ${loading ? 'opacity-60' : ''}`} style={{ minWidth: 820 }}>
            <thead><tr><th style={{ width: 150 }}>Quando</th><th style={{ width: 160 }}>Quem</th><th style={{ width: 240 }}>O quê</th><th>Detalhes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-[0.72rem] whitespace-nowrap">{formatDateTimeBR(r.at)}</td>
                  <td>{users.find((u) => u.username === r.username)?.displayName || r.username || '—'}</td>
                  <td className={r.action.endsWith('failed') || r.action === 'auth.locked' ? 'text-rose-400' : 'text-white'}>{ACTION_LABEL[r.action] || r.action}</td>
                  <td><span className="data-table__clamp" title={JSON.stringify(r.detail)}>{describeDetail(r.detail) || '—'}</span></td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={4} className="text-center text-slate-500 py-8">Nenhum evento com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-end gap-2 p-3 text-xs text-slate-400">
            {offset + 1}–{Math.min(offset + PAGE, total)} de {total}
            <button type="button" className="btn btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anteriores</button>
            <button type="button" className="btn btn--sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Próximos</button>
          </div>
        )}
      </section>
    </div>
  );
};

// ---------- Status do sistema ----------

const Dot: React.FC<{ state: 'ok' | 'bad' | 'warn' | 'off' }> = ({ state }) => (
  <span className={`status-dot ${state === 'ok' ? 'is-ok' : state === 'bad' ? 'is-bad' : state === 'warn' ? 'is-warn' : ''}`} aria-hidden="true" />
);

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
}

const StatusPanel: React.FC<{ showToast: ShowToast }> = ({ showToast }) => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ctiTest, setCtiTest] = useState<Awaited<ReturnType<typeof testCtiKeys>> | null>(null);
  const [aiTest, setAiTest] = useState<Awaited<ReturnType<typeof testAi>> | null>(null);

  const load = useCallback(() => {
    getSystemStatus().then(setStatus).catch((e) => showToast(e.message, 'info'));
  }, [showToast]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    try {
      await fn();
      showToast(okText);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falhou.', 'warn');
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <div className="data-panel empty-state"><Loader2 className="animate-spin" aria-hidden="true" /><p>Verificando…</p></div>;
  const job = (name: 'backup' | 'monthly_report') => status.jobs.find((j) => j.job === name);
  const backup = job('backup');
  const monthly = job('monthly_report');
  const anyCti = status.cti.abuseIpDb || status.cti.greyNoise || status.cti.otx;
  const proxyLooksShared = status.proxy.seenIp && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|::ffff:127\.)/.test(status.proxy.seenIp);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn btn--sm" onClick={load}><RefreshCw aria-hidden="true" /> Atualizar</button>
      </div>
      <div className="status-grid">
        <div className="status-card">
          <h3><Database aria-hidden="true" /> Banco de dados</h3>
          <dl>
            <dt>Situação</dt><dd><Dot state={status.database.ok ? 'ok' : 'bad'} />{status.database.ok ? 'Respondendo' : status.database.error}</dd>
            <dt>Tipo</dt><dd>{status.database.kind === 'postgres' ? 'Postgres (Neon)' : 'Local temporário (PGlite)'}</dd>
            <dt>Latência</dt><dd>{status.database.latencyMs} ms</dd>
            <dt>Clientes</dt><dd>{status.database.clients}</dd>
            <dt>Indicadores ativos</dt><dd>{status.database.entries?.toLocaleString('pt-BR')}</dd>
            <dt>Usuários ativos</dt><dd>{status.database.users}</dd>
          </dl>
          {status.database.kind !== 'postgres' && <p className="text-[11px] text-amber-300 mt-3">Sem DATABASE_URL: os dados somem quando o servidor reinicia.</p>}
        </div>

        <div className="status-card">
          <h3><KeyRound aria-hidden="true" /> Chaves de reputação</h3>
          <dl>
            <dt>AbuseIPDB</dt><dd><Dot state={status.cti.abuseIpDb ? 'ok' : 'off'} />{status.cti.abuseIpDb ? 'Configurada' : 'Ausente'}</dd>
            <dt>GreyNoise</dt><dd><Dot state={status.cti.greyNoise ? 'ok' : 'off'} />{status.cti.greyNoise ? 'Configurada' : 'Ausente'}</dd>
            <dt>OTX</dt><dd><Dot state={status.cti.otx ? 'ok' : 'off'} />{status.cti.otx ? 'Configurada' : 'Ausente'}</dd>
            <dt>IPs em cache</dt><dd>{status.cti.cachedIps.toLocaleString('pt-BR')}</dd>
          </dl>
          {ctiTest?.result && (
            <div className="mt-3 text-[11px] text-slate-300 space-y-1">
              <div>Teste com 8.8.8.8: <VerdictBadge summary={ctiTest.result} /></div>
              {ctiTest.result.errors?.map((e) => <div key={e} className="text-rose-400">{e}</div>)}
            </div>
          )}
          <button type="button" className="btn btn--sm mt-3" disabled={!anyCti || busy === 'cti'} onClick={() => run('cti', async () => setCtiTest(await testCtiKeys()), 'Teste das chaves concluído.')}>
            Testar chaves (gasta 1 consulta de cada)
          </button>
        </div>

        <div className="status-card">
          <h3><Mail aria-hidden="true" /> E-mail</h3>
          <dl>
            <dt>SMTP</dt><dd><Dot state={status.email.configured ? 'ok' : 'off'} />{status.email.configured ? 'Configurado' : 'Não configurado'}</dd>
            <dt>Relatório mensal</dt><dd>{status.email.reportRecipients} destinatário(s)</dd>
            <dt>Backup diário</dt><dd>{status.email.backupRecipients} destinatário(s)</dd>
          </dl>
          {!status.email.configured && (
            <p className="text-[11px] text-slate-400 mt-3">Defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, REPORT_EMAILS e BACKUP_EMAILS no Render.</p>
          )}
          <button type="button" className="btn btn--sm mt-3" disabled={!status.email.configured || busy === 'mail'} onClick={() => run('mail', testEmail, 'E-mail de teste enviado.')}>
            Enviar e-mail de teste
          </button>
        </div>

        <div className="status-card">
          <h3><Sparkles aria-hidden="true" /> Assistente de IA</h3>
          <dl>
            <dt>Situação</dt><dd><Dot state={status.ai?.configured ? 'ok' : 'off'} />{status.ai?.configured ? 'Configurado' : 'Desligado'}</dd>
            <dt>Modelo</dt><dd>{status.ai?.model || '—'}</dd>
            <dt>Servidor</dt><dd className="font-mono text-[0.72rem] break-all">{status.ai?.baseUrl || '—'}</dd>
            {aiTest?.ms !== undefined && (
              <>
                <dt>Teste</dt>
                <dd>
                  <Dot state="ok" />
                  {(aiTest.ms / 1000).toFixed(1)} s{aiTest.firstTokenMs != null ? ` (1ª palavra em ${(aiTest.firstTokenMs / 1000).toFixed(1)} s)` : ''}
                  {aiTest.tokens ? ` · ${Math.round(aiTest.tokens / (aiTest.ms / 1000))} tokens/s` : ''}
                </dd>
              </>
            )}
          </dl>
          {!status.ai?.configured && (
            <p className="text-[11px] text-slate-400 mt-3">Defina AI_BASE_URL e AI_MODEL (ex.: Ollama em http://localhost:11434/v1 com qwen3:8b).</p>
          )}
          <button type="button" className="btn btn--sm mt-3" disabled={!status.ai?.configured || busy === 'ai'} onClick={() => run('ai', async () => setAiTest(await testAi()), 'A IA respondeu.')}>
            {busy === 'ai' ? 'Testando…' : 'Testar resposta da IA'}
          </button>
        </div>

        <div className="status-card">
          <h3><Server aria-hidden="true" /> Rotinas automáticas</h3>
          <dl>
            <dt>Backup diário</dt>
            <dd><Dot state={backup?.lastError ? 'bad' : backup?.lastOkAt ? 'ok' : 'off'} />{backup?.lastOkAt ? formatDateTimeBR(backup.lastOkAt) : 'Nunca rodou'}</dd>
            {backup?.lastError && (<><dt>Último erro</dt><dd className="text-rose-400">{backup.lastError}</dd></>)}
            <dt>Relatório mensal</dt>
            <dd><Dot state={monthly?.lastError ? 'bad' : monthly?.lastOkAt ? 'ok' : 'off'} />{monthly?.lastOkAt ? formatDateTimeBR(monthly.lastOkAt) : 'Nunca rodou'}</dd>
            {monthly?.lastError && (<><dt>Último erro</dt><dd className="text-rose-400">{monthly.lastError}</dd></>)}
          </dl>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn--sm" disabled={!status.email.configured || busy === 'backup'} onClick={() => run('backup', () => runJob('backup'), 'Backup enviado por e-mail.')}>Enviar backup agora</button>
            <button type="button" className="btn btn--sm" disabled={!status.email.configured || busy === 'monthly'} onClick={() => run('monthly', () => runJob('monthly_report'), 'Relatório do mês passado enviado.')}>Enviar relatório do mês passado</button>
          </div>
        </div>

        <div className="status-card">
          <h3><Network aria-hidden="true" /> Proxy e IP de quem acessa</h3>
          <dl>
            <dt>Seu IP visto pelo servidor</dt><dd className="font-mono">{status.proxy.seenIp}</dd>
            <dt>Cadeia X-Forwarded-For</dt><dd className="font-mono">{status.proxy.forwardedChain || '—'}</dd>
            <dt>Saltos confiáveis</dt><dd>{String(status.proxy.trustProxyHops)}</dd>
          </dl>
          <p className="text-[11px] text-slate-400 mt-3">
            {proxyLooksShared
              ? 'O IP visto é interno: o limite de login pode estar contando todos juntos. Ajuste TRUST_PROXY_HOPS no Render.'
              : 'Confira se o IP acima é o seu IP público (busque "qual meu IP"). Se for, o limite de tentativas de login está separando cada pessoa corretamente.'}
          </p>
        </div>

        <div className="status-card">
          <h3><ShieldCheck aria-hidden="true" /> Operação</h3>
          <dl>
            <dt>Aprovações pendentes</dt><dd>{status.pendingApprovals}</dd>
            <dt>Última importação</dt>
            <dd>{status.lastImport ? `${status.lastImport.client} · ${formatDateTimeBR(status.lastImport.at)}` : '—'}</dd>
            {status.lastImport?.by && (<><dt>Por</dt><dd>{status.lastImport.by} (+{status.lastImport.added})</dd></>)}
            <dt>Versão</dt><dd className="font-mono">{status.version || 'local'}</dd>
            <dt>No ar há</dt><dd>{uptime(status.uptimeSeconds)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
};
