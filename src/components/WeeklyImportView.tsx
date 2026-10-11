import React, { useState } from 'react';
import { FileText, AlertTriangle, XCircle, RotateCcw, Check, Trash2, Eye, ListChecks } from 'lucide-react';
import { Client, ImportPreviewSummary, BlocklistEntry, ImportHistoryRecord, ImportPreviewItem } from '../types';
import { analyzeImportBatch, extractValidIndicatorsFromText } from '../utils/importer';
import { getClientActiveIndicatorsSet } from '../db/indexedDb';
import { getIsoWeek, ipv4ToNumber, isValidIPv4 } from '../utils/validator';
import { PageHeader } from './PageHeader';

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
      <PageHeader
        title="Importação semanal"
        description="Cole os indicadores da semana ou carregue o arquivo. Nada é gravado antes da pré-visualização, e a deduplicação considera só o cliente escolhido."
      />

      {!preview ? (
        <div className="data-panel p-5 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label" htmlFor="import-client">Cliente</label>
              <select
                id="import-client"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="field w-full font-mono"
              >
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.lastUpdateDate ? `· última ${c.lastUpdateDate}` : '· sem importação'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="import-ticket">Fonte ou ticket <span className="text-slate-500 font-normal">(opcional)</span></label>
              <input
                id="import-ticket"
                type="text"
                placeholder="SEC-2026-849"
                value={sourceTicket}
                onChange={(e) => setSourceTicket(e.target.value)}
                className="field w-full"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="import-notes">Observação do lote <span className="text-slate-500 font-normal">(opcional)</span></label>
              <input
                id="import-notes"
                type="text"
                placeholder="Varredura nas portas 22 e 3389"
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                className="field w-full"
              />
            </div>
          </div>

          <fieldset>
            <legend className="field-label">Como gravar</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`choice-card ${importMode === 'append' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'append'}
                  onChange={() => setImportMode('append')}
                />
                <span>
                  <strong>Adicionar à lista</strong>
                  <small>Inclui os novos indicadores e mantém os existentes. Repetidos são ignorados. Recomendado.</small>
                </span>
              </label>

              <label className={`choice-card choice-card--warn ${importMode === 'replace' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                <span>
                  <strong>Substituir a lista</strong>
                  <small>A lista ativa passa a ter só este lote. O que ficar de fora é arquivado, com uma versão salva para desfazer.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <label className="field-label mb-0" htmlFor="import-text">Indicadores, um por linha</label>

              <div className="flex flex-wrap items-center gap-2">
                {rawText.trim() && (
                  <button
                    type="button"
                    onClick={handleAutoCleanInput}
                    className="btn btn--sm"
                    title="Remove cabeçalhos como === IPS ÚNICOS === e separa vários indicadores da mesma linha"
                  >
                    <ListChecks aria-hidden="true" />
                    Organizar texto
                  </button>
                )}

                {fileName && <span className="data-tag">{fileName}</span>}
                <label className="btn btn--sm">
                  <FileText aria-hidden="true" />
                  Carregar arquivo
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
              id="import-text"
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={'# Linhas com # e linhas vazias são ignoradas\n185.220.101.5\n194.26.29.0/24\nevil-c2-botnet.org\n2001:db8::1'}
              className="field w-full py-3 font-mono leading-relaxed resize-y"
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-400">
                Aceita IPv4, IPv6, redes CIDR e domínios. Zeros à esquerda são normalizados e repetidos, separados.
              </p>

              <button
                type="button"
                disabled={!rawText.trim() || isAnalyzing}
                onClick={handleAnalyze}
                className="btn btn--primary"
              >
                {isAnalyzing ? 'Analisando…' : (
                  <>
                    <Eye aria-hidden="true" />
                    Pré-visualizar
                  </>
                )}
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
                  : `${preview.totalLines} linhas lidas. Só os indicadores novos entram; os existentes não mudam.`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={handleResetPreview} className="btn">
                <RotateCcw aria-hidden="true" />
                Editar lista
              </button>
              <button
                type="button"
                disabled={(preview.newCount === 0 && (!includeReservedAlerts || preview.reservedWarningCount === 0)) || isSubmitting}
                onClick={handleConfirmImport}
                className="btn btn--primary"
              >
                <Check aria-hidden="true" />
                {importMode === 'replace' ? 'Substituir' : 'Gravar'} {includeReservedAlerts ? preview.newCount + preview.reservedWarningCount : preview.newCount} itens
              </button>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Categorias da pré-visualização">
            {([
              ['new', 'Novos', preview.newCount, 'ok'],
              ['dup_in_file', 'Repetidos no arquivo', preview.dupInFileCount, ''],
              ['already_exists', 'Já na lista', preview.alreadyExistsCount, ''],
              ['covered_by_cidr', 'Cobertos por CIDR', preview.coveredByCidrCount, ''],
              ['invalid', 'Inválidos', preview.invalidCount, 'danger'],
              ['reserved_warning', 'Faixas privadas', preview.reservedWarningCount, 'warn']
            ] as const).map(([id, label, count, tone]) => (
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
            ))}
          </div>

          {activeTab === 'reserved_warning' && preview.reservedWarningCount > 0 && (
            <div className="notice notice--warn">
              <AlertTriangle aria-hidden="true" />
              <p>Estes endereços são de faixas internas (RFC 1918, loopback) e normalmente não são bloqueados na borda.</p>
              <label className="flex items-center gap-2 font-semibold cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={includeReservedAlerts}
                  onChange={(e) => setIncludeReservedAlerts(e.target.checked)}
                />
                Incluir mesmo assim ({preview.reservedWarningCount})
              </label>
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
            <div key={activeTab} className="view-enter max-h-[420px] overflow-y-auto p-1.5 font-mono text-xs">
              {(() => {
                const currentItems = preview.items.filter(i => i.category === activeTab);
                if (currentItems.length === 0) {
                  return (
                    <div className="empty-state">
                      <Check aria-hidden="true" />
                      <p>Nada nesta categoria.</p>
                    </div>
                  );
                }

                return currentItems.map((item, idx) => (
                  <div key={idx} className="preview-row">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-semibold text-white truncate">{item.indicator}</span>
                      {item.original !== item.indicator && (
                        <span className="text-[11px] text-slate-500 font-sans truncate">original: {item.original}</span>
                      )}
                      <span className="data-tag">{item.type.replace('_', ' ')}</span>
                    </div>

                    <div className="font-sans text-xs shrink-0">
                      {item.category === 'new' && <span className="text-emerald-400">Será gravado</span>}
                      {item.category === 'dup_in_file' && <span className="text-slate-400">Repetido no arquivo</span>}
                      {item.category === 'already_exists' && <span className="text-slate-400">Já está na lista</span>}
                      {item.category === 'covered_by_cidr' && (
                        <span className="text-slate-400">Coberto por <span className="font-mono text-slate-300">{item.coveredByCidr}</span></span>
                      )}
                      {item.category === 'invalid' && (
                        <span className="flex items-center gap-2">
                          <span className="text-rose-400">{item.error}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveInvalidItem(idx)}
                            className="btn btn--sm btn--icon btn--quiet"
                            title="Remover esta linha"
                            aria-label={`Remover ${item.indicator}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </span>
                      )}
                      {item.category === 'reserved_warning' && <span className="text-amber-400">{item.reservedReason}</span>}
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
