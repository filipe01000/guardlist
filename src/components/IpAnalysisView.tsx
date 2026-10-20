import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileSignature, Fingerprint, Info, Loader2, RefreshCw, Search, ShieldOff, ShieldPlus, Sparkles } from 'lucide-react';
import type { CidrAnalysis, Client, IpAnalysis } from '../types';
import { analyzeCidr, analyzeIp, lookupIndicators, type LookupMatch } from '../db/store';
import { exceptionHit, toRange } from '../utils/redundancy';
import { abuseCategory } from '../utils/abuseCategories';
import { PageHeader } from './PageHeader';
import { VERDICT_LABEL } from './CtiBits';
import { ANALYZE_PARAM, aiAvailability, openIpAnalysisTab, requestCaseBuilder, requestIndicatorAction } from './contextActions';
import './IpAnalysis.css';

interface IpAnalysisViewProps {
  clients: Client[];
  /** IP ou rede já preenchido ao abrir (ex.: "Analisar IP" no botão direito, em outra aba). */
  seed?: string;
  isAdmin: boolean;
  onNavigateToClientList: (clientId: string) => void;
}

// force: consulta as fontes de novo em vez de usar a consulta recente guardada no servidor.
type Target = { kind: 'ip' | 'cidr'; value: string; force?: boolean };

const MATCH_LABEL = { exact: 'Na lista', covered: 'Dentro de', inside: 'Contém' } as const;

