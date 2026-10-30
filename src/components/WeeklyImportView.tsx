import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, AlertTriangle, XCircle, RotateCcw, Check, Trash2, Pencil, Plus, Eye, ListChecks, ArrowLeft, Info, ShieldOff, Loader2,
  ArrowDown01, Network, Hourglass, Copy, FileSignature
} from 'lucide-react';
import {
  AppSettings, BlocklistEntry, Client, CtiSummary, ImportOutcome, ImportPreviewItem, ImportPreviewSummary, PendingImport
} from '../types';
import { analyzeImportBatch, editBatchText, extractValidIndicatorsFromText, organizeIndicators, type OrganizeMode } from '../utils/importer';
import { enrichIndicators, getClientActiveIndicatorsSet, listPendingImports, type ImportBatchPayload } from '../db/store';
import { getIsoWeek, ipv4ToNumber, isValidIPv4 } from '../utils/validator';
import { formatDateTimeBR } from '../utils/csv';
import { PageHeader } from './PageHeader';
import { buildImportReport } from '../utils/importReport';
import { requestCaseBuilder } from './contextActions';
import { CtiInline } from './CtiBits';

interface WeeklyImportViewProps {
  clients: Client[];
  initialClientId?: string;
  onImportSuccess: (clientId: string, outcome: ImportOutcome) => void;
  onBack: () => void;
  onSaveBatch: (payload: ImportBatchPayload) => Promise<ImportOutcome>;
  isAdmin: boolean;
  settings: AppSettings;
}

// 'legit', 'scanner' e 'malicious' são abas filtradas pela reputação dos IPs novos, não categorias do importador.
type PreviewTab = ImportPreviewItem['category'] | 'legit' | 'scanner' | 'malicious';
const REPUTATION_TABS: PreviewTab[] = ['legit', 'scanner', 'malicious'];

const TABS: Array<[PreviewTab, string, '' | 'ok' | 'warn' | 'danger']> = [
  ['new', 'Novos', 'ok'],
  ['malicious', 'Maliciosos', 'danger'],
  ['scanner', 'Scanners', ''],
  ['legit', 'Legítimos', ''],
  ['dup_in_file', 'Repetidos no arquivo', ''],
  ['already_exists', 'Já na lista', ''],
  ['covered_by_cidr', 'Cobertos por CIDR', ''],
  ['exception', 'Exceções do cliente', 'danger'],
  ['invalid', 'Inválidos', 'danger'],
  ['reserved_warning', 'Faixas privadas', 'warn']
];

// Quantos IPs consultar automaticamente ao pré-visualizar (o resto sob demanda, para poupar a cota).
const AUTO_ENRICH = 100;

