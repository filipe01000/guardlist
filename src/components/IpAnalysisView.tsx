import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileSignature, Loader2, Search, ShieldOff, ShieldPlus, Sparkles } from 'lucide-react';
import type { Client, IpAnalysis } from '../types';
import { analyzeIp, lookupIndicators, type LookupMatch } from '../db/store';
import { exceptionHit, toRange } from '../utils/redundancy';
import { abuseCategory } from '../utils/abuseCategories';
import { PageHeader } from './PageHeader';
import { VERDICT_LABEL } from './CtiBits';
import { aiAvailability, requestCaseBuilder, requestIndicatorAction } from './contextActions';
import './IpAnalysis.css';

interface IpAnalysisViewProps {
  clients: Client[];
  /** IP já preenchido ao abrir (ex.: "Analisar IP" no botão direito). */
  seed?: string;
  isAdmin: boolean;
  onNavigateToClientList: (clientId: string) => void;
}

const MATCH_LABEL = { exact: 'Na lista', covered: 'Dentro de', inside: 'Contém' } as const;

const isSingleIp = (value: string) => !value.includes('/') && toRange(value) !== null;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

// Página de análise de um IP no estilo do AbuseIPDB: reputação, denúncias recentes, onde está no GuardList e ações.
export const IpAnalysisView: React.FC<IpAnalysisViewProps> = ({ clients, seed, isAdmin, onNavigateToClientList }) => {
  const [query, setQuery] = useState(seed ?? '');
  const [ip, setIp] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<IpAnalysis | null>(null);
  const [matches, setMatches] = useState<LookupMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = (value: string) => {
    const target = value.trim().toLowerCase();
    if (!isSingleIp(target)) {
      setError('Informe um único endereço IPv4 ou IPv6 (sem /CIDR).');
      return;
    }
    setError(null);
    setIp(target);
  };

  useEffect(() => {
    if (seed) {
      setQuery(seed);
      run(seed);
    }
  }, [seed]);

  useEffect(() => {
    if (!ip) return;
    let cancelled = false;
    setLoading(true);
    setAnalysis(null);
    setMatches([]);
    // A parte do GuardList não depende das chaves de reputação: busca as duas em paralelo.
    Promise.allSettled([analyzeIp(ip), lookupIndicators([ip])]).then(([rep, look]) => {
      if (cancelled) return;
      if (rep.status === 'fulfilled') setAnalysis(rep.value);
      else setError(rep.reason instanceof Error ? rep.reason.message : 'Não foi possível consultar a reputação.');
      if (look.status === 'fulfilled') setMatches(look.value[0]?.matches ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ip]);

  const exceptionsHit = useMemo(() => {
    if (!ip) return [];
    return clients
      .filter((c) => !c.isArchived && c.exceptions?.length)
      .map((c) => ({ client: c, hit: exceptionHit(ip, (c.exceptions ?? []).map((e) => e.indicator)) }))
      .filter((x): x is { client: Client; hit: string } => Boolean(x.hit));
  }, [ip, clients]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const report of analysis?.detail?.reports ?? []) for (const cat of report.categories) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [analysis]);

  const active = matches.filter((m) => m.status === 'active');
  const removed = matches.filter((m) => m.status === 'removed');
  const summary = analysis?.summary;
  const detail = analysis?.detail;
  const configured = analysis ? Object.values(analysis.configured).some(Boolean) : true;
  const score = summary?.score ?? null;

  const copyIp = async () => {
    if (!ip) return;
    try {
      await navigator.clipboard.writeText(ip);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* sem permissão de área de transferência */ }
  };

  return (
    <div className="ipa view-enter">
      <PageHeader
        title="Análise de IP"
        description="Reputação, denúncias recentes e onde o IP está nas listas dos clientes."
      />

      <form className="ipa__search" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <Search aria-hidden="true" />
        <input
          className="ipa__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cole um IP, ex.: 185.220.101.5"
          aria-label="Endereço IP para analisar"
          spellCheck={false}
          autoFocus={!seed}
        />
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          Analisar
        </button>
      </form>

      {error && <p className="notice notice--danger" role="alert">{error}</p>}

      {!ip && !error && (
        <div className="empty-state ipa__empty">
          <Search aria-hidden="true" />
          <p>Cole um IP acima, ou clique com o botão direito em qualquer IP do app e escolha "Analisar IP".</p>
        </div>
      )}

      {ip && (
        <>
          <section className="ipa__hero data-panel" aria-busy={loading}>
            <div className="ipa__hero-main">
              <div className="ipa__ip">
                <span className="font-mono">{ip}</span>
                {summary && <span className={`verdict verdict--${summary.verdict}`} title={summary.verdictReason || undefined}>{VERDICT_LABEL[summary.verdict]}</span>}
              </div>
              {summary?.verdictReason && <p className="ipa__reason">{summary.verdictReason}</p>}

              <div className="ipa__score" aria-label={score === null ? 'Sem nota de abuso' : `Nota de abuso ${score} de 100`}>
                <div className="ipa__score-head">
                  <span>Nota de abuso</span>
                  <strong>{loading ? '…' : score === null ? '—' : `${score}%`}</strong>
                </div>
                <div className="ipa__bar"><i style={{ width: `${score ?? 0}%` }} data-level={score === null ? 'none' : score >= 75 ? 'high' : score >= 25 ? 'medium' : 'low'} /></div>
              </div>

              <div className="ipa__actions">
                <button type="button" className="btn" onClick={() => requestIndicatorAction('block', ip)}><ShieldPlus aria-hidden="true" />Bloquear em clientes</button>
                {isAdmin && <button type="button" className="btn" onClick={() => requestIndicatorAction('exception', ip)}><ShieldOff aria-hidden="true" />Adicionar exceção</button>}
                <button type="button" className="btn" onClick={() => requestCaseBuilder([ip])}><FileSignature aria-hidden="true" />Gerar caso</button>
                {aiAvailability.enabled && <button type="button" className="btn" onClick={() => requestIndicatorAction('ai', ip)}><Sparkles aria-hidden="true" />Perguntar à IA</button>}
                <button type="button" className="btn btn--quiet" onClick={copyIp}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}</button>
                <a className="btn btn--quiet" href={`https://www.abuseipdb.com/check/${encodeURIComponent(ip)}`} target="_blank" rel="noreferrer noopener"><ExternalLink aria-hidden="true" />AbuseIPDB</a>
              </div>
            </div>

            <dl className="ipa__facts">
              <div><dt>Denúncias (90 dias)</dt><dd>{summary?.totalReports ?? '—'}{detail?.distinctUsers != null ? <small> de {detail.distinctUsers} {detail.distinctUsers === 1 ? 'fonte' : 'fontes'}</small> : null}</dd></div>
              <div><dt>Última denúncia</dt><dd>{fmtDate(summary?.lastReportedAt)}</dd></div>
              <div><dt>País</dt><dd>{detail?.countryName || summary?.countryCode || '—'}</dd></div>
              <div><dt>Provedor</dt><dd>{summary?.isp || '—'}</dd></div>
              <div><dt>ASN</dt><dd>{summary?.asn || '—'}</dd></div>
              <div><dt>Tipo de uso</dt><dd>{summary?.usageType || '—'}</dd></div>
              <div><dt>Domínio</dt><dd>{summary?.domain || '—'}</dd></div>
              <div><dt>Hostnames</dt><dd>{detail?.hostnames.length ? detail.hostnames.join(', ') : '—'}</dd></div>
              <div><dt>GreyNoise</dt><dd>{summary?.greyNoise ? [summary.greyNoise.classification, summary.greyNoise.riot ? 'serviço conhecido' : null, summary.greyNoise.name].filter(Boolean).join(' · ') || 'Não visto' : '—'}</dd></div>
              <div><dt>OTX (pulses)</dt><dd>{summary?.otxPulses ?? '—'}</dd></div>
              <div><dt>Tor</dt><dd>{detail ? (detail.isTor ? 'Sim, nó de saída Tor' : 'Não') : '—'}</dd></div>
              <div><dt>Lista branca AbuseIPDB</dt><dd>{detail?.isWhitelisted == null ? '—' : detail.isWhitelisted ? 'Sim' : 'Não'}</dd></div>
            </dl>
          </section>

          {!loading && !configured && (
            <p className="notice">Reputação indisponível: nenhuma chave de AbuseIPDB, GreyNoise ou OTX configurada no servidor. A parte do GuardList abaixo continua valendo.</p>
          )}
          {summary?.errors?.length ? <p className="notice notice--warn">{summary.errors.join(' · ')}</p> : null}

          <div className="ipa__grid">
            <section className="data-panel" aria-labelledby="ipa-gl-title">
              <header className="data-panel__header">
                <h2 id="ipa-gl-title">No GuardList</h2>
                <span>{loading ? 'Consultando…' : `${active.length} ${active.length === 1 ? 'lista ativa' : 'listas ativas'}`}</span>
              </header>
              <ul className="ipa__list">
                {!loading && matches.length === 0 && exceptionsHit.length === 0 && <li className="ipa__muted">Não está em nenhuma lista nem nas exceções.</li>}
                {active.map((m) => (
                  <li key={m.entryId}>
                    <button type="button" className="ipa__link" onClick={() => onNavigateToClientList(m.clientId)}>{m.clientName}</button>
                    <span className="data-tag">{MATCH_LABEL[m.match]}{m.match !== 'exact' ? ` ${m.indicator}` : ''}</span>
                    <small>desde {m.addedDate?.slice(0, 10)}{m.sourceTicket ? ` · ${m.sourceTicket}` : ''}</small>
                  </li>
                ))}
                {exceptionsHit.map(({ client, hit }) => (
                  <li key={`exc-${client.id}`}>
                    <button type="button" className="ipa__link" onClick={() => onNavigateToClientList(client.id)}>{client.name}</button>
                    <span className="data-tag ipa__tag--exception">Exceção {hit}</span>
                    <small>nunca é bloqueado neste cliente</small>
                  </li>
                ))}
                {removed.map((m) => (
                  <li key={m.entryId} className="ipa__muted">
                    <span>{m.clientName}</span>
                    <span className="data-tag">Removido</span>
                    <small>{m.removedAt ? `em ${m.removedAt.slice(0, 10)}` : ''}</small>
                  </li>
                ))}
              </ul>
            </section>

            <section className="data-panel" aria-labelledby="ipa-cat-title">
              <header className="data-panel__header">
                <h2 id="ipa-cat-title">Tipos de abuso denunciados</h2>
                <span>{detail ? `${detail.reports.length} denúncias recentes` : ''}</span>
              </header>
              {categoryCounts.length === 0 ? (
                <p className="ipa__muted ipa__pad">{loading ? 'Consultando…' : 'Nenhuma categoria nas denúncias recentes.'}</p>
              ) : (
                <ul className="ipa__cats">
                  {categoryCounts.map(([cat, count]) => (
                    <li key={cat}>
                      <span>{abuseCategory(cat)}</span>
                      <i style={{ width: `${Math.max(6, (count / categoryCounts[0][1]) * 100)}%` }} aria-hidden="true" />
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="data-panel" aria-labelledby="ipa-rep-title">
            <header className="data-panel__header">
              <h2 id="ipa-rep-title">Denúncias recentes</h2>
              <span>AbuseIPDB · últimos 90 dias</span>
            </header>
            {!detail?.reports.length ? (
              <p className="ipa__muted ipa__pad">{loading ? 'Consultando…' : 'Sem denúncias recentes.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table ipa__reports">
                  <colgroup>
                    <col style={{ width: '130px' }} />
                    <col style={{ width: '32%' }} />
                    <col />
                    <col style={{ width: '60px' }} />
                  </colgroup>
                  <thead>
                    <tr><th>Data</th><th>Categorias</th><th>Comentário</th><th>Origem</th></tr>
                  </thead>
                  <tbody>
                    {detail.reports.map((r, idx) => (
                      <tr key={`${r.reportedAt}-${idx}`}>
                        <td>{fmtDate(r.reportedAt)}</td>
                        <td><span className="ipa__chips">{r.categories.map((c) => <span key={c} className="data-tag">{abuseCategory(c)}</span>)}</span></td>
                        <td className="ipa__comment">{r.comment || <span className="ipa__muted">sem comentário</span>}</td>
                        <td>{r.reporterCountryCode ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
