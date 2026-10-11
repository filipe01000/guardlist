import React, { useState, useMemo, useEffect } from 'react';
import { Search, ArrowUpDown, Trash2, Edit3, Copy, Check, Download, AlertTriangle, ShieldCheck, RotateCcw, ScanSearch, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock, Terminal, History, Undo2, CheckSquare, Square, ListChecks, Radio, RefreshCw, Plus } from 'lucide-react';
import { Client, BlocklistEntry, IndicatorType, IndicatorStatus, ClientSnapshot } from '../types';
import { IpDossierModal } from './IpDossierModal';
import { PageHeader } from './PageHeader';
import { 
  getClientEntries, 
  updateEntryStatus, 
  updateEntryNotes, 
  bulkDeleteEntries,
  createClientSnapshot,
  getClientSnapshots,
  restoreClientSnapshot,
  deleteClientEntriesAll,
  deleteSnapshot,
  cleanRedundantEntries
} from '../db/store';
import { findRedundant, type RedundantMatch } from '../utils/redundancy';
import { 
  generateFirewallTxt, 
  generateNanoFormattedTxt,
  generateFullCSV, 
  triggerDownload, 
  sortEntriesNumerically 
} from '../utils/exporter';
import { extractTokensFromRawInput } from '../utils/importer';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { AbuseListSummary, fetchAbuseListSummary } from '../utils/ctiService';

type RowCtiState = AbuseListSummary | {
  indicator: string;
  fetchedAt: string;
  status: 'loading';
};

interface ClientListViewProps {
  clients: Client[];
  selectedClientId: string;
  onSelectClient: (clientId: string) => void;
  onRefreshStats: () => void;
  onAddIndicators: (clientId: string) => void;
}

