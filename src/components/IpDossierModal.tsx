import React, { useEffect, useState } from 'react';
import { ShieldAlert, X, ExternalLink, Copy, Check, Clock, Building2, Radio, Fingerprint } from 'lucide-react';
import { BlocklistEntry, Client, IpAnalysis } from '../types';
import { analyzeIp } from '../db/store';
import { localDossier } from '../utils/ctiService';
import { abuseCategory } from '../utils/abuseCategories';
import { toRange } from '../utils/redundancy';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { formatDateBR } from '../utils/csv';
import { openIpAnalysisTab } from './contextActions';
import { VERDICT_LABEL } from './CtiBits';

interface IpDossierModalProps {
  indicator: string | null;
  onClose: () => void;
  allEntries: BlocklistEntry[];
  clients: Client[];
}

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

// Dossiê de um indicador: onde está nas listas (base local) e a reputação real das fontes externas.
// Nada é simulado: fonte sem resposta aparece como "sem dados".
export const IpDossierModal: React.FC<IpDossierModalProps> = ({ indicator, onClose, allEntries, clients }) => {
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState<IpAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus(Boolean(indicator));
  const isIp = Boolean(indicator && !indicator.includes('/') && toRange(indicator));

  useEffect(() => {
    if (!indicator || !isIp) return;
    let cancelled = false;
    setAnalysis(null);
    setError(null);
    setLoading(true);
    analyzeIp(indicator)
      .then((result) => { if (!cancelled) setAnalysis(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao consultar as fontes de reputação.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [indicator, isIp]);

  useEffect(() => {
    if (!indicator) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [indicator, onClose]);

  if (!indicator) return null;

  const clientsMap = new Map(clients.map(c => [c.id, c]));
  const local = localDossier(indicator, allEntries, clientsMap);
  const summary = analysis?.summary;
  const detail = analysis?.detail;
  const configured = analysis?.configured;
  const typeLabel = allEntries.find(e => e.indicator.toLowerCase() === indicator.toLowerCase())?.type
    ?? (indicator.includes('/') ? 'CIDR' : isIp ? (indicator.includes(':') ? 'IPv6' : 'IPv4') : 'Domínio');

  // Categorias reais: contagem das categorias nas denúncias recentes do AbuseIPDB.
  const categoryCounts = new Map<number, number>();
  for (const report of detail?.reports ?? []) for (const cat of report.categories) categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  const topCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const sourceStatus = (name: 'abuseIpDb' | 'greyNoise' | 'otx', answered: boolean, label: string) => {
    if (!configured) return null;
    const text = !configured[name] ? 'sem chave' : summary?.errors?.some(e => e.startsWith(label)) ? 'indisponível' : answered ? 'conectado' : 'sem registro';
    return <span key={name} className="rounded-lg border border-current/20 bg-slate-950/30 px-2 py-1">{label}: {text}</span>;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(indicator);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scoreTone = (score: number | null | undefined) => {
    if (score == null) return { pill: 'text-slate-300 bg-slate-800 border-slate-700', bar: 'bg-slate-600' };
    if (score >= 80) return { pill: 'text-rose-400 bg-rose-950/80 border-rose-800', bar: 'bg-rose-500' };
    if (score >= 40) return { pill: 'text-amber-400 bg-amber-950/80 border-amber-800', bar: 'bg-amber-500' };
    return { pill: 'text-emerald-400 bg-emerald-950/80 border-emerald-800', bar: 'bg-emerald-500' };
  };
  const tone = scoreTone(summary?.score);
  const gn = summary?.greyNoise;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 modal-backdrop">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Dossiê de ${indicator}`}
        className="bg-slate-900 border border-slate-700/80 rounded-none sm:rounded-2xl w-full max-w-5xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col shadow-[0_28px_80px_-36px_rgba(0,0,0,0.95)] overflow-hidden text-slate-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-start sm:items-center justify-between gap-3 bg-slate-950/70">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base sm:text-xl font-bold font-mono tracking-tight text-white mobile-safe-text">{indicator}</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">{typeLabel}</span>
                {summary && <span className={`verdict verdict--${summary.verdict}`} title={summary.verdictReason || undefined}>{VERDICT_LABEL[summary.verdict]}</span>}
                {(detail?.countryName || summary?.countryCode) && <span className="text-sm">{detail?.countryName || summary?.countryCode}</span>}
              </div>
              {summary && (summary.isp || summary.asn || detail?.hostnames.length) ? (
                <p className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-1 mobile-safe-text">
                  {(summary.asn || summary.isp) && <span>{[summary.asn, summary.isp].filter(Boolean).join(' · ')}</span>}
                  {detail?.hostnames[0] && <><span>•</span><span className="font-mono text-slate-500 text-[11px]">{detail.hostnames[0]}</span></>}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isIp && (
              <button
                onClick={() => openIpAnalysisTab(indicator)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
                title="Abrir a Análise de IP completa numa aba nova"
              >
                <Fingerprint className="w-3.5 h-3.5 text-slate-400" />
                Análise completa
              </button>
            )}
            <button
              onClick={handleCopy}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
              title="Copiar indicador"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button onClick={onClose} aria-label="Fechar dossiê" className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition" title="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-sm">
          {/* Situação das fontes */}
          <div className={`p-4 rounded-xl border ${!isIp ? 'border-slate-700 bg-slate-800/40 text-slate-200' : error || (configured && !Object.values(configured).some(Boolean)) ? 'border-amber-800 bg-amber-950/40 text-amber-100' : 'border-emerald-800 bg-emerald-950/40 text-emerald-100'}`}>
            <p className="font-semibold">
              {!isIp
                ? 'Reputação externa só é consultada para IPs individuais'
                : loading
                  ? 'Consultando AbuseIPDB, GreyNoise e OTX…'
                  : error
                    ? 'Não foi possível consultar a reputação'
                    : configured && !Object.values(configured).some(Boolean)
                      ? 'Nenhuma fonte de reputação configurada no servidor'
                      : `Reputação real, consultada em ${fmtDateTime(analysis?.fetchedAt)}`}
            </p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              {isIp
                ? 'As ocorrências vêm das listas do GuardList; a reputação vem das fontes externas. Fonte que não respondeu aparece como "sem dados".'
                : 'Abaixo, só as ocorrências nas listas dos clientes.'}
            </p>
            {configured && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {sourceStatus('abuseIpDb', summary?.score != null, 'AbuseIPDB')}
                {sourceStatus('greyNoise', Boolean(gn?.classification), 'GreyNoise')}
                {sourceStatus('otx', summary?.otxPulses != null, 'OTX')}
              </div>
            )}
            {summary?.verdictReason && <p className="mt-2 text-xs">{summary.verdictReason}</p>}
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          </div>

          {/* Presença nas listas */}
          <div className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
            local.correlatedClients.length >= 3
              ? 'bg-rose-950/40 border-rose-800 text-rose-200'
              : local.correlatedClients.length === 2
                ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                : 'bg-slate-800/40 border-slate-700 text-slate-300'
          }`}>
            <div>
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Radio className="w-4 h-4 shrink-0 text-blue-400" />
                <span>
                  {local.correlatedClients.length === 0 ? 'Sem registros nas listas'
                    : `Registrado em ${local.correlatedClients.length} ${local.correlatedClients.length === 1 ? 'cliente' : 'clientes'}`}
                </span>
              </div>
              <p className="text-xs opacity-90 mt-1">
                {local.correlatedClients.length > 1
                  ? 'O indicador aparece em listas de clientes diferentes; investigue a causa antes de atribuir atividade coordenada.'
                  : local.correlatedClients.length === 1 ? 'Este indicador foi registrado na lista do cliente indicado abaixo.' : 'Nenhuma ocorrência foi encontrada nas listas.'}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {local.correlatedClients.map(c => (
                  <span key={c.clientId} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-900 border border-slate-700 text-white">
                    <Building2 className="w-3 h-3 text-blue-400" />
                    {c.clientName}
                    <span className="text-[10px] text-slate-400 font-normal">({formatDateBR(c.addedDate)}{c.status === 'removed' ? ' · removido' : ''})</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block opacity-70">Disseminação</span>
              <span className="text-2xl font-bold font-mono">{local.correlatedClients.length} / {clients.filter(client => !client.isArchived).length}</span>
            </div>
          </div>

          {/* Fontes externas (só IPs) */}
          {isIp && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">AbuseIPDB</span>
                    <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full border ${tone.pill}`}>
                      {summary?.score == null ? 'Sem dados' : `Nota ${summary.score}%`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                    <div className={`h-2 rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${summary?.score ?? 0}%` }} />
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-400">
                    <div className="flex justify-between"><span>Denúncias (12 meses)</span><strong className="text-slate-200 font-mono">{summary?.totalReports ?? '—'}</strong></div>
                    <div className="flex justify-between"><span>Última denúncia</span><span className="text-slate-300">{fmtDateTime(summary?.lastReportedAt)}</span></div>
                    <div className="flex justify-between"><span>Lista branca</span><span className="text-slate-300">{detail?.isWhitelisted == null ? '—' : detail.isWhitelisted ? 'Sim' : 'Não'}</span></div>
                    <div className="flex justify-between"><span>Tor</span><span className="text-slate-300">{detail ? (detail.isTor ? 'Sim' : 'Não') : '—'}</span></div>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800">
                    <span className="text-[11px] text-slate-500 block mb-1">Categorias nas denúncias recentes</span>
                    <div className="flex flex-wrap gap-1">
                      {topCategories.length ? topCategories.map(([cat, count]) => (
                        <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">{abuseCategory(cat)} · {count}</span>
                      )) : <span className="text-[11px] text-slate-500 italic">{loading ? 'Consultando…' : 'Nenhuma'}</span>}
                    </div>
                  </div>
                </div>
                <a href={`https://www.abuseipdb.com/check/${indicator}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2">
                  Abrir no AbuseIPDB <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">GreyNoise</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                      gn?.classification === 'malicious' ? 'text-rose-400 bg-rose-950/80 border-rose-800'
                        : gn?.classification === 'benign' || gn?.riot ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800'
                          : 'text-slate-300 bg-slate-800 border-slate-700'
                    }`}>
                      {!gn ? 'Sem dados' : gn.classification === 'malicious' ? 'Malicioso' : gn.riot ? 'Serviço conhecido' : gn.classification === 'benign' ? 'Benigno' : 'Não visto'}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-400 my-2">
                    <div className="flex justify-between"><span>Ator ou serviço</span><strong className="text-slate-200">{gn?.name || '—'}</strong></div>
                    <div className="flex justify-between"><span>Serviço comum (RIOT)</span><span className="text-slate-300">{gn ? (gn.riot ? 'Sim' : 'Não') : '—'}</span></div>
                  </div>
                </div>
                <a href={`https://viz.greynoise.io/ip/${indicator}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2">
                  Abrir no GreyNoise <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">AlienVault OTX</span>
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full border bg-blue-950/80 text-blue-300 border-blue-800">
                      {summary?.otxPulses == null ? 'Sem dados' : `${summary.otxPulses} pulses`}
                    </span>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800">
                    <span className="text-[11px] text-slate-500 block mb-1">Famílias de malware</span>
                    <div className="flex flex-wrap gap-1">
                      {detail?.malwareFamilies.length ? detail.malwareFamilies.map(m => (
                        <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 font-mono">{m}</span>
                      )) : <span className="text-[11px] text-slate-500 italic">{loading ? 'Consultando…' : 'Nenhuma informada'}</span>}
                    </div>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800">
                    <span className="text-[11px] text-slate-500 block mb-1">Tags dos pulses</span>
                    <div className="flex flex-wrap gap-1">
                      {detail?.otxTags.length ? detail.otxTags.map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-blue-300">#{t}</span>
                      )) : <span className="text-[11px] text-slate-500 italic">{loading ? 'Consultando…' : 'Nenhuma'}</span>}
                    </div>
                  </div>
                </div>
                <a href={`https://otx.alienvault.com/indicator/ip/${indicator}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2">
                  Abrir no AlienVault OTX <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* Linha do tempo (só o que está registrado no GuardList) */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              Linha do tempo nas listas
            </h3>
            <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 divide-y divide-slate-800/80">
              {local.timeline.length === 0 && <p className="text-xs text-slate-500">Nenhum registro nas listas dos clientes.</p>}
              {local.timeline.map((item, index) => (
                <div key={index} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs">
                  <div className="flex items-start gap-3">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.event === 'remocao' ? 'bg-slate-500' : 'bg-blue-500'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-200">{item.clientName}</strong>
                        <span className="text-[10px] font-mono text-slate-500">[{item.source}]</span>
                      </div>
                      <p className="text-slate-400 mt-0.5">{item.description}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">{formatDateBR(item.date)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Consultas externas diretas */}
          {isIp && (
            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>Consultas externas diretas:</span>
              <div className="flex flex-wrap gap-2">
                <a href={`https://www.virustotal.com/gui/ip-address/${indicator}`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1">
                  VirusTotal <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`https://talosintelligence.com/reputation_center/lookup?search=${indicator}`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1">
                  Cisco Talos <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`https://bgp.he.net/ip/${indicator}`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1">
                  BGP Hurricane Electric <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
