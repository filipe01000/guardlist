import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, ListFilter, Plus, Search, ShieldBan, UploadCloud, Users } from 'lucide-react';
import type { AppTab } from './Navbar';
import type { Client, ImportHistoryRecord, SessionUser } from '../types';
import { getHistoryRecords } from '../db/store';
import { getDaysSince } from '../utils/validator';
import './HomeView.css';

// Página principal depois do login: a porta de entrada para os serviços (bloqueios, cofre de senhas e os
// próximos). Cada pessoa vê só o que pode abrir; os avisos juntam o que pede atenção em todos os serviços.

interface HomeViewProps {
  currentUser: SessionUser;
  clients: Client[];
  totalActiveAcrossAll: number;
  addedThisWeekCount: number;
  slaDays: number;
  pendingApprovals: number;
  failedJobs: string[];
  daysSinceBackup: number | null;
  isBackupOutdated: boolean;
  onNavigate: (tab: AppTab) => void;
  onOpenApprovals: () => void;
  onOpenSystemStatus: () => void;
  onOpenQuickSearch: () => void;
}

type HomeAlert = { id: string; tone: 'danger' | 'warn'; text: React.ReactNode; onClick: () => void };

const fmt = new Intl.NumberFormat('pt-BR');

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function firstName(user: SessionUser): string {
  return (user.displayName || user.username).trim().split(/\s+/)[0];
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = getDaysSince(iso);
  if (days === 0) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Marca do cofre (rosquinha com fechadura), a mesma do DonutVault.
const DonutMark: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="92" fill="#1C1917" />
    <circle cx="100" cy="100" r="84" fill="#E3A857" />
    <circle cx="100" cy="100" r="71" fill="#1C1917" />
    <circle cx="100" cy="100" r="64" fill="#FF5CA8" />
    <g stroke="#1C1917" strokeWidth="2.5">
      <rect x="92" y="44" width="16" height="7" rx="3.5" fill="#38BDF8" transform="rotate(12 100 47)" />
      <rect x="134" y="62" width="16" height="7" rx="3.5" fill="#FFD90F" transform="rotate(40 142 65)" />
      <rect x="146" y="104" width="16" height="7" rx="3.5" fill="#38BDF8" transform="rotate(-62 154 107)" />
      <rect x="134" y="142" width="16" height="7" rx="3.5" fill="#4ADE80" transform="rotate(-20 142 145)" />
      <rect x="94" y="158" width="16" height="7" rx="3.5" fill="#FFFFFF" transform="rotate(-8 102 161)" />
      <rect x="54" y="142" width="16" height="7" rx="3.5" fill="#FFD90F" transform="rotate(22 62 145)" />
      <rect x="40" y="104" width="16" height="7" rx="3.5" fill="#FFFFFF" transform="rotate(62 48 107)" />
      <rect x="54" y="62" width="16" height="7" rx="3.5" fill="#4ADE80" transform="rotate(-32 62 65)" />
    </g>
    <circle cx="100" cy="88" r="20" fill="#0F1220" />
    <path d="M90 96L80 142H120L110 96Z" fill="#0F1220" />
  </svg>
);