export const ClientListView: React.FC<ClientListViewProps> = ({
  clients,
  selectedClientId,
  onSelectClient,
  onRefreshStats,
  onAddIndicators
}) => {
  const activeClients = clients.filter(c => !c.isArchived);
  const currentClient = activeClients.find(c => c.id === selectedClientId) || activeClients[0];

  const [entries, setEntries] = useState<BlocklistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rowCti, setRowCti] = useState<Record<string, RowCtiState>>({});
  const [ctiProgress, setCtiProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastCtiRefresh, setLastCtiRefresh] = useState<{ at: Date; elapsedMs: number; count: number } | null>(null);

  // Filtros e Busca
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'removed'>('active');
  const [periodFilter, setPeriodFilter] = useState<'ALL' | '7d' | '30d' | 'year'>('ALL');
  const [sortNumeric, setSortNumeric] = useState(true);

  // Paginação
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Seleção Múltipla & Seleção com Ctrl / Shift
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // "Caixa para colocar e ir marcando" (Marcador por Lista)
  const [showBatchMatchModal, setShowBatchMatchModal] = useState(false);
  const [batchMatchInput, setBatchMatchInput] = useState('');
  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);

  // Snapshots & Versões Anteriores (Desfazer / Rollback)
  const [showSnapshotsModal, setShowSnapshotsModal] = useState(false);
  const [snapshots, setSnapshots] = useState<ClientSnapshot[]>([]);
  const [newSnapshotLabel, setNewSnapshotLabel] = useState('');
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);

  // Excluir Toda a Lista (Zerar Lista)
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearConfirmName, setClearConfirmName] = useState('');

  // Estados de ações individuais
  const [copiedIndicator, setCopiedIndicator] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<BlocklistEntry | null>(null);
  const [editNotesText, setEditNotesText] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Verificação de Duplicatas
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [redundantMatches, setRedundantMatches] = useState<RedundantMatch<BlocklistEntry>[]>([]);
  const [isCleaningRedundant, setIsCleaningRedundant] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Modal de Exportação / Pré-visualização NANO
  const [showNanoModal, setShowNanoModal] = useState(false);
  const [copiedNano, setCopiedNano] = useState(false);

  // Ficha de Inteligência CTI
  const [selectedIpForDossier, setSelectedIpForDossier] = useState<string | null>(null);
  const hasInternalDialog = showBatchMatchModal || showSnapshotsModal || showClearAllModal || showDuplicateModal || showNanoModal || Boolean(editingEntry) || Boolean(deleteConfirmId);
  const internalDialogRef = useDialogFocus(hasInternalDialog);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowBatchMatchModal(false);
      setShowSnapshotsModal(false);
      setShowClearAllModal(false);
      setShowDuplicateModal(false);
      setShowNanoModal(false);
      setEditingEntry(null);
      setDeleteConfirmId(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // Carregar dados sempre que mudar o cliente
  const loadClientData = async () => {
    if (!currentClient) return;
    setIsLoading(true);
    try {
      const data = await getClientEntries(currentClient.id);
      setEntries(data);
      setSelectedIds(new Set());
      setLastClickedIndex(null);
    } catch (err) {
      console.error('Erro ao carregar entradas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSnapshots = async () => {
    if (!currentClient) return;
    try {
      const snaps = await getClientSnapshots(currentClient.id);
      setSnapshots(snaps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadClientData();
    loadSnapshots();
    setPage(1);
  }, [currentClient?.id]);

  // Filtragem e Ordenação
  const filteredEntries = useMemo(() => {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const yearStart = `${now.getFullYear()}-01-01`;

    const q = searchTerm.trim().toLowerCase();

    return entries.filter(item => {
      // Filtro de Status
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }

      // Filtro de Tipo
      if (typeFilter !== 'ALL' && item.type !== typeFilter) {
        return false;
      }

      // Filtro de Período
      if (periodFilter === '7d' && item.addedDate < d7) return false;
      if (periodFilter === '30d' && item.addedDate < d30) return false;
      if (periodFilter === 'year' && item.addedDate < yearStart) return false;

      // Busca por texto
      if (q) {
        const matchInd = item.indicator.toLowerCase().includes(q);
        const matchTicket = (item.sourceTicket || '').toLowerCase().includes(q);
        const matchNotes = (item.notes || '').toLowerCase().includes(q);
        if (!matchInd && !matchTicket && !matchNotes) return false;
      }

      return true;
    });
  }, [entries, statusFilter, typeFilter, periodFilter, searchTerm]);

  // Ordenação
  const sortedEntries = useMemo(() => {
    if (sortNumeric) {
      return sortEntriesNumerically(filteredEntries);
    }
    return [...filteredEntries].sort((a, b) => new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime());
  }, [filteredEntries, sortNumeric]);

  // Paginação
  const totalPages = Math.ceil(sortedEntries.length / pageSize) || 1;
  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedEntries.slice(start, start + pageSize);
  }, [sortedEntries, page, pageSize]);

  const handleEnrichVisibleIps = async () => {
    const targets = Array.from(new Map(
      paginatedEntries
        .filter(item => item.type === 'IPv4' || item.type === 'IPv6')
        .map(item => [item.indicator, item])
    ).values());
    if (targets.length === 0 || ctiProgress) return;

    const startedAt = performance.now();
    setCtiProgress({ done: 0, total: targets.length });
    setRowCti(previous => {
      const next = { ...previous };
      targets.forEach(item => {
        next[item.indicator] = { indicator: item.indicator, fetchedAt: '', status: 'loading' };
      });
      return next;
    });

    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        try {
          const summary = await fetchAbuseListSummary(target.indicator, { forceRefresh: true });
          setRowCti(previous => ({ ...previous, [target.indicator]: summary }));
        } catch (error) {
          setRowCti(previous => ({
            ...previous,
            [target.indicator]: {
              indicator: target.indicator,
              fetchedAt: new Date().toISOString(),
              status: 'error',
              message: error instanceof Error ? error.message : 'Consulta indisponível.'
            }
          }));
        } finally {
          completed += 1;
          setCtiProgress({ done: completed, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(8, targets.length) }, () => worker()));
    setLastCtiRefresh({
      at: new Date(),
      elapsedMs: Math.round(performance.now() - startedAt),
      count: targets.length
    });
    setCtiProgress(null);
  };

  // Exportar para Arquivo
  const handleExportTxt = () => {
    if (!currentClient) return;
    const activeOnly = entries.filter(e => e.status === 'active');
    const content = generateFirewallTxt(activeOnly, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_${today}.txt`, content, 'text/plain;charset=utf-8');
  };

  const handleExportNanoTxt = () => {
    if (!currentClient) return;
    const activeOnly = entries.filter(e => e.status === 'active');
    const content = generateNanoFormattedTxt(activeOnly, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_nano_${today}.txt`, content, 'text/plain;charset=utf-8');
  };

  const handleCopyNanoText = () => {
    if (!currentClient) return;
    const activeOnly = entries.filter(e => e.status === 'active');
    const content = generateNanoFormattedTxt(activeOnly, sortNumeric);
    navigator.clipboard.writeText(content);
    setCopiedNano(true);
    setTimeout(() => setCopiedNano(false), 2000);
  };

  const handleExportCsv = () => {
    if (!currentClient) return;
    const content = generateFullCSV(entries, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_${today}.csv`, content, 'text/csv;charset=utf-8');
  };

  // ==========================================
  // SELEÇÃO MÚLTIPLA & ATALHOS (CTRL / SHIFT)
  // ==========================================
  const handleToggleSelectRow = (id: string, index: number, e?: React.MouseEvent) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      // Inverte a seleção com Ctrl / Cmd
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastClickedIndex(index);
      return;
    }

    if (e && e.shiftKey && lastClickedIndex !== null) {
      // Seleção em intervalo (Range) com Shift
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const rangeIds = paginatedEntries.slice(start, end + 1).map(item => item.id);
      setSelectedIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(i => next.add(i));
        return next;
      });
      return;
    }

    // Clique simples no checkbox
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedIndex(index);
  };

  const handleSelectAllVisible = () => {
    const visibleIds = paginatedEntries.map(e => e.id);
    const allVisibleSelected = visibleIds.every(id => selectedIds.has(id));

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach(id => next.delete(id));
      } else {
        visibleIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  // "Caixa para colocar e ir marcando"
  const handleExecuteBatchMatch = () => {
    if (!batchMatchInput.trim()) return;
    const tokens = extractTokensFromRawInput(batchMatchInput).map(t => t.token.toLowerCase());
    const tokenSet = new Set(tokens);

    let matchCount = 0;
    const matchedIds: string[] = [];

    for (const item of entries) {
      if (tokenSet.has(item.indicator.toLowerCase())) {
        matchedIds.push(item.id);
        matchCount++;
      }
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      matchedIds.forEach(id => next.add(id));
      return next;
    });

    setMatchFeedback(`${matchCount} indicadores localizados e marcados na tabela.`);
  };

  // Ações em Lote para Selecionados
  const handleBulkToggleStatus = async (targetStatus: 'active' | 'removed') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    for (const id of ids) {
      await updateEntryStatus(id, targetStatus);
    }
    setEntries(prev => prev.map(e => ids.includes(e.id) ? { ...e, status: targetStatus } : e));
    setSelectedIds(new Set());
    onRefreshStats();
  };

  const handleBulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (window.confirm(`Deseja excluir definitivamente os ${ids.length} itens selecionados?`)) {
      // Criar snapshot de segurança antes
      await createClientSnapshot(currentClient.id, `Antes de excluir ${ids.length} itens em lote`);
      await bulkDeleteEntries(ids);
      setEntries(prev => prev.filter(e => !ids.includes(e.id)));
      setSelectedIds(new Set());
      loadSnapshots();
      onRefreshStats();
    }
  };

  const handleExportSelectedNano = () => {
    const selectedEntries = entries.filter(e => selectedIds.has(e.id));
    const content = generateNanoFormattedTxt(selectedEntries, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_selecionados_nano_${today}.txt`, content, 'text/plain;charset=utf-8');
  };

  // ==========================================
  // SNAPSHOTS & RESTAURAÇÃO (UNDO / VERSÕES)
  // ==========================================
  const handleCreateManualSnapshot = async () => {
    if (!currentClient) return;
    await createClientSnapshot(currentClient.id, newSnapshotLabel.trim() || 'Ponto de restauração manual');
    setNewSnapshotLabel('');
    await loadSnapshots();
  };

  const handleRestoreSnapshot = async (snap: ClientSnapshot) => {
    if (!window.confirm(`Deseja restaurar a versão de ${new Date(snap.createdAt).toLocaleString('pt-BR')} (${snap.entriesCount} itens)? As alterações atuais serão revertidas para esta versão.`)) {
      return;
    }
    setIsRestoringSnapshot(true);
    try {
      await restoreClientSnapshot(snap.id);
      await loadClientData();
      await loadSnapshots();
      onRefreshStats();
      setShowSnapshotsModal(false);
      alert('Versão restaurada.');
    } catch (err: any) {
      alert(`Erro ao restaurar versão: ${err.message}`);
    } finally {
      setIsRestoringSnapshot(false);
    }
  };

  const handleDeleteSnapshotItem = async (snapId: string) => {
    await deleteSnapshot(snapId);
    await loadSnapshots();
  };

  // ==========================================
  // EXCLUIR TODA A LISTA DO CLIENTE
  // ==========================================
  const handleConfirmClearAll = async () => {
    if (!currentClient) return;
    if (clearConfirmName.trim().toUpperCase() !== currentClient.name.toUpperCase()) {
      alert('O nome digitado não confere com o nome do cliente.');
      return;
    }

    const removed = await deleteClientEntriesAll(currentClient.id);
    await loadClientData();
    await loadSnapshots();
    onRefreshStats();
    setShowClearAllModal(false);
    setClearConfirmName('');
    alert(`A blocklist de ${currentClient.name} foi zerada (${removed} entradas excluídas). Um snapshot de segurança foi criado para permitir desfazer se necessário.`);
  };

  // Alternar Status Individual
  const handleToggleStatus = async (item: BlocklistEntry) => {
    const nextStatus = item.status === 'active' ? 'removed' : 'active';
    await updateEntryStatus(item.id, nextStatus);
    setEntries(prev => prev.map(e => e.id === item.id ? { ...e, status: nextStatus } : e));
    onRefreshStats();
  };

  // Salvar Observação Editada
  const handleSaveNotes = async () => {
    if (!editingEntry) return;
    await updateEntryNotes(editingEntry.id, editNotesText.trim());
    setEntries(prev => prev.map(e => e.id === editingEntry.id ? { ...e, notes: editNotesText.trim() } : e));
    setEditingEntry(null);
  };

  // Excluir definitivamente Individual
  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    await bulkDeleteEntries([deleteConfirmId]);
    setEntries(prev => prev.filter(e => e.id !== deleteConfirmId));
    setDeleteConfirmId(null);
    onRefreshStats();
  };

  // Copiar Indicador
  const handleCopy = (indicator: string) => {
    navigator.clipboard.writeText(indicator);
    setCopiedIndicator(indicator);
    setTimeout(() => setCopiedIndicator(null), 2000);
  };

  // Repetidos e itens já cobertos por um CIDR da lista ativa (mesma regra do servidor: fica o mais antigo/abrangente)
  const handleCheckDuplicates = () => {
    setIsCheckingDuplicates(true);
    const activeEntries = entries
      .filter(e => e.status === 'active')
      .sort((a, b) => String(a.addedDate || '').localeCompare(String(b.addedDate || '')) || a.id.localeCompare(b.id));
    setRedundantMatches(findRedundant(activeEntries, e => e.indicator));
    setShowDuplicateModal(true);
    setIsCheckingDuplicates(false);
  };

  // Retira os redundantes (ficam como removidos, com o motivo na observação; uma versão é salva antes)
  const handleCleanDuplicatesBatch = async () => {
    if (!currentClient || redundantMatches.length === 0) return;
    setIsCleaningRedundant(true);
    try {
      await cleanRedundantEntries(currentClient.id);
      await loadClientData();
      await loadSnapshots();
      onRefreshStats();
      setShowDuplicateModal(false);
    } finally {
      setIsCleaningRedundant(false);
    }
  };

  const isAllVisibleSelected = paginatedEntries.length > 0 && paginatedEntries.every(e => selectedIds.has(e.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Listas dos clientes"
        description="Cada lista é isolada: buscas, marcações e exportações valem só para o cliente selecionado."
        actions={
          <>
            <select
              value={currentClient?.id}
              onChange={(e) => onSelectClient(e.target.value)}
              className="field font-mono font-bold text-[0.9rem] min-w-[180px]"
              aria-label="Cliente"
            >
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {currentClient && (
              <button type="button" className="btn" onClick={() => onAddIndicators(currentClient.id)}>
                <Plus aria-hidden="true" />
                Adicionar indicadores
              </button>
            )}
          </>
        }
      />

      <div className="action-bar">
        <div className="action-bar__group">
          <button
            type="button"
            onClick={handleExportNanoTxt}
            className="btn btn--primary"
            title="Baixar .txt no formato NANO, com as seções === IPS ÚNICOS === e === REDES CIDR ==="
          >
            <Download aria-hidden="true" />
            Exportar NANO
          </button>
          <button
            type="button"
            onClick={() => setShowNanoModal(true)}
            className="btn"
            title="Ver e copiar o texto NANO para colar no terminal"
          >
            <Terminal aria-hidden="true" />
            Copiar NANO
          </button>
          <button type="button" onClick={handleExportTxt} className="btn" title="Baixar só os ativos, um por linha">
            .txt
          </button>
          <button type="button" onClick={handleExportCsv} className="btn" title="Baixar todas as colunas e o histórico em CSV">
            .csv
          </button>
        </div>

        <div className="action-bar__group">
          <button
            type="button"
            onClick={() => {
              loadSnapshots();
              setShowSnapshotsModal(true);
            }}
            className="btn"
            title="Versões salvas desta lista; use para desfazer importações ou exclusões"
          >
            <Undo2 aria-hidden="true" />
            Versões
            <span className="tabs__count">{snapshots.length}</span>
          </button>
          <button
            type="button"
            onClick={handleCheckDuplicates}
            className="btn"
            title="Procurar indicadores repetidos e IPs já cobertos por um CIDR da lista ativa"
          >
            <ScanSearch aria-hidden="true" />
            Validar lista
          </button>
          <button
            type="button"
            onClick={() => setShowClearAllModal(true)}
            className="btn btn--quiet btn--danger"
            title="Apagar toda a lista deste cliente (uma versão é salva antes)"
          >
            <Trash2 aria-hidden="true" />
            Zerar lista
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label className="field field--search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar IP, CIDR, domínio, ticket ou observação"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            aria-label="Buscar na lista"
          />
        </label>

        <div className="toolbar__group">
          <button
            type="button"
            onClick={() => {
              setMatchFeedback(null);
              setShowBatchMatchModal(true);
            }}
            className="btn btn--sm"
            title="Colar uma lista de IPs para localizar e marcar na tabela"
          >
            <ListChecks aria-hidden="true" />
            Marcar por lista
          </button>

          <button
            type="button"
            onClick={handleEnrichVisibleIps}
            disabled={Boolean(ctiProgress) || !paginatedEntries.some(item => item.type === 'IPv4' || item.type === 'IPv6')}
            className="btn btn--sm"
            title="Consultar de novo o AbuseIPDB para os IPs desta página"
          >
            <RefreshCw className={ctiProgress ? 'animate-spin' : ''} aria-hidden="true" />
            {ctiProgress ? `Consultando ${ctiProgress.done}/${ctiProgress.total}` : 'Consultar AbuseIPDB'}
          </button>

          {lastCtiRefresh && !ctiProgress && (
            <span className="text-[11px] text-slate-400 tabular-nums" role="status">
              {lastCtiRefresh.count} IPs às {lastCtiRefresh.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="field"
            aria-label="Filtrar por situação"
          >
            <option value="active">Ativos</option>
            <option value="removed">Removidos</option>
            <option value="ALL">Ativos e removidos</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="field"
            aria-label="Filtrar por tipo"
          >
            <option value="ALL">Todos os tipos</option>
            <option value="IPv4">IPv4</option>
            <option value="CIDR_v4">CIDR v4</option>
            <option value="IPv6">IPv6</option>
            <option value="CIDR_v6">CIDR v6</option>
            <option value="Domain">Domínio</option>
          </select>

          <select
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value as typeof periodFilter);
              setPage(1);
            }}
            className="field"
            aria-label="Filtrar por período"
          >
            <option value="ALL">Qualquer data</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="year">Este ano</option>
          </select>

          <button
            type="button"
            onClick={() => setSortNumeric(!sortNumeric)}
            className="btn btn--sm"
            aria-pressed={sortNumeric}
            title="Alternar entre ordem numérica de IP e ordem por data"
          >
            <ArrowUpDown aria-hidden="true" />
            {sortNumeric ? 'Por IP' : 'Por data'}
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="selection-bar" role="region" aria-label="Ações para os itens selecionados">
          <div className="flex items-center gap-2">
            <span className="selection-bar__count">{selectedIds.size}</span>
            <span className="text-slate-200">{selectedIds.size === 1 ? 'selecionado' : 'selecionados'}</span>
            <span className="text-slate-500 text-[11px] hidden md:inline">Ctrl+clique alterna · Shift+clique seleciona um intervalo</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => handleBulkToggleStatus('removed')} className="btn btn--sm">Marcar como removido</button>
            <button type="button" onClick={() => handleBulkToggleStatus('active')} className="btn btn--sm">Reativar</button>
            <button type="button" onClick={handleExportSelectedNano} className="btn btn--sm">
              <Download aria-hidden="true" />
              Exportar NANO
            </button>
            <button type="button" onClick={handleBulkDeleteSelected} className="btn btn--sm btn--danger">
              <Trash2 aria-hidden="true" />
              Excluir
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="btn btn--sm btn--quiet">Limpar seleção</button>
          </div>
        </div>
      )}

      {/* Tabela de Entradas com Checkboxes e Suporte a Ctrl/Shift */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="list-table w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold select-none">
                {/* Checkbox de Selecionar Todos Visíveis */}
                <th className="py-3 px-3 w-10 text-center">
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    className="text-slate-400 hover:text-white transition p-1"
                    title={isAllVisibleSelected ? 'Desmarcar visíveis' : 'Selecionar todos os visíveis'}
                  >
                    {isAllVisibleSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4 w-52">Indicador</th>
                <th className="py-3 px-3 w-56">Domínio / hostname</th>
                <th className="py-3 px-3 w-32 text-center">Ocorrências · 90d</th>
                <th className="py-3 px-3 w-24">Tipo</th>
                <th className="py-3 px-3 w-28">Incluído em</th>
                <th className="py-3 px-3 w-36">Fonte / Ticket</th>
                <th className="py-3 px-3 w-28">Status</th>
                <th className="py-3 px-4">Observações</th>
                <th className="py-3 px-4 w-28 text-right">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {paginatedEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                    Nenhum indicador encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                paginatedEntries.map((item, idx) => {
                  const isActive = item.status === 'active';
                  const isSelected = selectedIds.has(item.id);
                  const intelligence = rowCti[item.indicator];
                  const isIp = item.type === 'IPv4' || item.type === 'IPv6';
                  const primaryHostname = intelligence?.status === 'ok'
                    ? intelligence.data?.hostnames?.[0] || intelligence.data?.domain
                    : undefined;
                  const parentDomain = intelligence?.status === 'ok' && intelligence.data?.domain !== primaryHostname
                    ? intelligence.data?.domain
                    : undefined;

                  return (
                    <tr
                      key={item.id}
                      onClick={(e) => handleToggleSelectRow(item.id, idx, e)}
                      className={`cursor-pointer transition-colors group select-none ${
                        isSelected 
                          ? 'bg-blue-950/50 hover:bg-blue-900/40 text-white' 
                          : !isActive 
                          ? 'opacity-60 bg-slate-950/30 hover:bg-slate-800/40' 
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      {/* Checkbox de Linha */}
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => handleToggleSelectRow(item.id, idx, e)}
                          className="p-1 text-slate-400 hover:text-white transition"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-700 group-hover:text-slate-500" />
                          )}
                        </button>
                      </td>

                      {/* Indicador */}
                      <td className="py-2.5 px-4 font-bold text-white">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIpForDossier(item.indicator);
                            }}
                            className={`text-xs font-bold hover:text-blue-300 hover:underline transition cursor-pointer text-left ${item.isReservedAlert ? 'text-amber-400' : 'text-white'}`}
                            title="Clique para abrir a Ficha Técnica / Dossiê CTI Completo"
                          >
                            {item.indicator}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIpForDossier(item.indicator);
                            }}
                            className="p-1 text-slate-500 hover:text-blue-300 rounded transition opacity-0 group-hover:opacity-100"
                            title="Abrir Ficha de Inteligência CTI"
                          >
                            <Radio className="w-3 h-3 text-blue-400" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(item.indicator);
                            }}
                            className="p-1 text-slate-500 hover:text-white rounded transition opacity-0 group-hover:opacity-100"
                            title="Copiar Indicador"
                          >
                            {copiedIndicator === item.indicator ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>

                          {item.isReservedAlert && (
                            <span 
                              className="text-[10px] text-amber-400 font-sans px-1 rounded bg-amber-950 border border-amber-800"
                              title={item.reservedReason || 'Faixa privada RFC1918'}
                            >
                              Privado
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Domínio / hostname proveniente do AbuseIPDB */}
                      <td className="py-2.5 px-3 font-sans min-w-48">
                        {item.type === 'Domain' ? (
                          <span className="text-slate-200 text-[11px]">{item.indicator}</span>
                        ) : !isIp ? (
                          <span className="text-slate-600">—</span>
                        ) : intelligence?.status === 'loading' ? (
                          <span className="inline-flex items-center gap-1.5 text-blue-300 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            Consultando…
                          </span>
                        ) : intelligence?.status === 'ok' ? (
                          <div className="max-w-56 leading-tight">
                            <span className="block text-slate-200 text-[11px] truncate" title={primaryHostname || 'Sem hostname associado'}>
                              {primaryHostname || 'Sem hostname associado'}
                            </span>
                            {parentDomain && (
                              <span className="block mt-1 text-[10px] text-slate-500 truncate" title={parentDomain}>
                                {parentDomain}
                              </span>
                            )}
                          </div>
                        ) : intelligence ? (
                          <span className="text-amber-400 text-[11px]" title={intelligence.message}>
                            {intelligence.status === 'not_configured' ? 'Chave não configurada' : intelligence.status === 'rate_limited' ? 'Limite atingido' : 'Indisponível'}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Não consultado</span>
                        )}
                      </td>

                      {/* Total de reportes do intervalo maxAgeInDays=90 */}
                      <td className="py-2.5 px-3 font-sans text-center">
                        {isIp && intelligence?.status === 'ok' ? (
                          <span
                            className={`inline-flex min-w-8 justify-center rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums ${
                              (intelligence.data?.totalReports || 0) > 0
                                ? 'bg-rose-950/50 text-rose-300 border-rose-800/70'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                            title={`Reportes recebidos pelo AbuseIPDB nos últimos 90 dias${intelligence.data?.lastReportedAt ? ` · último em ${new Date(intelligence.data.lastReportedAt).toLocaleString('pt-BR')}` : ''}`}
                          >
                            {intelligence.data?.totalReports ?? 0}
                          </span>
                        ) : intelligence?.status === 'loading' ? (
                          <span className="text-blue-300 animate-pulse">···</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Tipo */}
                      <td className="py-2.5 px-3 font-sans">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 font-bold border border-slate-700 text-slate-300">
                          {item.type}
                        </span>
                      </td>

                      {/* Data Inclusão */}
                      <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px]">
                        {item.addedDate}
                      </td>

                      {/* Fonte / Ticket */}
                      <td className="py-2.5 px-3 font-sans text-slate-300 text-[11px]">
                        {item.sourceTicket || '-'}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 font-sans">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                          isActive
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {isActive ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                              Ativo
                            </>
                          ) : (
                            <>
                              <XCircle className="w-2.5 h-2.5 text-slate-500" />
                              Removido
                            </>
                          )}
                        </span>
                      </td>

                      {/* Observação */}
                      <td className="py-2.5 px-4 font-sans text-slate-400 text-xs truncate max-w-xs" title={item.notes}>
                        {item.notes || '-'}
                      </td>

                      {/* Ações */}
                      <td className="py-2.5 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Alternar Status */}
                          <button
                            onClick={() => handleToggleStatus(item)}
                            className={`p-1.5 rounded transition ${
                              isActive
                                ? 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
                                : 'text-slate-500 hover:text-emerald-400 hover:bg-slate-800'
                            }`}
                            title={isActive ? 'Marcar como Removido (preserva histórico)' : 'Reativar Indicador'}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>

                          {/* Editar observação */}
                          <button
                            onClick={() => {
                              setEditingEntry(item);
                              setEditNotesText(item.notes || '');
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition"
                            title="Editar observação"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Excluir definitivamente */}
                          <button
                            onClick={() => setDeleteConfirmId(item.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                            title="Excluir definitivamente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé da Tabela com Paginação */}
        <div className="bg-slate-950/80 px-4 py-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div>
            Exibindo <strong>{paginatedEntries.length}</strong> de <strong>{sortedEntries.length}</strong> itens filtrados (Total do cliente: {entries.length})
            {selectedIds.size > 0 && <span className="ml-2 text-blue-400 font-semibold">• {selectedIds.size} marcados</span>}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>Por página:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-slate-900 text-slate-200 border border-slate-700 rounded px-2 py-1 focus:outline-none"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-1.5 rounded bg-slate-900 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="p-1.5 rounded bg-slate-900 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: "Caixa para colocar e ir marcando" (Marcador por Lista) */}
      {showBatchMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Seleção rápida por lista" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 modal-panel">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  Marcar por lista
                </h3>
              </div>
              <button
                onClick={() => setShowBatchMatchModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Fechar
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Cole aqui a lista de IPs que você deseja localizar. O sistema irá percorrer a blocklist de <strong>{currentClient?.name}</strong> e marcar todos eles na tabela para você poder aplicar ações em lote (remover, excluir ou exportar).
            </p>

            <textarea
              rows={8}
              value={batchMatchInput}
              onChange={(e) => setBatchMatchInput(e.target.value)}
              placeholder={'Cole os IPs aqui (um por linha, ou separados por espaço)...\n200.219.11.15\n93.187.128.69\n45.205.1.240/29'}
              className="w-full bg-slate-950 font-mono text-xs text-white p-3.5 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500"
            />

            {matchFeedback && (
              <div className="p-3 bg-blue-950/60 border border-blue-800 rounded-xl text-xs text-blue-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{matchFeedback}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setBatchMatchInput('')}
                className="text-xs text-slate-400 hover:text-white"
              >
                Limpar
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchMatchModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBatchMatch}
                  disabled={!batchMatchInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl transition shadow"
                >
                  Marcar na tabela
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Versões Anteriores / Snapshots (Desfazer) */}
      {showSnapshotsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Versões anteriores da lista" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  Versões de {currentClient?.name}
                </h3>
              </div>
              <button
                onClick={() => setShowSnapshotsModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Fechar
              </button>
            </div>

            <p className="text-xs text-slate-300">
              A cada importação ou limpeza, um snapshot de segurança é criado automaticamente. Você pode reverter qualquer erro restaurando uma versão anterior com 1 clique.
            </p>

            {/* Criar Ponto de Restauração Manual */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-xs">
              <input
                type="text"
                placeholder="Nome do ponto manual (ex: Backup antes de atualizar firewall)"
                value={newSnapshotLabel}
                onChange={(e) => setNewSnapshotLabel(e.target.value)}
                className="flex-1 bg-slate-900 text-white p-2 rounded-lg border border-slate-700 focus:outline-none"
              />
              <button
                onClick={handleCreateManualSnapshot}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-lg transition whitespace-nowrap"
              >
                Salvar versão atual
              </button>
            </div>

            {/* Lista de Versões */}
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {snapshots.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  Nenhum snapshot gravado para este cliente ainda. Eles são criados automaticamente a cada importação.
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          {snap.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                          {snap.entriesCount} itens
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-slate-500" />
                        Criado em: {new Date(snap.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        disabled={isRestoringSnapshot}
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1 shadow"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Restaurar / Desfazer
                      </button>

                      <button
                        onClick={() => handleDeleteSnapshotItem(snap.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-900 transition"
                        title="Excluir este snapshot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Zerar / Excluir Toda a Lista */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirmar exclusão da lista" className="bg-slate-900 border border-rose-900/60 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 modal-panel">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">
                Zerar a lista de {currentClient?.name}?
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Você está prestes a excluir <strong>todas as {entries.length} entradas</strong> cadastradas para este cliente.
            </p>

            <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-xs text-blue-300">
              Antes de apagar, uma versão da lista é salva. Para voltar atrás, use <strong>Versões</strong>.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Digite o nome do cliente (<span className="text-white font-mono">{currentClient?.name}</span>) para confirmar:
              </label>
              <input
                type="text"
                placeholder={currentClient?.name}
                value={clearConfirmName}
                onChange={(e) => setClearConfirmName(e.target.value)}
                className="w-full bg-slate-950 text-white text-xs p-2.5 rounded-xl border border-slate-700 uppercase font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowClearAllModal(false);
                  setClearConfirmName('');
                }}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={clearConfirmName.trim().toUpperCase() !== currentClient?.name.toUpperCase()}
                onClick={handleConfirmClearAll}
                className="disabled-action bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition shadow"
              >
                Zerar lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verificação de Duplicatas na Lista Inteira */}
      {showDuplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Verificação de duplicatas" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ScanSearch className="w-5 h-5 text-slate-400" />
                <h3 className="text-base font-bold text-white">
                  Validação da lista · {currentClient?.name}
                </h3>
              </div>
              <button
                onClick={() => setShowDuplicateModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Fechar
              </button>
            </div>

            {redundantMatches.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">Nada repetido ou coberto</h4>
                <p className="text-xs text-slate-400">
                  A lista ativa de {currentClient?.name} não tem indicadores repetidos nem IPs dentro de um CIDR da própria lista.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="notice notice--warn">
                  <AlertTriangle aria-hidden="true" />
                  <p>
                    <strong>{redundantMatches.length}</strong>{' '}
                    {redundantMatches.length === 1 ? 'item sobra' : 'itens sobram'} na lista ativa
                    {' '}({redundantMatches.filter(m => m.reason === 'duplicate').length} repetido(s),{' '}
                    {redundantMatches.filter(m => m.reason === 'cidr').length} dentro de CIDR).
                    Ao retirar, eles ficam como removidos, com o motivo na observação, e uma versão é salva antes.
                  </p>
                  <button
                    type="button"
                    onClick={handleCleanDuplicatesBatch}
                    disabled={isCleaningRedundant}
                    className="btn btn--sm btn--primary whitespace-nowrap"
                  >
                    {isCleaningRedundant ? 'Retirando…' : `Retirar ${redundantMatches.length}`}
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 p-1.5 font-mono text-xs">
                  {redundantMatches.map(match => (
                    <div key={match.item.id} className="preview-row">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-semibold text-white truncate">{match.item.indicator}</span>
                        <span className="data-tag">{match.item.type.replace('_', ' ')}</span>
                        <span className="text-[11px] text-slate-500 font-sans truncate">{match.item.addedDate}</span>
                      </div>
                      <span className="font-sans text-slate-400 shrink-0">
                        {match.reason === 'duplicate' ? 'Repetido de ' : 'Coberto por '}
                        <span className="font-mono text-slate-300">{match.coveredBy}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Visualizar & Copiar Formato NANO */}
      {showNanoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Visualização do formato NANO" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  Formato NANO (Linux Firewall): {currentClient?.name}
                </h3>
              </div>
              <button
                onClick={() => setShowNanoModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Fechar
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Este formato separa automaticamente os IPs únicos das sub-redes CIDR para você colar diretamente no terminal com o editor <strong>nano</strong>.
            </p>

            <div className="relative">
              <pre className="w-full bg-slate-950 font-mono text-xs text-blue-300 p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-80 select-all leading-relaxed whitespace-pre">
                {generateNanoFormattedTxt(entries, sortNumeric)}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Use o botão ou Ctrl+C para copiar.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyNanoText}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow"
                >
                  {copiedNano ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  {copiedNano ? 'Copiado' : 'Copiar texto NANO'}
                </button>

                <button
                  onClick={handleExportNanoTxt}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  Baixar .txt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Editar observação */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Editar observação" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white">Editar observação</h3>
            <p className="text-xs text-slate-400 font-mono">
              Indicador: <span className="text-white font-bold">{editingEntry.indicator}</span>
            </p>
            <textarea
              rows={4}
              value={editNotesText}
              onChange={(e) => setEditNotesText(e.target.value)}
              placeholder="Digite a observação para este bloqueio..."
              className="w-full bg-slate-950 text-white text-xs p-3 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingEntry(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNotes}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Confirmação de Exclusão Definitiva Individual */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirmar exclusão definitiva" className="bg-slate-900 border border-rose-900/50 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">Excluir definitivamente?</h3>
            </div>
            <p className="text-xs text-slate-300">
              Esta ação removerá este indicador definitivamente do banco local (sem manter histórico). Se desejar apenas desativar, use a opção de marcar como "Removido".
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold"
              >
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Ficha Técnica / Dossiê CTI do Indicador */}
      {selectedIpForDossier && (
        <IpDossierModal
          indicator={selectedIpForDossier}
          onClose={() => setSelectedIpForDossier(null)}
          allEntries={entries}
          clients={clients}
        />
      )}
    </div>
  );
};
