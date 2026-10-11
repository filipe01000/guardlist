import React, { useEffect, useState } from 'react';
import { ShieldAlert, X, ExternalLink, Copy, Check, Clock, Building2, Radio } from 'lucide-react';
import { BlocklistEntry, Client, IpCtiRecord } from '../types';
import { ExternalCtiResponse, fetchExternalCti, getIpCtiRecord, mergeExternalCti } from '../utils/ctiService';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { formatDateBR } from '../utils/csv';

interface IpDossierModalProps {
  indicator: string | null;
  onClose: () => void;
  allEntries: BlocklistEntry[];
  clients: Client[];
}

export const IpDossierModal: React.FC<IpDossierModalProps> = ({
  indicator,
  onClose,
  allEntries,
  clients
}) => {
  const [copied, setCopied] = useState(false);
  const [externalCti, setExternalCti] = useState<ExternalCtiResponse | null>(null);
  const [ctiLoading, setCtiLoading] = useState(false);
  const [ctiError, setCtiError] = useState<string | null>(null);
  const dialogRef = useDialogFocus(Boolean(indicator));

  useEffect(() => {
    if (!indicator) return;
    const controller = new AbortController();
    setExternalCti(null);
    setCtiError(null);
    setCtiLoading(true);
    fetchExternalCti(indicator, controller.signal)
      .then(setExternalCti)
      .catch(error => {
        if (error.name !== 'AbortError') setCtiError(error.message);
      })
      .finally(() => setCtiLoading(false));
    return () => controller.abort();
  }, [indicator]);

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
  const localCtiData: IpCtiRecord = getIpCtiRecord(indicator, allEntries, clientsMap);
  const ctiData: IpCtiRecord = externalCti ? mergeExternalCti(localCtiData, externalCti) : localCtiData;
  const configuredSources = externalCti
    ? Object.values(externalCti.sources).filter(source => source.status !== 'not_configured' && source.status !== 'error').length
    : 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(indicator);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-rose-400 bg-rose-950/80 border-rose-800';
    if (score >= 40) return 'text-amber-400 bg-amber-950/80 border-amber-800';
    return 'text-emerald-400 bg-emerald-950/80 border-emerald-800';
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 80) return 'bg-rose-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 modal-backdrop">
      <div 
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Dossiê CTI de ${indicator}`}
        className="bg-slate-900 border border-slate-700/80 rounded-none sm:rounded-2xl w-full max-w-5xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col shadow-[0_28px_80px_-36px_rgba(0,0,0,0.95)] overflow-hidden text-slate-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho do Dossiê */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-start sm:items-center justify-between gap-3 bg-slate-950/70">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base sm:text-xl font-bold font-mono tracking-tight text-white mobile-safe-text">
                  {indicator}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                  {ctiData.type}
                </span>
                <span className="text-sm" title={ctiData.country.name}>
                  {ctiData.country.flag} {ctiData.country.code}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-1 mobile-safe-text">
                <span>AS{ctiData.asn.number} ({ctiData.asn.org})</span>
                <span>•</span>
                <span className="font-mono text-slate-500 text-[11px]">{ctiData.reverseDns}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
              title="Copiar endereço"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar dossiê CTI"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-sm">
          <div className={`p-4 rounded-xl border ${configuredSources > 0 ? 'border-emerald-800 bg-emerald-950/40 text-emerald-100' : 'border-amber-800 bg-amber-950/40 text-amber-100'}`}>
            <p className="font-semibold">
              {ctiLoading ? 'Consultando fontes CTI…' : configuredSources > 0 ? `${configuredSources} de 3 fontes CTI consultadas` : 'Fontes CTI externas não configuradas'}
            </p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              As ocorrências e os clientes correlacionados vêm da base local. Dados externos só são exibidos como reais quando o provedor responde; fontes ausentes mantêm valores demonstrativos nesta prévia.
            </p>
            {externalCti && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {Object.entries(externalCti.sources).map(([name, source]) => (
                  <span key={name} className="rounded-lg border border-current/20 bg-slate-950/30 px-2 py-1">
                    {name === 'abuseIpDb' ? 'AbuseIPDB' : name === 'greyNoise' ? 'GreyNoise' : 'AlienVault OTX'}: {source.status === 'ok' ? 'conectado' : source.status === 'not_configured' ? 'sem chave' : source.status === 'rate_limited' ? 'limite atingido' : source.status === 'not_found' ? 'sem registro' : 'erro'}
                  </span>
                ))}
              </div>
            )}
            {ctiError && <p className="mt-2 text-xs text-rose-300">{ctiError}</p>}
          </div>

          {/* Alerta de Correlação Cruzada */}
          <div className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
            ctiData.correlatedClients.length >= 3
              ? 'bg-rose-950/40 border-rose-800 text-rose-200'
              : ctiData.correlatedClients.length === 2
                ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                : 'bg-slate-800/40 border-slate-700 text-slate-300'
          }`}>
            <div>
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Radio className="w-4 h-4 shrink-0 text-blue-400" />
                <span>
                  {ctiData.correlatedClients.length === 0 ? 'Sem registros locais'
                    : `Registrado em ${ctiData.correlatedClients.length} ${ctiData.correlatedClients.length === 1 ? 'cliente' : 'clientes'}`}
                </span>
              </div>
              <p className="text-xs opacity-90 mt-1">
                {ctiData.correlatedClients.length > 1
                  ? 'O indicador aparece em listas locais de infraestruturas diferentes; investigue a causa antes de atribuir atividade coordenada.'
                  : ctiData.correlatedClients.length === 1 ? 'Este indicador foi registrado na lista do cliente indicado abaixo.' : 'Nenhuma ocorrência local foi encontrada para este indicador.'}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {ctiData.correlatedClients.map(c => (
                  <span
                    key={c.clientId}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-900 border border-slate-700 text-white"
                  >
                    <Building2 className="w-3 h-3 text-blue-400" />
                    {c.clientName}
                    <span className="text-[10px] text-slate-400 font-normal">
                      ({formatDateBR(c.addedDate)}{c.status === 'removed' ? ' · removido' : ''})
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block opacity-70">
                Disseminação
              </span>
              <span className="text-2xl font-bold font-mono">
                {ctiData.correlatedClients.length} / {clients.filter(client => !client.isArchived).length}
              </span>
            </div>
          </div>

          {/* Cards de Threat Intelligence (AbuseIPDB, GreyNoise, AlienVault OTX) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: AbuseIPDB */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                    AbuseIPDB
                  </span>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full border ${getScoreColor(ctiData.abuseIpDb.score)}`}>
                    Score: {ctiData.abuseIpDb.score}%
                  </span>
                </div>

                {/* Barra de Score */}
                <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${getScoreBarColor(ctiData.abuseIpDb.score)}`}
                    style={{ width: `${ctiData.abuseIpDb.score}%` }}
                  />
                </div>

                <div className="space-y-1.5 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>Total de reports</span>
                    <strong className="text-slate-200 font-mono">{ctiData.abuseIpDb.totalReports}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Último report</span>
                    <span className="text-slate-300">{ctiData.abuseIpDb.lastReportedAt}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800">
                  <span className="text-[11px] text-slate-500 block mb-1">Categorias de ataque</span>
                  <div className="flex flex-wrap gap-1">
                    {ctiData.abuseIpDb.categories.map((cat, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <a
                href={`https://www.abuseipdb.com/check/${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2"
              >
                Abrir no AbuseIPDB <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Card 2: GreyNoise */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                    GreyNoise
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                    ctiData.greyNoise.classification === 'malicious'
                      ? 'text-rose-400 bg-rose-950/80 border-rose-800'
                      : ctiData.greyNoise.classification === 'benign'
                        ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800'
                        : 'text-slate-300 bg-slate-800 border-slate-700'
                  }`}>
                    {ctiData.greyNoise.classification === 'malicious' ? 'Malicioso' : ctiData.greyNoise.classification === 'benign' ? 'Benigno (RIOT)' : 'Desconhecido'}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-400 my-2">
                  <div className="flex justify-between">
                    <span>Ator ou botnet</span>
                    <strong className="text-slate-200">{ctiData.greyNoise.actor}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Varredura global</span>
                    <span className="text-slate-300">{ctiData.greyNoise.noise ? 'Sim (Detectado)' : 'Não'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Última atividade</span>
                    <span className="text-slate-300">{ctiData.greyNoise.lastSeen}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800">
                  <span className="text-[11px] text-slate-500 block mb-1">Tags do scanner</span>
                  <div className="flex flex-wrap gap-1">
                    {ctiData.greyNoise.tags.map((t, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-blue-300">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <a
                href={`https://viz.greynoise.io/ip/${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2"
              >
                Abrir no GreyNoise <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Card 3: AlienVault OTX */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                    AlienVault OTX
                  </span>
                  <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full border bg-blue-950/80 text-blue-300 border-blue-800">
                    {ctiData.alienVaultOtx.pulseCount} Pulses
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-400 my-2">
                  <div className="flex justify-between">
                    <span>Confiança do feed</span>
                    <strong className="text-slate-200 font-mono">{ctiData.alienVaultOtx.confidence}%</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Avaliação técnica</span>
                    <span className="text-slate-300">{ctiData.alienVaultOtx.lastEvaluated}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800">
                  <span className="text-[11px] text-slate-500 block mb-1">Famílias de malware e IoCs</span>
                  <div className="flex flex-wrap gap-1">
                    {ctiData.alienVaultOtx.malwareFamilies.length > 0 ? (
                      ctiData.alienVaultOtx.malwareFamilies.map((m, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 font-mono">
                          {m}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">Varredura de portas genérica</span>
                    )}
                  </div>
                </div>
              </div>

              <a
                href={`https://otx.alienvault.com/indicator/ip/${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition underline pt-2"
              >
                Abrir no AlienVault OTX <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Seção de Evidências e Linha do Tempo */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              Linha do tempo
            </h3>
            <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 divide-y divide-slate-800/80">
              {ctiData.timeline.map((item, index) => (
                <div key={index} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs">
                  <div className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-200">{item.clientName}</strong>
                        <span className="text-[10px] font-mono text-slate-500">[{item.source}]</span>
                      </div>
                      <p className="text-slate-400 mt-0.5">{item.description}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                    {item.date}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Links Rápidos de Investigação SOC */}
          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Consultas externas diretas:</span>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://www.virustotal.com/gui/ip-address/${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                VirusTotal <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={`https://talosintelligence.com/reputation_center/lookup?search=${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                Cisco Talos <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={`https://bgp.he.net/ip/${indicator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                BGP Hurricane Electric <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