export const HomeView: React.FC<HomeViewProps> = ({
  currentUser,
  clients,
  totalActiveAcrossAll,
  addedThisWeekCount,
  slaDays,
  pendingApprovals,
  failedJobs,
  daysSinceBackup,
  isBackupOutdated,
  onNavigate,
  onOpenApprovals,
  onOpenSystemStatus,
  onOpenQuickSearch
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [history, setHistory] = useState<ImportHistoryRecord[] | null>(null);

  useEffect(() => {
    getHistoryRecords().then((records) => setHistory(records.slice(0, 5))).catch(() => setHistory([]));
  }, [clients]);

  const activeClients = useMemo(() => clients.filter((c) => !c.isArchived), [clients]);
  const lateClients = useMemo(
    () =>
      activeClients.filter((c) => {
        const days = getDaysSince(c.lastUpdateDate);
        return days === null || days > slaDays;
      }),
    [activeClients, slaDays]
  );

  const alerts: HomeAlert[] = [];
  if (isAdmin && pendingApprovals > 0) {
    alerts.push({
      id: 'approvals',
      tone: 'danger',
      text: <><b>{pendingApprovals === 1 ? '1 importação' : `${pendingApprovals} importações`}</b> aguardando aprovação</>,
      onClick: onOpenApprovals
    });
  }
  if (isAdmin && failedJobs.length > 0) {
    alerts.push({
      id: 'jobs',
      tone: 'danger',
      text: <>Rotina automática com falha: <b>{failedJobs.map((j) => (j === 'backup' ? 'backup diário' : 'relatório mensal')).join(', ')}</b></>,
      onClick: onOpenSystemStatus
    });
  }
  if (lateClients.length > 0) {
    alerts.push({
      id: 'late',
      tone: 'warn',
      text:
        lateClients.length === 1
          ? <><b>{lateClients[0].name}</b> sem importação no prazo de {slaDays} dias</>
          : <><b>{lateClients.length} clientes</b> sem importação no prazo de {slaDays} dias</>,
      onClick: () => onNavigate('dashboard')
    });
  }
  if (isBackupOutdated) {
    alerts.push({
      id: 'backup',
      tone: 'warn',
      text: daysSinceBackup === null ? <>Nenhum <b>backup</b> registrado ainda</> : <>Último backup há <b>{daysSinceBackup} dias</b></>,
      onClick: () => onNavigate('backup')
    });
  }

  const now = new Date();
  const today = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="home">
      <header className="home__hello">
        <h1>{greeting(now)}, {firstName(currentUser)}</h1>
        <p>{today.charAt(0).toUpperCase() + today.slice(1)} · tudo o que você acompanha, num lugar só.</p>
      </header>

      <div className="home__alerts" aria-label="Avisos">
        {alerts.length === 0 ? (
          <div className="home-alert">
            <span className="home-alert__pip home-alert__pip--ok" aria-hidden="true" />
            <span>Tudo em dia. Nenhum aviso agora.</span>
          </div>
        ) : (
          alerts.map((a) => (
            <button key={a.id} type="button" className="home-alert" onClick={a.onClick}>
              <span className={`home-alert__pip home-alert__pip--${a.tone}`} aria-hidden="true" />
              <span>{a.text}</span>
              <ArrowRight className="home-alert__go" aria-hidden="true" />
            </button>
          ))
        )}
      </div>

      <h2 className="home__label">Serviços</h2>
      <div className="home__services">
        <section className="home-svc" style={{ '--tone': 'var(--action)' } as React.CSSProperties} aria-labelledby="svc-blocks">
          <div className="home-svc__head">
            <span className="home-svc__icon"><ShieldBan aria-hidden="true" /></span>
            <div className="home-svc__title">
              <h3 id="svc-blocks">Bloqueios</h3>
              <p>Listas de IPs e redes por cliente</p>
            </div>
            {lateClients.length > 0 ? (
              <span className="home-svc__state home-svc__state--warn">{lateClients.length} fora do prazo</span>
            ) : (
              <span className="home-svc__state home-svc__state--ok">No prazo</span>
            )}
          </div>
          <div className="home-svc__kpis">
            <div><b>{fmt.format(activeClients.length)}</b><small>clientes</small></div>
            <div><b>{fmt.format(totalActiveAcrossAll)}</b><small>bloqueios</small></div>
            <div><b>+{fmt.format(addedThisWeekCount)}</b><small>esta semana</small></div>
          </div>
          <div className="home-svc__foot">
            <button type="button" className="btn btn--primary" onClick={() => onNavigate('dashboard')}>Abrir painel</button>
            <button type="button" className="btn" onClick={() => onNavigate('import')}>
              <UploadCloud aria-hidden="true" />
              Importar lista
            </button>
          </div>
        </section>

        {currentUser.vaultAccess && (
          <section className="home-svc home-svc--vault" style={{ '--tone': '#FFD90F' } as React.CSSProperties} aria-labelledby="svc-vault">
            <div className="home-svc__head">
              <span className="home-svc__icon home-svc__icon--plain"><DonutMark /></span>
              <div className="home-svc__title">
                <h3 id="svc-vault">Cofre de senhas</h3>
                <p>DonutVault · cifrado no seu navegador</p>
              </div>
              <span className="home-svc__state">Trancado</span>
            </div>
            <p className="home-svc__note">
              Abre com a Senha Mestra. Até lá, nem o GuardList nem o servidor conseguem ver o que está guardado, por
              isso os números do cofre só aparecem lá dentro.
            </p>
            <div className="home-svc__foot">
              <button type="button" className="btn home-svc__vault-btn" onClick={() => onNavigate('vault')}>Abrir cofre</button>
            </div>
          </section>
        )}

        {currentUser.isMaster && (
          <section className="home-svc home-svc--soon" aria-labelledby="svc-next">
            <div className="home-svc__head">
              <span className="home-svc__icon"><Plus aria-hidden="true" /></span>
              <div className="home-svc__title">
                <h3 id="svc-next">Próximo serviço</h3>
                <p>Espaço reservado · só o master vê</p>
              </div>
            </div>
            <p className="home-svc__note">
              Cada serviço novo entra como um cartão aqui e uma seção no menu, com a mesma regra do cofre: o master
              decide quem vê.
            </p>
          </section>
        )}
      </div>

      <div className="home__lower">
        <section className="home-panel" aria-labelledby="home-activity">
          <div className="home-panel__head">
            <h2 id="home-activity">Atividade recente</h2>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => onNavigate('history')}>Ver histórico</button>
          </div>
          {history === null ? (
            <p className="home-panel__empty">Carregando…</p>
          ) : history.length === 0 ? (
            <p className="home-panel__empty">Nenhuma importação registrada ainda.</p>
          ) : (
            <ul className="home-activity">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="home-alert__pip" aria-hidden="true" />
                  <span>
                    {h.importedBy ? <><b>{h.importedBy}</b> importou</> : 'Importação de'}{' '}
                    <b className="font-mono">+{fmt.format(h.addedCount)}</b> em {h.clientName}
                  </span>
                  <time dateTime={h.date}>{timeLabel(h.date)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-panel" aria-labelledby="home-shortcuts">
          <div className="home-panel__head">
            <h2 id="home-shortcuts">Atalhos</h2>
          </div>
          <div className="home-quick">
            <button type="button" onClick={onOpenQuickSearch}>
              <Search aria-hidden="true" />
              <span>Consultar IPs<small>Em todas as listas</small></span>
              <kbd>Ctrl K</kbd>
            </button>
            <button type="button" onClick={() => onNavigate('import')}>
              <UploadCloud aria-hidden="true" />
              <span>Nova importação<small>Bloqueios</small></span>
            </button>
            <button type="button" onClick={() => onNavigate('review')}>
              <ClipboardCheck aria-hidden="true" />
              <span>Revisão de bloqueios<small>Bloqueios</small></span>
            </button>
            {isAdmin ? (
              <button type="button" onClick={() => onNavigate('admin')}>
                <Users aria-hidden="true" />
                <span>Usuários<small>Administração</small></span>
              </button>
            ) : (
              <button type="button" onClick={() => onNavigate('client-list')}>
                <ListFilter aria-hidden="true" />
                <span>Listas dos clientes<small>Bloqueios</small></span>
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
