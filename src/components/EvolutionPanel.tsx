import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Client } from '../types';
import { enrichIndicators, getEvolution, type Evolution } from '../db/store';
import { formatDateBR } from '../utils/csv';
import { VERDICT_LABEL } from './CtiBits';

// Gráficos de evolução: tamanho da lista ao longo do tempo, inclusões e remoções por semana,
// países e provedores mais bloqueados (a partir da reputação já consultada).

const LineChart: React.FC<{ points: Evolution['points'] }> = ({ points }) => {
  const W = 720;
  const H = 220;
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...points.map((p) => p.active));
  const maxBar = Math.max(1, ...points.map((p) => Math.max(p.added, p.removed)));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const barH = (v: number) => ((H - pad.t - pad.b) * 0.35 * v) / maxBar;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.active).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const step = Math.max(1, Math.ceil(points.length / 8));
  const bw = Math.max(2, ((W - pad.l - pad.r) / points.length) * 0.3);
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Total de indicadores ativos por semana">
      {ticks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end">{t.toLocaleString('pt-BR')}</text>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.date}>
          {p.added > 0 && <rect className="chart-bar-add" x={x(i) - bw - 1} y={H - pad.b - barH(p.added)} width={bw} height={barH(p.added)}><title>{`+${p.added} na semana até ${formatDateBR(p.date)}`}</title></rect>}
          {p.removed > 0 && <rect className="chart-bar-rem" x={x(i) + 1} y={H - pad.b - barH(p.removed)} width={bw} height={barH(p.removed)}><title>{`-${p.removed} na semana até ${formatDateBR(p.date)}`}</title></rect>}
        </g>
      ))}
      <path className="chart-area" d={area} />
      <path className="chart-line" d={line} />
      {points.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.active)} r={2.5} fill="var(--accent)">
          <title>{`${formatDateBR(p.date)}: ${p.active} ativos`}</title>
        </circle>
      ))}
      {points.map((p, i) => (i % step === 0 && points.length - 1 - i >= step / 2) || i === points.length - 1 ? (
        <text key={`l-${p.date}`} x={x(i)} y={H - 8} textAnchor="middle">{formatDateBR(p.date).slice(0, 5)}</text>
      ) : null)}
    </svg>
  );
};

const HBars: React.FC<{ items: Array<{ label: string; count: number }>; render?: (label: string) => React.ReactNode; empty: string }> = ({ items, render, empty }) => {
  if (items.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="hbar-list">
      {items.map((i) => (
        <div key={i.label} className="hbar">
          <span className="hbar__label" title={i.label}>{render ? render(i.label) : i.label}</span>
          <span className="hbar__track"><span className="hbar__fill" style={{ width: `${(i.count / max) * 100}%` }} /></span>
          <span className="hbar__value">{i.count}</span>
        </div>
      ))}
    </div>
  );
};

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
    return (code: string) => names.of(code.toUpperCase()) || code;
  } catch {
    return (code: string) => code;
  }
})();

export const EvolutionPanel: React.FC<{ clients: Client[] }> = ({ clients }) => {
  const [clientId, setClientId] = useState('ALL');
  const [weeks, setWeeks] = useState(26);
  const [data, setData] = useState<Evolution | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getEvolution({ weeks, clientId: clientId === 'ALL' ? undefined : clientId }).then(setData).catch(() => undefined);
  }, [weeks, clientId]);
  useEffect(load, [load]);

  const enrichMissing = async () => {
    if (!data || data.missing.length === 0) return;
    setEnriching(true);
    setNote(null);
    try {
      const result = await enrichIndicators(data.missing.slice(0, 100));
      if (!result.configured) setNote('Nenhuma chave de reputação configurada no servidor.');
      else setNote(`${Object.keys(result.results).length} IPs consultados.`);
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Falha na consulta.');
    } finally {
      setEnriching(false);
    }
  };

  const last = data?.points[data.points.length - 1];
  const first = data?.points[0];
  const delta = last && first ? last.active - first.active : 0;
  const coverage = useMemo(() => (data && data.activeIps ? Math.round((data.enriched / data.activeIps) * 100) : 0), [data]);

  return (
    <div className="space-y-5">
      <div className="toolbar">
        <div className="toolbar__group">
          <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Cliente">
            <option value="ALL">Todos os clientes</option>
            {clients.filter((c) => !c.isArchived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="Período">
            {[12, 26, 52].map((w) => (
              <button key={w} type="button" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>{w === 52 ? '1 ano' : `${w / 4 | 0} meses`}</button>
            ))}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="data-panel empty-state"><Loader2 className="animate-spin" aria-hidden="true" /></div>
      ) : (
        <>
          <section className="data-panel chart-card">
            <h3>Tamanho da lista ao longo do tempo</h3>
            <p>
              {last?.active.toLocaleString('pt-BR')} ativos hoje · {delta >= 0 ? '+' : ''}{delta.toLocaleString('pt-BR')} no período.
              Barras: <span className="text-emerald-400">incluídos</span> e <span className="text-rose-400">removidos</span> por semana.
            </p>
            <LineChart points={data.points} />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <section className="data-panel chart-card">
              <h3>Países de origem</h3>
              <p>IPs ativos com reputação consultada.</p>
              <HBars items={data.countries} empty="Sem dados de país ainda." render={(code) => <>{regionName(code)} <span className="text-slate-500">{code}</span></>} />
            </section>
            <section className="data-panel chart-card">
              <h3>Provedores (ASN) mais bloqueados</h3>
              <p>Pelo ASN do OTX ou provedor do AbuseIPDB.</p>
              <HBars items={data.providers} empty="Sem dados de provedor ainda." />
            </section>
            <section className="data-panel chart-card">
              <h3>Reputação dos IPs ativos</h3>
              <p>Classificação na última consulta.</p>
              <HBars items={data.verdicts} empty="Nenhum IP consultado." render={(v) => VERDICT_LABEL[v as keyof typeof VERDICT_LABEL] || v} />
            </section>
          </div>

          <div className="notice">
            <RefreshCw aria-hidden="true" />
            <p>
              {data.enriched.toLocaleString('pt-BR')} de {data.activeIps.toLocaleString('pt-BR')} IPs ativos têm reputação consultada ({coverage}%).
              Países e provedores aparecem conforme os IPs são consultados (na importação, na revisão ou aqui).
              {note ? ` ${note}` : ''}
            </p>
            {data.missing.length > 0 && (
              <button type="button" className="btn btn--sm" disabled={enriching} onClick={enrichMissing}>
                {enriching ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Consultar {Math.min(100, data.missing.length)} IPs sem dados
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