export const WeeklyImportView: React.FC<WeeklyImportViewProps> = ({
  clients,
  initialClientId,
  onImportSuccess,
  onSaveBatch,
  onBack,
  isAdmin,
  settings
}) => {
  const activeClients = clients.filter(c => !c.isArchived);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || activeClients[0]?.id || '');

  const [rawText, setRawText] = useState('');
  const [sourceTicket, setSourceTicket] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);

  // Análise e pré-visualização
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>('new');
  // Edição direto na pré-visualização: posição do item em preview.items, texto dele e campo de acrescentar.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addValue, setAddValue] = useState('');
  const [includeReservedAlerts, setIncludeReservedAlerts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reputação (AbuseIPDB, GreyNoise, OTX) dos IPs novos
  const [cti, setCti] = useState<Record<string, CtiSummary>>({});
  const [ctiState, setCtiState] = useState<{ loading: boolean; pending: number; configured: boolean; error?: string }>({ loading: false, pending: 0, configured: true });
  const [skipLegit, setSkipLegit] = useState(true);

  const [myPending, setMyPending] = useState<PendingImport[]>([]);

  const selectedClient = activeClients.find(c => c.id === selectedClientId);
  const exceptions = useMemo(() => (selectedClient?.exceptions || []).map((e) => e.indicator), [selectedClient]);

  useEffect(() => {
    if (isAdmin) return;
    listPendingImports().then((items) => setMyPending(items.filter((i) => i.status !== 'approved').slice(0, 5))).catch(() => undefined);
  }, [isAdmin]);

  // Leitura de arquivo .txt ou .csv
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) setRawText(content);
    };
    reader.readAsText(file);
  };

  const handleExtractOnly = () => {
    if (!rawText.trim()) return;
    const valids = extractValidIndicatorsFromText(rawText);
    if (valids.length > 0) {
      setRawText(valids.join('\n'));
      setOrganizeNote(`${valids.length} indicadores válidos extraídos.`);
    } else {
      setOrganizeNote('Nenhum IP, CIDR ou domínio válido foi encontrado no texto.');
    }
  };

  const handleOrganize = (mode: OrganizeMode) => {
    if (!rawText.trim()) return;
    const result = organizeIndicators(rawText, mode);
    setRawText(result.text);
    setOrganizeNote(
      `${result.total} únicos${result.duplicates ? ` · ${result.duplicates} repetido(s) removido(s)` : ''}${result.invalid ? ` · ${result.invalid} inválido(s)` : ''}. Linhas com # são só anotações e não são importadas.`
    );
  };

  // Consulta a reputação de IPs novos que ainda não têm resultado na tela.
  const enrich = async (items: ImportPreviewItem[], limit = AUTO_ENRICH) => {
    const ips = items
      .filter((i) => (i.category === 'new' || i.category === 'reserved_warning') && (i.type === 'IPv4' || i.type === 'IPv6'))
      .map((i) => i.indicator)
      .filter((ip) => !cti[ip]);
    if (ips.length === 0) return;
    setCtiState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const result = await enrichIndicators(ips.slice(0, Math.max(limit, 1)));
      setCti((prev) => ({ ...prev, ...result.results }));
      setCtiState({ loading: false, pending: Math.max(ips.length - limit, 0) + result.pending, configured: result.configured });
    } catch (err) {
      setCtiState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Falha na consulta.' }));
    }
  };

  // Executar análise contra a base do cliente
  const analyze = async (text: string) => {
    setIsAnalyzing(true);
    setSubmitError(null);
    try {
      const { activeSet, activeCidrs } = await getClientActiveIndicatorsSet(selectedClientId);
      const summary = analyzeImportBatch(text, activeSet, activeCidrs, importMode, exceptions);
      setPreview(summary);
      enrich(summary.items);
      return summary;
    } catch (err) {
      console.error('Erro ao analisar lote:', err);
      setSubmitError('Não foi possível analisar o lote. Tente novamente.');
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedClientId || !rawText.trim()) return;
    const summary = await analyze(rawText);
    if (!summary) return;
    const first = TABS.find(([id]) => summary.items.some((i) => i.category === id));
    setActiveTab(first ? first[0] : 'new');
  };

  // Corrige, tira ou acrescenta um item e reanalisa o lote: o item vai para a aba certa, sem sair da pré-visualização.
  const applyEdit = async (index: number, value: string | null) => {
    if (!preview) return;
    const text = editBatchText(preview.items, index, value);
    setEditingIndex(null);
    setRawText(text);
    if (text.trim()) await analyze(text);
    else setPreview(null);
  };

  const legitItems = useMemo(
    () => (preview ? preview.items.filter((i) => i.category === 'new' && cti[i.indicator]?.verdict === 'legit') : []),
    [preview, cti]
  );

  const scannerItems = useMemo(
    () => (preview ? preview.items.filter((i) => i.category === 'new' && cti[i.indicator]?.verdict === 'scanner') : []),
    [preview, cti]
  );

  // IPs novos com reputação ruim, os piores primeiro.
  const maliciousItems = useMemo(() => {
    if (!preview) return [];
    const bad = preview.items.filter((i) => i.category === 'new' && (cti[i.indicator]?.verdict === 'high' || cti[i.indicator]?.verdict === 'medium'));
    return bad.sort((a, b) => (cti[b.indicator]?.score ?? 0) - (cti[a.indicator]?.score ?? 0) || (cti[b.indicator]?.totalReports ?? 0) - (cti[a.indicator]?.totalReports ?? 0));
  }, [preview, cti]);

  const itemsOfTab = (tab: PreviewTab) => {
    if (!preview) return [];
    if (tab === 'legit') return legitItems;
    if (tab === 'scanner') return scannerItems;
    if (tab === 'malicious') return maliciousItems;
    return preview.items.filter((i) => i.category === tab);
  };

  const [copiedTab, setCopiedTab] = useState(false);
  const copyTab = async (tab: PreviewTab) => {
    try {
      await navigator.clipboard.writeText(itemsOfTab(tab).map((i) => i.indicator).join('\n'));
      setCopiedTab(true);
      window.setTimeout(() => setCopiedTab(false), 1600);
    } catch {
      setSubmitError('Não foi possível copiar automaticamente.');
    }
  };

  // Itens que serão gravados
  const itemsToSave = useMemo(() => {
    if (!preview) return [];
    const legit = new Set(skipLegit ? legitItems : []);
    return preview.items.filter((item) => {
      if (legit.has(item)) return false;
      if (item.category === 'new') return true;
      if (includeReservedAlerts && item.category === 'reserved_warning') return true;
      // Ao substituir, os que já estão na lista também seguem no lote, senão seriam arquivados.
      if (importMode === 'replace' && item.category === 'already_exists') return true;
      return false;
    });
  }, [preview, legitItems, skipLegit, includeReservedAlerts, importMode]);

  const newToSave = itemsToSave.filter((i) => i.category !== 'already_exists').length;
  // Os que entram de fato na blocklist agora: vão para o caso do cliente.
  const newIndicators = useMemo(() => itemsToSave.filter((i) => i.category !== 'already_exists').map((i) => i.indicator), [itemsToSave]);
  const [copiedNew, setCopiedNew] = useState(false);
  const copyNew = async () => {
    try {
      await navigator.clipboard.writeText(newIndicators.join('\n'));
      setCopiedNew(true);
      window.setTimeout(() => setCopiedNew(false), 1600);
    } catch {
      setSubmitError('Não foi possível copiar automaticamente. Use "Gerar caso" para levar os IPs.');
    }
  };
  const finalCount = importMode === 'replace' ? itemsToSave.length : newToSave;
  const needsApproval =
    !isAdmin &&
    ((importMode === 'replace' && settings.requireApprovalForReplace !== false) || itemsToSave.length > (settings.approvalThreshold ?? 500));

  // Confirmar gravação
  const handleConfirmImport = async () => {
    if (!preview || !selectedClient) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const today = new Date().toISOString().split('T')[0];

    const entries: BlocklistEntry[] = itemsToSave.map(item => {
      const isIpv4 = item.type === 'IPv4' && isValidIPv4(item.indicator);
      const rep = cti[item.indicator];
      const repNote = rep && rep.verdict !== 'unknown'
        ? `Reputação na inclusão: ${rep.verdict === 'high' ? 'alto risco' : rep.verdict === 'medium' ? 'médio' : rep.verdict === 'low' ? 'baixo risco' : rep.verdict === 'scanner' ? 'scanner conhecido' : 'legítimo'}${rep.totalReports !== null ? `, ${rep.totalReports} ocorrências` : ''}${rep.domain ? `, ${rep.domain}` : ''}`
        : '';
      return {
        id: `entry-${selectedClient.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        clientId: selectedClient.id,
        indicator: item.indicator,
        originalInput: item.original,
        type: item.type,
        addedDate: today,
        sourceTicket: sourceTicket.trim() || undefined,
        status: 'active',
        notes: [batchNotes.trim(), repNote].filter(Boolean).join(' • ') || undefined,
        isReservedAlert: item.category === 'reserved_warning',
        reservedReason: item.reservedReason,
        numericValue: isIpv4 ? ipv4ToNumber(item.indicator) : undefined
      };
    });

    // Reapareceram neste lote: já na lista, ou cobertos por um CIDR que já estava na lista.
    const seen = preview.items
      .filter((i) => i.category === 'already_exists' || i.category === 'covered_by_cidr')
      .map((i) => (i.category === 'covered_by_cidr' && i.coveredByCidr ? i.coveredByCidr : i.indicator));

    const legitSkipped = skipLegit ? legitItems.length : 0;
    try {
      const outcome = await onSaveBatch({
        clientId: selectedClient.id,
        mode: importMode,
        entries,
        todayStr: today,
        seen,
        report: buildImportReport(preview, {
          mode: importMode,
          source: fileName ?? undefined,
          saved: new Set(itemsToSave.map((i) => i.indicator)),
          legitSkipped: skipLegit ? legitItems.map((i) => i.indicator) : []
        }),
        history: {
          id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          isoWeek: getIsoWeek(),
          sourceTicket: sourceTicket.trim() || undefined,
          duplicatesDiscarded: preview.dupInFileCount + preview.alreadyExistsCount,
          coveredByCidrDiscarded: preview.coveredByCidrCount,
          invalidsDiscarded: preview.invalidCount,
          notes: [batchNotes.trim(), legitSkipped ? `${legitSkipped} IPs legítimos não gravados` : '', preview.exceptionCount ? `${preview.exceptionCount} recusados pelas exceções` : '']
            .filter(Boolean).join(' • ') || undefined
        }
      });
      onImportSuccess(selectedClient.id, outcome);
      setPreview(null);
      setRawText('');
      setFileName(null);
      setSourceTicket('');
      setBatchNotes('');
      setCti({});
      setOrganizeNote(null);
      if (outcome.status === 'pending') {
        listPendingImports().then((items) => setMyPending(items.filter((i) => i.status !== 'approved').slice(0, 5))).catch(() => undefined);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível gravar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardAllInvalids = () => {
    if (!preview) return;
    const filteredItems = preview.items.filter(i => i.category !== 'invalid');
    setPreview({ ...preview, invalidCount: 0, totalLines: filteredItems.length, items: filteredItems });
    if (activeTab === 'invalid') setActiveTab('new');
  };

  const countOf = (tab: PreviewTab) => itemsOfTab(tab).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importação"
        description="Cole os indicadores ou carregue o arquivo. Nada é gravado antes da pré-visualização, e a deduplicação considera só o cliente escolhido."
        actions={
          <button type="button" onClick={onBack} className="btn">
            <ArrowLeft aria-hidden="true" />
            Voltar
          </button>
        }
      />

      {myPending.length > 0 && !preview && (
        <section className="data-panel p-4">
          <h2 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Hourglass className="w-4 h-4 text-amber-300" aria-hidden="true" /> Suas importações enviadas para aprovação</h2>
          <ul className="space-y-1 text-xs text-slate-300">
            {myPending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className={p.status === 'pending' ? 'chip chip--warn' : 'chip chip--danger'}>{p.status === 'pending' ? 'Aguardando' : 'Recusada'}</span>
                <strong>{p.clientName}</strong> · {p.itemCount} itens · {p.mode === 'replace' ? 'substituir' : 'adicionar'} · {formatDateTimeBR(p.requestedAt)}
                {p.decisionNote && <span className="text-slate-400">· "{p.decisionNote}"</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!preview ? (
        <div className="data-panel p-5 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label" htmlFor="import-client">Cliente</label>
              <select id="import-client" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="field w-full font-mono">
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.lastUpdateDate ? `· última ${c.lastUpdateDate}` : '· sem importação'}
                  </option>
                ))}
              </select>
              {exceptions.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
                  <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" /> {exceptions.length} exceç{exceptions.length === 1 ? 'ão' : 'ões'} deste cliente serão recusadas
                </p>
              )}
            </div>

            <div>
              <label className="field-label" htmlFor="import-ticket">Fonte ou ticket <span className="text-slate-500 font-normal">(opcional)</span></label>
              <input id="import-ticket" type="text" placeholder="SEC-2026-849" value={sourceTicket} onChange={(e) => setSourceTicket(e.target.value)} className="field w-full" />
            </div>

            <div>
              <label className="field-label" htmlFor="import-notes">Observação do lote <span className="text-slate-500 font-normal">(opcional)</span></label>
              <input id="import-notes" type="text" placeholder="Varredura nas portas 22 e 3389" value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} className="field w-full" />
            </div>
          </div>

          <fieldset>
            <legend className="field-label">Como gravar</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`choice-card ${importMode === 'append' ? 'is-selected' : ''}`}>
                <input type="radio" name="importMode" checked={importMode === 'append'} onChange={() => setImportMode('append')} />
                <span>
                  <strong>Adicionar à lista</strong>
                  <small>Inclui os novos indicadores e mantém os existentes. Repetidos são ignorados. Recomendado.</small>
                </span>
              </label>
              <label className={`choice-card choice-card--warn ${importMode === 'replace' ? 'is-selected' : ''}`}>
                <input type="radio" name="importMode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                <span>
                  <strong>Substituir a lista</strong>
                  <small>
                    A lista ativa passa a ter só este lote. O que ficar de fora é arquivado, com uma versão salva para desfazer.
                    {!isAdmin && settings.requireApprovalForReplace !== false ? ' Precisa da aprovação de um administrador.' : ''}
                  </small>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <label className="field-label mb-0" htmlFor="import-text">Indicadores, um por linha</label>
              <div className="flex flex-wrap items-center gap-2">
                {rawText.trim() && (
                  <div className="segmented" role="group" aria-label="Organizar texto">
                    <button type="button" onClick={() => handleOrganize('number')} title="IPs em ordem numérica, depois CIDRs, IPv6 e domínios; repetidos removidos e listados no topo">
                      <ArrowDown01 aria-hidden="true" /> Por número
                    </button>
                    <button type="button" onClick={() => handleOrganize('range')} title="Agrupa os IPs pela mesma faixa /24, com um cabeçalho por faixa">
                      <Network aria-hidden="true" /> Por faixa
                    </button>
                    <button type="button" onClick={handleExtractOnly} title="Tira cabeçalhos e texto solto, deixando só os indicadores válidos">
                      <ListChecks aria-hidden="true" /> Só indicadores
                    </button>
                  </div>
                )}
                {fileName && <span className="data-tag">{fileName}</span>}
                <label className="btn btn--sm">
                  <FileText aria-hidden="true" />
                  Carregar arquivo
                  <input type="file" accept=".txt,.csv,.log" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </div>

            <textarea
              id="import-text"
              rows={14}
              value={rawText}
              onChange={(e) => { setRawText(e.target.value); setOrganizeNote(null); }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleAnalyze();
                }
              }}
              placeholder={'# Linhas com # e linhas vazias são ignoradas\n185.220.101.5\n194.26.29.0/24\nevil-c2-botnet.org\n2001:db8::1'}
              className="field w-full py-3 font-mono leading-relaxed resize-y"
            />
            {organizeNote && <p className="text-[11px] text-sky-300">{organizeNote}</p>}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-400">
                Aceita IPv4, IPv6, redes CIDR e domínios. Ao pré-visualizar, a reputação dos IPs novos é consultada (AbuseIPDB, GreyNoise e OTX). Atalho: Ctrl+Enter.
              </p>
              <button type="button" disabled={!rawText.trim() || isAnalyzing} onClick={handleAnalyze} className="btn btn--primary">
                {isAnalyzing ? 'Analisando…' : (<><Eye aria-hidden="true" /> Pré-visualizar</>)}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="data-panel p-5 sm:p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Pré-visualização · <span className="font-mono">{selectedClient?.name}</span>
                </h2>
                <span className={importMode === 'replace' ? 'chip chip--warn' : 'chip'}>
                  {importMode === 'replace' ? 'Substituir lista' : 'Adicionar à lista'}
                </span>
              </div>
              <p className={`text-xs mt-1.5 ${importMode === 'replace' ? 'text-amber-300' : 'text-slate-400'}`}>
                {importMode === 'replace'
                  ? 'A lista ativa vai ficar igual a este lote. O que estiver fora dele será arquivado, com uma versão salva para desfazer.'
                  : `${preview.totalLines} linhas lidas. Só os indicadores novos entram.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" disabled={newIndicators.length === 0} onClick={copyNew} title="Copia os indicadores novos que vão para a blocklist (um por linha)">
                {copiedNew ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copiedNew ? 'Copiados' : `Copiar ${newIndicators.length} novos`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={newIndicators.length === 0}
                onClick={() => requestCaseBuilder(newIndicators, selectedClient?.id)}
                title="Abre o gerador de caso com os indicadores novos deste lote"
              >
                <FileSignature aria-hidden="true" />
                Gerar caso
              </button>
              <button type="button" onClick={() => setPreview(null)} className="btn">
                <RotateCcw aria-hidden="true" />
                Editar lista
              </button>
              <button type="button" disabled={finalCount === 0 || isSubmitting} onClick={handleConfirmImport} className="btn btn--primary">
                {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {needsApproval
                  ? `Enviar para aprovação (${finalCount})`
                  : importMode === 'replace'
                    ? `Substituir pela lista de ${finalCount} ${finalCount === 1 ? 'item' : 'itens'}`
                    : `Gravar ${finalCount} ${finalCount === 1 ? 'item' : 'itens'}`}
              </button>
            </div>
          </div>

          {submitError && <div className="notice notice--danger" role="alert"><p>{submitError}</p></div>}

          {needsApproval && (
            <div className="notice notice--warn">
              <Hourglass aria-hidden="true" />
              <p>
                {importMode === 'replace'
                  ? 'Substituir a lista precisa da aprovação de um administrador.'
                  : `Lotes com mais de ${settings.approvalThreshold ?? 500} itens precisam da aprovação de um administrador.`}{' '}
                Nada muda na lista até lá.
              </p>
            </div>
          )}

          {preview.superseded.length > 0 && (
            <div className="notice">
              <Info aria-hidden="true" />
              <p>
                {preview.superseded.length === 1
                  ? '1 item que já está na lista fica coberto e será retirado ao gravar'
                  : `${preview.superseded.length} itens que já estão na lista ficam cobertos e serão retirados ao gravar`}
                {': '}
                <span className="font-mono">
                  {preview.superseded.slice(0, 6).map(s => `${s.indicator} → ${s.coveredBy}`).join(', ')}
                  {preview.superseded.length > 6 ? ' …' : ''}
                </span>
              </p>
            </div>
          )}

          {/* Reputação */}
          <div className="notice">
            {ctiState.loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            <p>
              {ctiState.loading
                ? 'Consultando reputação dos IPs novos…'
                : !ctiState.configured
                  ? 'Reputação indisponível: nenhuma chave de AbuseIPDB, GreyNoise ou OTX configurada no servidor.'
                  : ctiState.error
                    ? `Reputação: ${ctiState.error}`
                    : legitItems.length > 0
                      ? `${legitItems.length} IP${legitItems.length === 1 ? ' parece' : 's parecem'} de serviços legítimos (Google, Cloudflare, Microsoft…).`
                      : 'Reputação consultada: veja a coluna à direita de cada IP novo.'}
              {ctiState.pending > 0 && !ctiState.loading && ` ${ctiState.pending} IPs ainda sem consulta.`}
            </p>
            <span className="flex items-center gap-2">
              {legitItems.length > 0 && (
                <label className="flex items-center gap-2 font-semibold cursor-pointer whitespace-nowrap text-xs">
                  <input type="checkbox" checked={skipLegit} onChange={(e) => setSkipLegit(e.target.checked)} />
                  Não gravar os legítimos ({legitItems.length})
                </label>
              )}
              {ctiState.pending > 0 && !ctiState.loading && (
                <button type="button" className="btn btn--sm" onClick={() => enrich(preview.items)}>Consultar mais {Math.min(ctiState.pending, AUTO_ENRICH)}</button>
              )}
            </span>
          </div>

          <div className="tabs" role="tablist" aria-label="Categorias da pré-visualização">
            {TABS.filter(([id]) => !(id === 'exception' || REPUTATION_TABS.includes(id)) || countOf(id) > 0).map(([id, label, tone]) => {
              const count = countOf(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  onClick={() => setActiveTab(id)}
                  className={`tabs__tab ${tone && count > 0 ? `has-${tone}` : ''}`}
                >
                  {label}
                  <span className="tabs__count">{count}</span>
                </button>
              );
            })}
          </div>

          {activeTab === 'reserved_warning' && preview.reservedWarningCount > 0 && (
            <div className="notice notice--warn">
              <AlertTriangle aria-hidden="true" />
              <p>Estes endereços são de faixas internas (RFC 1918, loopback) e normalmente não são bloqueados na borda.</p>
              <label className="flex items-center gap-2 font-semibold cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={includeReservedAlerts} onChange={(e) => setIncludeReservedAlerts(e.target.checked)} />
                Incluir mesmo assim ({preview.reservedWarningCount})
              </label>
            </div>
          )}

          {REPUTATION_TABS.includes(activeTab) && (
            <div className={`notice ${activeTab === 'malicious' ? 'notice--danger' : ''}`}>
              {activeTab === 'malicious' ? <AlertTriangle aria-hidden="true" /> : <Info aria-hidden="true" />}
              <p>
                {activeTab === 'malicious'
                  ? 'IPs novos com reputação de alto ou médio risco, os piores primeiro. Eles serão gravados.'
                  : activeTab === 'scanner'
                    ? 'Scanners de pesquisa conhecidos (Censys, Shodan, Shadowserver…) ou IPs na lista branca do AbuseIPDB. Varrem a internet toda, não miram o cliente. Eles serão gravados; tire-os da lista se a equipe não bloqueia scanners.'
                    : skipLegit
                    ? 'IPs novos que parecem de serviços legítimos (Google, Cloudflare, Microsoft…). Não serão gravados.'
                    : 'IPs novos que parecem de serviços legítimos. A opção "Não gravar os legítimos" está desligada, então eles serão gravados.'}
              </p>
              <button type="button" className="btn btn--sm" onClick={() => copyTab(activeTab)}>
                <Copy aria-hidden="true" />
                {copiedTab ? 'Copiados' : `Copiar ${countOf(activeTab)}`}
              </button>
            </div>
          )}

          {REPUTATION_TABS.includes(activeTab) && ctiState.pending > 0 && (
            <div className="notice notice--warn">
              <Hourglass aria-hidden="true" />
              <p>
                {ctiState.pending} {ctiState.pending === 1 ? 'IP novo ainda não teve' : 'IPs novos ainda não tiveram'} a reputação consultada, então esta aba pode estar incompleta.
              </p>
              {!ctiState.loading && (
                <button type="button" className="btn btn--sm" onClick={() => enrich(preview.items)}>Consultar mais {Math.min(ctiState.pending, AUTO_ENRICH)}</button>
              )}
            </div>
          )}

          {activeTab === 'exception' && (
            <div className="notice notice--danger">
              <ShieldOff aria-hidden="true" />
              <p>Estes itens batem com as exceções de {selectedClient?.name} (gateway, parceiros, a própria empresa) e nunca são gravados.</p>
            </div>
          )}

          {activeTab === 'invalid' && preview.invalidCount > 0 && (
            <div className="notice notice--danger">
              <XCircle aria-hidden="true" />
              <p>{preview.invalidCount} {preview.invalidCount === 1 ? 'linha não é um indicador válido e não será gravada' : 'linhas não são indicadores válidos e não serão gravadas'}.</p>
              <button type="button" onClick={handleDiscardAllInvalids} className="btn btn--sm btn--danger">
                <Trash2 aria-hidden="true" />
                Remover inválidos
              </button>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <div
              key={activeTab}
              className="view-enter max-h-[460px] overflow-y-auto p-1.5 font-mono text-xs"
              style={{ '--preview-ip': `${Math.min(40, Math.max(16, ...itemsOfTab(activeTab).map((i) => i.indicator.length + 1)))}ch` } as React.CSSProperties}
            >
              {(() => {
                const currentItems = itemsOfTab(activeTab);
                if (currentItems.length === 0) {
                  return (
                    <div className="empty-state">
                      <Check aria-hidden="true" />
                      <p>Nada nesta categoria.</p>
                    </div>
                  );
                }
                return currentItems.map((item, idx) => {
                  const rep = cti[item.indicator];
                  const skipped = skipLegit && rep?.verdict === 'legit' && item.category === 'new';
                  const index = preview.items.indexOf(item);
                  if (editingIndex === index) {
                    return (
                      <div key={idx} className="preview-row">
                        <form className="preview-row__edit" onSubmit={(e) => { e.preventDefault(); void applyEdit(index, editValue); }}>
                          <input
                            className="field font-mono"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditingIndex(null); }}
                            aria-label={`Corrigir ${item.indicator}`}
                            autoFocus
                          />
                          <button type="submit" className="btn btn--sm btn--primary" disabled={isAnalyzing}>Salvar</button>
                          <button type="button" className="btn btn--sm" onClick={() => setEditingIndex(null)}>Cancelar</button>
                        </form>
                        <span />
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className={`preview-row ${skipped ? 'opacity-50' : ''}`}>
                      <div className="preview-row__ip">
                        <b title={item.indicator}>{item.indicator}</b>
                        {item.original !== item.indicator && <small title={item.original}>original: {item.original}</small>}
                      </div>
                      <span className="data-tag justify-self-start">{item.type.replace('_', ' ')}</span>
                      {rep ? <CtiInline summary={rep} /> : <span />}

                      <div className="font-sans text-xs text-right">
                        {item.category === 'new' && (skipped ? <span className="text-sky-300">Legítimo · não será gravado</span> : <span className="text-emerald-400">Será gravado</span>)}
                        {item.category === 'dup_in_file' && <span className="text-slate-400">Repetido no arquivo</span>}
                        {item.category === 'already_exists' && <span className="text-slate-400">{importMode === 'replace' ? 'Já está na lista · continua' : 'Já está na lista'}</span>}
                        {item.category === 'covered_by_cidr' && (
                          <span className="text-slate-400">Coberto por <span className="font-mono text-slate-300">{item.coveredByCidr}</span></span>
                        )}
                        {item.category === 'exception' && (
                          <span className="text-rose-400">Exceção <span className="font-mono">{item.exceptionHit}</span></span>
                        )}
                        {item.category === 'invalid' && (
                          <span className="text-rose-400">{item.error}</span>
                        )}
                        {item.category === 'reserved_warning' && <span className="text-amber-400">{item.reservedReason}</span>}
                      </div>
                      <div className="preview-row__actions">
                        <button type="button" onClick={() => { setEditingIndex(index); setEditValue(item.indicator); }} disabled={isAnalyzing} className="btn btn--sm btn--icon btn--quiet" title="Corrigir" aria-label={`Corrigir ${item.indicator}`}>
                          <Pencil aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => void applyEdit(index, null)} disabled={isAnalyzing} className="btn btn--sm btn--icon btn--quiet" title="Tirar do lote" aria-label={`Tirar ${item.indicator} do lote`}>
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            <form
              className="preview-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (!addValue.trim()) return;
                void applyEdit(preview.items.length, addValue);
                setAddValue('');
              }}
            >
              <input className="field font-mono text-xs" value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="Acrescentar IP, CIDR ou domínio" aria-label="Acrescentar indicador ao lote" />
              <button type="submit" className="btn btn--sm" disabled={isAnalyzing || !addValue.trim()}><Plus aria-hidden="true" /> Acrescentar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