// IP solto (v4 ou v6) ou rede IPv4 com /prefixo: o AbuseIPDB só consulta redes IPv4.
function parseTarget(raw: string): Target | null {
  const value = raw.trim().toLowerCase();
  const range = toRange(value);
  if (!range) return null;
  if (!value.includes('/')) return { kind: 'ip', value };
  if (range.family !== 4) return null;
  const [address, prefix] = value.split('/');
  return { kind: 'cidr', value: `${address}/${Number(prefix)}` };
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const scoreLevel = (score: number | null) => (score === null ? 'none' : score >= 75 ? 'high' : score >= 25 ? 'medium' : 'low');

const abuseUrl = (t: Target) =>
  t.kind === 'ip' ? `https://www.abuseipdb.com/check/${encodeURIComponent(t.value)}` : `https://www.abuseipdb.com/check-block/${t.value}`;

// Página de análise no estilo do AbuseIPDB: reputação de um IP (ou IPs denunciados de uma rede),
// onde está no GuardList e ações rápidas.
export const IpAnalysisView: React.FC<IpAnalysisViewProps> = ({ clients, seed, isAdmin, onNavigateToClientList }) => {
  const [query, setQuery] = useState(seed ?? '');
  const [target, setTarget] = useState<Target | null>(null);
  const [ipResult, setIpResult] = useState<IpAnalysis | null>(null);
  const [cidrResult, setCidrResult] = useState<CidrAnalysis | null>(null);
  const [matches, setMatches] = useState<LookupMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = (value: string, force = false) => {
    const parsed = parseTarget(value);
    if (!parsed) {
      setError('Informe um IP (IPv4 ou IPv6) ou uma rede IPv4 no formato 192.0.2.0/24.');
      return;
    }
    setError(null);
    setTarget({ ...parsed, force });
  };

  useEffect(() => {
    if (seed) {
      setQuery(seed);
      run(seed);
    }
  }, [seed]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setIpResult(null);
    setCidrResult(null);
    setMatches([]);
    // Link da aba: ?analisar= com o IP/rede atual, para recarregar ou enviar a alguém.
    const url = new URL(window.location.href);
    url.searchParams.set(ANALYZE_PARAM, target.value);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    // A parte do GuardList não depende das chaves de reputação: busca as duas em paralelo.
    const reputation = target.kind === 'ip' ? analyzeIp(target.value, target.force) : analyzeCidr(target.value, target.force);
    Promise.allSettled([reputation, lookupIndicators([target.value])]).then(([rep, look]) => {
      if (cancelled) return;
      if (rep.status === 'fulfilled') {
        if (target.kind === 'ip') setIpResult(rep.value as IpAnalysis);
        else setCidrResult(rep.value as CidrAnalysis);
      } else {
        setError(rep.reason instanceof Error ? rep.reason.message : 'Não foi possível consultar a reputação.');
      }
      if (look.status === 'fulfilled') setMatches(look.value[0]?.matches ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [target]);

  const exceptionsHit = useMemo(() => {
    if (!target) return [];
    return clients
      .filter((c) => !c.isArchived && c.exceptions?.length)
      .map((c) => ({ client: c, hit: exceptionHit(target.value, (c.exceptions ?? []).map((e) => e.indicator)) }))
      .filter((x): x is { client: Client; hit: string } => Boolean(x.hit));
  }, [target, clients]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const report of ipResult?.detail?.reports ?? []) for (const cat of report.categories) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ipResult]);

  const copyValue = async () => {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* sem permissão de área de transferência */ }
  };

  const actions = target && (
    <div className="ipa__actions">
      <a className="btn btn--primary" href={abuseUrl(target)} target="_blank" rel="noreferrer noopener" title="Abre a página do AbuseIPDB numa aba nova para conferir">
        <ExternalLink aria-hidden="true" />Ver no AbuseIPDB
      </a>
      <button type="button" className="btn" onClick={() => requestIndicatorAction('block', target.value)}><ShieldPlus aria-hidden="true" />Bloquear em clientes</button>
      {isAdmin && <button type="button" className="btn" onClick={() => requestIndicatorAction('exception', target.value)}><ShieldOff aria-hidden="true" />Adicionar exceção</button>}
      <button type="button" className="btn" onClick={() => requestCaseBuilder([target.value])}><FileSignature aria-hidden="true" />Gerar caso</button>
      {aiAvailability.enabled && <button type="button" className="btn" onClick={() => requestIndicatorAction('ai', target.value)}><Sparkles aria-hidden="true" />Perguntar à IA</button>}
      <button type="button" className="btn btn--quiet" onClick={copyValue}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copiado' : 'Copiar'}</button>
    </div>
  );

  const active = matches.filter((m) => m.status === 'active');
  const removed = matches.filter((m) => m.status === 'removed');

  const guardListPanel = (
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
  );

  return (
    <div className="ipa view-enter">
      <PageHeader
        title="Análise de IP"
        description="Reputação, denúncias recentes e onde o IP (ou a rede) está nas listas dos clientes."
      />

      <form className="ipa__search" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <Search aria-hidden="true" />
        <input
          className="ipa__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cole um IP ou uma rede, ex.: 185.220.101.5 ou 193.32.162.0/24"
          aria-label="IP ou rede CIDR para analisar"
          spellCheck={false}
          autoFocus={!seed}
        />
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          Analisar
        </button>
      </form>

      {error && <p className="notice notice--danger" role="alert">{error}</p>}

      {target && !loading && (ipResult || cidrResult) && (
        <div className="ipa__stamp">
          <span>
            {(ipResult ?? cidrResult)?.cached ? 'Consulta guardada de ' : 'Consultado em '}
            {fmtDate((ipResult ?? cidrResult)?.fetchedAt)}
            {(ipResult ?? cidrResult)?.cached ? ' (sem gastar cota)' : ''}
          </span>
          <button type="button" className="btn btn--sm btn--quiet" onClick={() => run(target.value, true)} title="Consulta as fontes de novo, gastando uma consulta da cota">
            <RefreshCw aria-hidden="true" />
            Consultar de novo
          </button>
        </div>
      )}

      {!target && !error && (
        <div className="empty-state ipa__empty">
          <Search aria-hidden="true" />
          <p>Cole um IP ou uma rede CIDR acima, ou clique com o botão direito em qualquer IP do app e escolha "Analisar IP".</p>
        </div>
      )}

      {target?.kind === 'ip' && (() => {
        const summary = ipResult?.summary;
        const detail = ipResult?.detail;
        const configured = ipResult ? Object.values(ipResult.configured).some(Boolean) : true;
        const score = summary?.score ?? null;
        return (
          <>
            <section className="ipa__hero data-panel" aria-busy={loading}>
              <div className="ipa__hero-main">
                <div className="ipa__ip">
                  <span className="font-mono">{target.value}</span>
                  {summary && <span className={`verdict verdict--${summary.verdict}`} title={summary.verdictReason || undefined}>{VERDICT_LABEL[summary.verdict]}</span>}
                </div>
                {summary?.verdictReason && <p className="ipa__reason">{summary.verdictReason}</p>}

                <div className="ipa__score" aria-label={score === null ? 'Sem nota de abuso' : `Nota de abuso ${score} de 100`}>
                  <div className="ipa__score-head">
                    <span>Nota de abuso (AbuseIPDB)</span>
                    <strong>{loading ? '…' : score === null ? '—' : `${score}%`}</strong>
                  </div>
                  <div className="ipa__bar"><i style={{ width: `${score ?? 0}%` }} data-level={scoreLevel(score)} /></div>
                </div>

                {actions}
              </div>

              <dl className="ipa__facts">
                <div><dt>Denúncias (12 meses)</dt><dd>{summary?.totalReports ?? '—'}{detail?.distinctUsers != null ? <small> de {detail.distinctUsers} {detail.distinctUsers === 1 ? 'fonte' : 'fontes'}</small> : null}</dd></div>
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

            {detail?.isWhitelisted && (
              <p className="notice"><Info aria-hidden="true" />O AbuseIPDB coloca este IP na lista branca (serviço conhecido, como scanners de pesquisa). Por isso a nota de abuso fica em 0%, mesmo que ele tenha sido denunciado antes.</p>
            )}
            {!loading && !configured && (
              <p className="notice">Reputação indisponível: nenhuma chave de AbuseIPDB, GreyNoise ou OTX configurada no servidor. A parte do GuardList abaixo continua valendo.</p>
            )}
            {summary?.errors?.length ? <p className="notice notice--warn">{summary.errors.join(' · ')}</p> : null}

            <div className="ipa__grid">
              {guardListPanel}
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
                <span>AbuseIPDB · últimos 12 meses</span>
              </header>
              {!detail?.reports.length ? (
                <p className="ipa__muted ipa__pad">{loading ? 'Consultando…' : 'Sem denúncias nos últimos 12 meses.'}</p>
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
        );
      })()}

      {target?.kind === 'cidr' && (() => {
        const detail = cidrResult?.detail;
        const reported = detail?.reported ?? [];
        const worst = reported[0]?.score ?? null;
        return (
          <>
            <section className="ipa__hero data-panel" aria-busy={loading}>
              <div className="ipa__hero-main">
                <div className="ipa__ip">
                  <span className="font-mono">{target.value}</span>
                  <span className="data-tag">Rede</span>
                </div>
                <div className="ipa__score">
                  <div className="ipa__score-head">
                    <span>Maior nota de abuso na rede</span>
                    <strong>{loading ? '…' : worst === null ? '—' : `${worst}%`}</strong>
                  </div>
                  <div className="ipa__bar"><i style={{ width: `${worst ?? 0}%` }} data-level={scoreLevel(worst)} /></div>
                </div>
                {actions}
              </div>
              <dl className="ipa__facts">
                <div><dt>IPs denunciados (30 dias)</dt><dd>{detail ? reported.length : '—'}{detail ? <small> de {detail.numPossibleHosts.toLocaleString('pt-BR')}</small> : null}</dd></div>
                <div><dt>Denúncias somadas</dt><dd>{detail ? reported.reduce((sum, r) => sum + r.numReports, 0).toLocaleString('pt-BR') : '—'}</dd></div>
                <div><dt>Com nota ≥ 75%</dt><dd>{detail ? reported.filter((r) => r.score >= 75).length : '—'}</dd></div>
                <div><dt>Primeiro endereço</dt><dd className="font-mono">{detail?.minAddress || '—'}</dd></div>
                <div><dt>Último endereço</dt><dd className="font-mono">{detail?.maxAddress || '—'}</dd></div>
                <div><dt>Máscara</dt><dd className="font-mono">{detail?.netmask || '—'}</dd></div>
                <div><dt>Tipo de endereço</dt><dd>{detail?.addressSpaceDesc || '—'}</dd></div>
                <div><dt>País (mais denunciado)</dt><dd>{reported[0]?.countryCode || '—'}</dd></div>
              </dl>
            </section>

            {cidrResult?.error && <p className="notice notice--warn">{cidrResult.error}</p>}
            {!loading && cidrResult && !cidrResult.configured && (
              <p className="notice">Reputação indisponível: a chave do AbuseIPDB não está configurada no servidor. A parte do GuardList abaixo continua valendo.</p>
            )}

            {guardListPanel}

            <section className="data-panel" aria-labelledby="ipa-net-title">
              <header className="data-panel__header">
                <h2 id="ipa-net-title">IPs denunciados nesta rede</h2>
                <span>AbuseIPDB · últimos 30 dias · os piores primeiro</span>
              </header>
              {!reported.length ? (
                <p className="ipa__muted ipa__pad">{loading ? 'Consultando…' : 'Nenhum IP desta rede foi denunciado nos últimos 30 dias.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table ipa__reports">
                    <colgroup>
                      <col style={{ width: '170px' }} />
                      <col style={{ width: '170px' }} />
                      <col style={{ width: '110px' }} />
                      <col />
                      <col style={{ width: '60px' }} />
                      <col style={{ width: '48px' }} />
                    </colgroup>
                    <thead>
                      <tr><th>IP</th><th>Nota de abuso</th><th>Denúncias</th><th>Última denúncia</th><th>País</th><th aria-label="Analisar" /></tr>
                    </thead>
                    <tbody>
                      {reported.map((r) => (
                        <tr key={r.ip}>
                          <td className="font-mono">{r.ip}</td>
                          <td>
                            <span className="ipa__mini">
                              <span className="ipa__bar"><i style={{ width: `${r.score}%` }} data-level={scoreLevel(r.score)} /></span>
                              <strong>{r.score}%</strong>
                            </span>
                          </td>
                          <td>{r.numReports.toLocaleString('pt-BR')}</td>
                          <td>{fmtDate(r.mostRecentReport)}</td>
                          <td>{r.countryCode ?? '—'}</td>
                          <td>
                            <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={() => openIpAnalysisTab(r.ip)} title="Analisar este IP numa aba nova" aria-label={`Analisar ${r.ip} numa aba nova`}>
                              <Fingerprint aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        );
      })()}
    </div>
  );
};
