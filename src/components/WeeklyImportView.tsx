import React, { useState } from 'react';
import { 
  UploadCloud, 
  FileText, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  XCircle, 
  ShieldAlert, 
  Building2, 
  ArrowRight, 
  RotateCcw,
  Check,
  Tag,
  Trash2,
  Wand2
} from 'lucide-react';
import { Client, ImportPreviewSummary, BlocklistEntry, ImportHistoryRecord, ImportPreviewItem } from '../types';
import { analyzeImportBatch, extractValidIndicatorsFromText } from '../utils/importer';
import { getClientActiveIndicatorsSet } from '../db/indexedDb';
import { getIsoWeek, ipv4ToNumber, isValidIPv4 } from '../utils/validator';

interface WeeklyImportViewProps {
  clients: Client[];
  initialClientId?: string;
  onImportSuccess: (clientId: string, addedCount: number) => void;
  onSaveBatch: (
    entries: BlocklistEntry[],
    clientId: string,
    historyRecord: ImportHistoryRecord,
    todayStr: string,
    mode?: 'append' | 'replace'
  ) => Promise<void>;
}

export const WeeklyImportView: React.FC<WeeklyImportViewProps> = ({
  clients,
  initialClientId,
  onImportSuccess,
  onSaveBatch
}) => {
  const activeClients = clients.filter(c => !c.isArchived);
  const [selectedClientId, setSelectedClientId] = useState<string>(
    initialClientId || activeClients[0]?.id || ''
  );

  const [rawText, setRawText] = useState('');
  const [sourceTicket, setSourceTicket] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');

  // Estados de análise e pré-visualização
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [activeTab, setActiveTab] = useState<
    'new' | 'dup_in_file' | 'already_exists' | 'covered_by_cidr' | 'invalid' | 'reserved_warning'
  >('new');

  // Opção para permitir importar IPs de alerta reservado caso o usuário queira explicitamente
  const [includeReservedAlerts, setIncludeReservedAlerts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedClient = activeClients.find(c => c.id === selectedClientId);

  // Leitura de arquivo .txt ou .csv
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        setRawText(content);
      }
    };
    reader.readAsText(file);
  };

  // Auto-higienizar texto de entrada
  const handleAutoCleanInput = () => {
    if (!rawText.trim()) return;
    const valids = extractValidIndicatorsFromText(rawText);
    if (valids.length > 0) {
      setRawText(valids.join('\n'));
    } else {
      alert('Nenhum IP ou CIDR válido foi encontrado no texto fornecido.');
    }
  };

  // Descartar todos os inválidos da pré-visualização
  const handleDiscardAllInvalids = () => {
    if (!preview) return;
    const filteredItems = preview.items.filter(i => i.category !== 'invalid');
    setPreview({
      ...preview,
      invalidCount: 0,
      totalLines: filteredItems.length,
      items: filteredItems
    });
    if (activeTab === 'invalid') {
      setActiveTab('new');
    }
  };

  // Remover um item inválido específico
  const handleRemoveInvalidItem = (idxToRemove: number) => {
    if (!preview) return;
    const filteredItems = preview.items.filter((_, idx) => idx !== idxToRemove);
    const newInvalidCount = filteredItems.filter(i => i.category === 'invalid').length;
    setPreview({
      ...preview,
      invalidCount: newInvalidCount,
      totalLines: filteredItems.length,
      items: filteredItems
    });
  };

  // Executar análise contra a base do cliente
  const handleAnalyze = async () => {
    if (!selectedClientId || !rawText.trim()) return;

    setIsAnalyzing(true);
    try {
      // Obter indicadores e CIDRs ativos exclusivos deste cliente
      const { activeSet, activeCidrs } = await getClientActiveIndicatorsSet(selectedClientId);
      const summary = analyzeImportBatch(rawText, activeSet, activeCidrs);
      setPreview(summary);

      // Posicionar na primeira aba com itens
      if (summary.newCount > 0) {
        setActiveTab('new');
      } else if (summary.dupInFileCount > 0) {
        setActiveTab('dup_in_file');
      } else if (summary.alreadyExistsCount > 0) {
        setActiveTab('already_exists');
      } else if (summary.coveredByCidrCount > 0) {
        setActiveTab('covered_by_cidr');
      } else if (summary.reservedWarningCount > 0) {
        setActiveTab('reserved_warning');
      } else {
        setActiveTab('invalid');
      }
    } catch (err) {
      console.error('Erro ao analisar lote:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Confirmar gravação
  const handleConfirmImport = async () => {
    if (!preview || !selectedClient) return;

    setIsSubmitting(true);
    const today = new Date().toISOString().split('T')[0];
    const isoWeek = getIsoWeek();

    // Itens que serão gravados
    const itemsToSave = preview.items.filter(item => {
      if (item.category === 'new') return true;
      if (includeReservedAlerts && item.category === 'reserved_warning') return true;
      return false;
    });

    const entriesToSave: BlocklistEntry[] = itemsToSave.map(item => {
      const isIpv4 = item.type === 'IPv4' && isValidIPv4(item.indicator);
      return {
        id: `entry-${selectedClient.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        clientId: selectedClient.id,
        indicator: item.indicator,
        originalInput: item.original,
        type: item.type,
        addedDate: today,
        sourceTicket: sourceTicket.trim() || undefined,
        status: 'active',
        notes: batchNotes.trim() || undefined,
        isReservedAlert: item.category === 'reserved_warning',
        reservedReason: item.reservedReason,
        numericValue: isIpv4 ? ipv4ToNumber(item.indicator) : undefined
      };
    });

    const historyRecord: ImportHistoryRecord = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      date: new Date().toISOString(),
      isoWeek,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      sourceTicket: sourceTicket.trim() || undefined,
      totalBefore: 0, // Será atualizado pela transação
      addedCount: entriesToSave.length,
      duplicatesDiscarded: preview.dupInFileCount + preview.alreadyExistsCount,
      coveredByCidrDiscarded: preview.coveredByCidrCount,
      invalidsDiscarded: preview.invalidCount,
      totalAfter: 0,
      notes: batchNotes.trim() || undefined
    };

    try {
      await onSaveBatch(entriesToSave, selectedClient.id, historyRecord, today, importMode);
      onImportSuccess(selectedClient.id, entriesToSave.length);
      // Resetar form
      setPreview(null);
      setRawText('');
      setFileName(null);
      setSourceTicket('');
      setBatchNotes('');
    } catch (err) {
      console.error('Erro ao salvar importação:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPreview = () => {
    setPreview(null);
  };

  return (
    <div className="space-y-6">
      {/* Banner Principal */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30">
                <UploadCloud className="w-5 h-5 text-purple-400" />
              </span>
              <h2 className="text-lg font-bold text-white">
                Rotina de Importação Semanal
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Processamento seguro e deduplicação isolada por cliente. Cole a lista de novos IPs ou envie o arquivo da semana para pré-visualizar antes de gravar.
            </p>
          </div>

          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 text-xs text-slate-400">
            <span className="block text-[10px] uppercase font-semibold text-slate-500">
              Regra de Isolamento
            </span>
            <span className="text-emerald-400 font-medium">
              Deduplicação 100% restrita ao cliente selecionado
            </span>
          </div>
        </div>
      </div>

      {/* ETAPA 1: Formulário de Entrada (quando não houver pré-visualização ativa) */}
      {!preview ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Selecionar Cliente */}
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                1. Selecione o Cliente:
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl p-2.5 border border-slate-700 font-semibold focus:outline-none focus:border-purple-500 text-xs sm:text-sm font-mono"
              >
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.lastUpdateDate ? `(Última: ${c.lastUpdateDate})` : '(Sem atualização)'}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Fonte / Ticket */}
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-purple-400" />
                2. Fonte / Ticket / Chamado (Opcional):
              </label>
              <input
                type="text"
                placeholder="Ex: TICKET-2026-849 ou AbuseIPDB"
                value={sourceTicket}
                onChange={(e) => setSourceTicket(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl p-2.5 border border-slate-700 focus:outline-none focus:border-purple-500 text-xs sm:text-sm"
              >
              </input>
            </div>

            {/* 3. Observação Geral */}
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                3. Observação do Lote:
              </label>
              <input
                type="text"
                placeholder="Ex: Varredura de scanner porta 22 e 3389"
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl p-2.5 border border-slate-700 focus:outline-none focus:border-purple-500 text-xs sm:text-sm"
              />
            </div>
          </div>

          {/* Modo de Importação: Adicionar vs Substituir (Evita remoções acidentais) */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <label className="block text-xs font-semibold text-slate-200">
              Modo de Operação da Importação:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label 
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  importMode === 'append'
                    ? 'bg-blue-950/40 border-blue-500 text-blue-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'append'}
                  onChange={() => setImportMode('append')}
                  className="mt-0.5 text-blue-500"
                />
                <div>
                  <strong className="block text-white font-semibold">
                    Adicionar Novos IPs (Modo Padrão - Mais Seguro)
                  </strong>
                  <span className="text-[11px] opacity-80 mt-0.5 block leading-relaxed">
                    Insere novos indicadores sem alterar ou remover os IPs existentes. Itens repetidos são ignorados automaticamente.
                  </span>
                </div>
              </label>

              <label 
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                  importMode === 'replace'
                    ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="mt-0.5 text-amber-500"
                />
                <div>
                  <strong className="block text-white font-semibold flex items-center gap-1.5">
                    Substituir Lista do Cliente (Sincronização Completa)
                  </strong>
                  <span className="text-[11px] opacity-80 mt-0.5 block leading-relaxed">
                    A blocklist ativa passa a ter exatamente os IPs deste lote. Itens que não constarem são arquivados com snapshot automático de rollback.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Área de Entrada de Texto ou Arquivo */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-200">
                Lista de IPs / Indicadores (um por linha):
              </label>

              <div className="flex flex-wrap items-center gap-2">
                {rawText.trim() && (
                  <button
                    type="button"
                    onClick={handleAutoCleanInput}
                    className="text-xs font-semibold bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-800/80 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title="Remove automaticamente cabeçalhos === IPS ÚNICOS ===, === REDES CIDR ===, e quebra múltiplos IPs na mesma linha em 1 por linha"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                    Auto-Organizar &amp; Limpar Texto
                  </button>
                )}

                {fileName && (
                  <span className="text-xs text-purple-300 bg-purple-950 px-2 py-1 rounded border border-purple-800">
                    Arquivo: {fileName}
                  </span>
                )}
                <label className="cursor-pointer text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-purple-400" />
                  Carregar Arquivo (.txt / .csv)
                  <input
                    type="file"
                    accept=".txt,.csv,.log"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>

            <textarea
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={'# Cole a lista aqui (comentários com # e linhas vazias serão ignorados)\n185.220.101.5\n010.008.001.001 (zeros à esquerda serão normalizados para 10.8.1.1)\n194.26.29.0/24\nevil-c2-botnet.org\n2001:db8::1\n185.220.101.5 (duplicatas serão separadas automaticamente)'}
              className="w-full bg-slate-950 font-mono text-xs text-slate-100 p-4 rounded-xl border border-slate-700 focus:outline-none focus:border-purple-500 leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-400">
                Suporta: IPv4, IPv6, CIDR v4/v6 e FQDNs de Domínio. Normalização e desduplicação automática.
              </div>

              <button
                disabled={!rawText.trim() || isAnalyzing}
                onClick={handleAnalyze}
                className="disabled-action bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm py-2.5 px-6 rounded-xl shadow-lg transition flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <span>Analisando...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Analisar e Pré-visualizar Lote
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ETAPA 2: Tela de PRÉ-VISUALIZAÇÃO COM ABAS */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          {/* Cabeçalho do Resultado */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-white">
                  Pré-visualização para o cliente: <span className="text-purple-400">{selectedClient?.name}</span>
                </span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded font-mono ${
                  importMode === 'replace'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                    : 'bg-blue-950 text-blue-300 border border-blue-800'
                }`}>
                  {importMode === 'replace' ? 'Modo Substituir Lista' : 'Modo Adicionar Novos'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {importMode === 'replace' ? (
                  <span className="text-amber-300">
                    ⚠️ Atenção: A blocklist deste cliente será espelhada para este lote. Entradas antigas ausentes serão desativadas com snapshot automático de rollback.
                  </span>
                ) : (
                  <span>
                    Total de <strong>{preview.totalLines}</strong> itens processados. Apenas novos IPs serão adicionados, mantendo intactos os existentes.
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleResetPreview}
                className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Alterar Lista
              </button>

              <button
                disabled={preview.newCount === 0 && (!includeReservedAlerts || preview.reservedWarningCount === 0) || isSubmitting}
                onClick={handleConfirmImport}
                className={`disabled-action text-white font-bold text-xs sm:text-sm py-2 px-5 rounded-xl shadow-lg transition flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed ${
                  importMode === 'replace'
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                <Check className="w-4 h-4" />
                Confirmar {importMode === 'replace' ? 'Substituição' : 'Importação'} ({includeReservedAlerts ? preview.newCount + preview.reservedWarningCount : preview.newCount} Itens)
              </button>
            </div>
          </div>

          {/* Abas de Pré-visualização com Contadores */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3 text-xs">
            {/* 1. Novos */}
            <button
              onClick={() => setActiveTab('new')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'new'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Novos ({preview.newCount})
            </button>

            {/* 2. Duplicados na própria importação */}
            <button
              onClick={() => setActiveTab('dup_in_file')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'dup_in_file'
                  ? 'bg-amber-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Duplicados no Arquivo ({preview.dupInFileCount})
            </button>

            {/* 3. Já existentes no cliente */}
            <button
              onClick={() => setActiveTab('already_exists')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'already_exists'
                  ? 'bg-slate-700 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              Já Existem no Cliente ({preview.alreadyExistsCount})
            </button>

            {/* 4. Já cobertos por CIDR existente */}
            <button
              onClick={() => setActiveTab('covered_by_cidr')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'covered_by_cidr'
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-blue-400" />
              Já Cobertos por CIDR ({preview.coveredByCidrCount})
            </button>

            {/* 5. Inválidos */}
            <button
              onClick={() => setActiveTab('invalid')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'invalid'
                  ? 'bg-rose-600 text-white shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              Inválidos ({preview.invalidCount})
            </button>

            {/* 6. Alertas: IPs Privados/Reservados */}
            <button
              onClick={() => setActiveTab('reserved_warning')}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
                activeTab === 'reserved_warning'
                  ? 'bg-amber-500 text-black shadow'
                  : 'bg-slate-950 text-amber-400 hover:text-white border border-amber-800/60'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Alertas: IPs Privados/Reservados ({preview.reservedWarningCount})
            </button>
          </div>

          {/* Opção especial para Alertas Reservados */}
          {activeTab === 'reserved_warning' && preview.reservedWarningCount > 0 && (
            <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Normalmente estes IPs pertencem a faixas internas (RFC1918, Loopback) e não devem ser bloqueados em borda. Deseja forçar inclusão?
                </span>
              </div>
              <label className="flex items-center gap-2 text-amber-300 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeReservedAlerts}
                  onChange={(e) => setIncludeReservedAlerts(e.target.checked)}
                  className="rounded border-amber-700 bg-slate-950 text-amber-500 focus:ring-0"
                />
                Forçar Importação destes {preview.reservedWarningCount} IPs
              </label>
            </div>
          )}

          {/* Opção especial para Aba de Inválidos */}
          {activeTab === 'invalid' && preview.invalidCount > 0 && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-rose-200">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  Foram encontrados <strong>{preview.invalidCount}</strong> itens com texto/formato inválido. Eles não serão importados.
                </span>
              </div>
              <button
                type="button"
                onClick={handleDiscardAllInvalids}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar / Descartar Todos os Inválidos
              </button>
            </div>
          )}

          {/* Lista de Itens da Aba Selecionada */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-850 p-2 font-mono text-xs">
              {(() => {
                const currentItems = preview.items.filter(i => i.category === activeTab);
                if (currentItems.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-500 font-sans">
                      Nenhum item nesta categoria.
                    </div>
                  );
                }

                return currentItems.map((item, idx) => (
                  <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-slate-900/60 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-white text-sm">
                        {item.indicator}
                      </span>
                      {item.original !== item.indicator && (
                        <span className="text-[11px] text-slate-500 font-sans">
                          (original: {item.original})
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-sans">
                        {item.type}
                      </span>
                    </div>

                    <div className="font-sans text-xs">
                      {item.category === 'new' && (
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Será adicionado
                        </span>
                      )}
                      {item.category === 'dup_in_file' && (
                        <span className="text-amber-400">
                          Descartado (repetido no arquivo)
                        </span>
                      )}
                      {item.category === 'already_exists' && (
                        <span className="text-slate-400">
                          Descartado (já existe neste cliente)
                        </span>
                      )}
                      {item.category === 'covered_by_cidr' && (
                        <span className="text-blue-400">
                          Descartado (já coberto pelo bloco <strong>{item.coveredByCidr}</strong>)
                        </span>
                      )}
                      {item.category === 'invalid' && (
                        <div className="flex items-center gap-2">
                          <span className="text-rose-400">
                            Erro: {item.error}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveInvalidItem(idx)}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded transition"
                            title="Remover este item inválido"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {item.category === 'reserved_warning' && (
                        <span className="text-amber-400">
                          {item.reservedReason}
                        </span>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
