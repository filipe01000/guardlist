import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, ArrowUpDown, Trash2, Edit3, Copy, Check, Download, AlertTriangle, ShieldCheck, RotateCcw, ScanSearch, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock, Terminal, History, Undo2, CheckSquare, Square, ListChecks, Radio, RefreshCw, Plus, MessageSquare, ShieldOff, Send } from 'lucide-react';
import { Client, BlocklistEntry, IndicatorType, ClientSnapshot, EntryComment } from '../types';
import { Modal } from './Modal';
import ActionMenu from './ActionMenu';
import type { ShowToast } from '../App';
import { formatDateBR, formatDateTimeBR } from '../utils/csv';
import { IpDossierModal } from './IpDossierModal';
import { PageHeader } from './PageHeader';
import { 
  getClientEntries, 
  getClientEntriesPage,
  getIndicatorEntries,
  updateEntryStatus, 
  updateEntryNotes, 
  bulkDeleteEntries,
  createClientSnapshot,
  getClientSnapshots,
  restoreClientSnapshot,
  deleteClientEntriesAll,
  deleteSnapshot,
  cleanRedundantEntries,
  getCommentCounts,
  getComments,
  addComment,
  deleteComment,
  updateClientExceptions
} from '../db/store';
import { findExceptionConflicts, findRedundant } from '../utils/redundancy';
import { classifyIndicator, normalizeIndicator } from '../utils/validator';

type ListIssue = { item: BlocklistEntry; coveredBy: string; reason: 'duplicate' | 'cidr' | 'exception' };
import { 
  generateFirewallTxt, 
  generateNanoFormattedTxt,
  generateFullCSV, 
  triggerDownload
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
  showToast: ShowToast;
  isAdmin: boolean;
}

export const ClientListView: React.FC<ClientListViewProps> = ({
  clients,
  selectedClientId,
  onSelectClient,
  onRefreshStats,
  onAddIndicators,
  showToast,
  isAdmin
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  // Comentários por item
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [commentEntry, setCommentEntry] = useState<BlocklistEntry | null>(null);
  const [comments, setComments] = useState<EntryComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  // Exceções do cliente
  const [showExceptions, setShowExceptions] = useState(false);
  const [exceptionsText, setExceptionsText] = useState('');
  const [exceptionsError, setExceptionsError] = useState<string | null>(null);
  const [exceptionsBusy, setExceptionsBusy] = useState(false);
  const activeClients = clients.filter(c => !c.isArchived);
  const currentClient = activeClients.find(c => c.id === selectedClientId) || activeClients[0];

  const [entries, setEntries] = useState<BlocklistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [totalClient, setTotalClient] = useState(0);
  const requestVersion = useRef(0);
  const selectedEntryCache = useRef(new Map<string, BlocklistEntry>());
  const [fullListBusy, setFullListBusy] = useState(false);
  const fullActionBusy = useRef(false);
  const [rowCti, setRowCti] = useState<Record<string, RowCtiState>>({});
  const [ctiProgress, setCtiProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastCtiRefresh, setLastCtiRefresh] = useState<{ at: Date; elapsedMs: number; count: number } | null>(null);

  // Filtros e Busca
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | IndicatorType>('ALL');
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
  const [redundantMatches, setRedundantMatches] = useState<ListIssue[]>([]);
  const [isCleaningRedundant, setIsCleaningRedundant] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);

  // Modal de Exportação / Pré-visualização NANO
  const [showNanoModal, setShowNanoModal] = useState(false);
  const [copiedNano, setCopiedNano] = useState(false);
  const [nanoText, setNanoText] = useState('');

  // Ficha de Inteligência CTI
  const [selectedIpForDossier, setSelectedIpForDossier] = useState<string | null>(null);
  const [dossierEntries, setDossierEntries] = useState<BlocklistEntry[]>([]);
  const [dossierState, setDossierState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [dossierRetry, setDossierRetry] = useState(0);
  const openDossier = (indicator: string) => {
    setDossierEntries([]);
    setDossierState('loading');
    setDossierError(null);
    setSelectedIpForDossier(indicator);
  };
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

  const queryRef = useRef({ clientId: '', search: '', type: typeFilter, status: statusFilter, period: periodFilter, sort: 'numeric' as 'numeric' | 'date', page: 1, pageSize: 100 });
  queryRef.current = { clientId: currentClient?.id || '', search: debouncedSearch, type: typeFilter, status: statusFilter, period: periodFilter, sort: sortNumeric ? 'numeric' : 'date', page, pageSize };

  // Filtros, ordenação e paginação são aplicados no servidor.
  const loadClientData = useCallback(async (clearSelection = false) => {
    const query = queryRef.current;
    if (!query.clientId) return;
    const version = ++requestVersion.current;
    const isCurrent = () => version === requestVersion.current && JSON.stringify(query) === JSON.stringify(queryRef.current);
    if (clearSelection) {
      setSelectedIds(new Set());
      selectedEntryCache.current.clear();
    }
    setIsLoading(true);
    setLoadError(null);
    setEntries([]);
    try {
      const data = await getClientEntriesPage(query);
      if (!isCurrent()) return;
      setEntries(data.entries);
      setTotalFiltered(data.total);
      setTotalClient(data.totalClient);
      if (data.page !== query.page) setPage(data.page);
      setLastClickedIndex(null);
      getCommentCounts(query.clientId, data.entries.map(item => item.id))
        .then(counts => { if (version === requestVersion.current) setCommentCounts(counts); })
        .catch(() => { if (version === requestVersion.current) setCommentCounts({}); });
    } catch (err) {
      if (isCurrent()) setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar a lista.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    void loadClientData();
    return () => { requestVersion.current += 1; };
  }, [currentClient?.id, debouncedSearch, typeFilter, statusFilter, periodFilter, sortNumeric, page, pageSize, loadClientData]);

  useEffect(() => {
    entries.forEach(item => { if (selectedIds.has(item.id)) selectedEntryCache.current.set(item.id, item); });
    selectedEntryCache.current.forEach((_, id) => { if (!selectedIds.has(id)) selectedEntryCache.current.delete(id); });
  }, [entries, selectedIds]);

  useEffect(() => {
    if (!selectedIpForDossier) return;
    let cancelled = false;
    setDossierState('loading');
    setDossierError(null);
    getIndicatorEntries(selectedIpForDossier)
      .then(matches => {
        if (cancelled) return;
        setDossierEntries(matches);
        setDossierState('ready');
      })
      .catch(error => {
        if (cancelled) return;
        setDossierError(error instanceof Error ? error.message : 'Não foi possível carregar as ocorrências deste indicador nos clientes.');
        setDossierState('error');
      });
    return () => { cancelled = true; };
  }, [selectedIpForDossier, dossierRetry]);

  const loadSnapshots = async () => {
    if (!currentClient) return;
    try {
      const snaps = await getClientSnapshots(currentClient.id);
      if (currentClient.id === queryRef.current.clientId) setSnapshots(snaps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    void loadSnapshots();
    setSelectedIds(new Set());
    selectedEntryCache.current.clear();
    setLastClickedIndex(null);
    setShowNanoModal(false);
    setNanoText('');
    setSelectedIpForDossier(null);
    setTotalFiltered(0);
    setTotalClient(0);
    setPage(1);
  }, [currentClient?.id]);

  // Atalhos da lista: N adiciona, V valida, E exporta NANO, F busca.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'n' && currentClient) { event.preventDefault(); onAddIndicators(currentClient.id); }
      else if (key === 'v') { event.preventDefault(); handleCheckDuplicates(); }
      else if (key === 'e') { event.preventDefault(); handleExportNanoTxt(); }
      else if (key === 'f') { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openComments = async (item: BlocklistEntry) => {
    setCommentEntry(item);
    setComments([]);
    setCommentText('');
    try {
      setComments(await getComments(item.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível carregar os comentários.', 'warn');
    }
  };

  const submitComment = async () => {
    if (!commentEntry || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      const list = await addComment(commentEntry.id, commentText.trim());
      setComments(list);
      setCommentText('');
      setCommentCounts((prev) => ({ ...prev, [commentEntry.id]: list.length }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível comentar.', 'warn');
    } finally {
      setCommentBusy(false);
    }
  };

  const openExceptions = () => {
    setExceptionsError(null);
    setExceptionsText((currentClient?.exceptions || []).map((e) => (e.reason ? `${e.indicator}  # ${e.reason}` : e.indicator)).join('\n'));
    setShowExceptions(true);
  };

  // Uma exceção por linha; o que vem depois de # é o motivo.
  const saveExceptions = async () => {
    if (!currentClient) return;
    const parsed: Array<{ indicator: string; reason?: string }> = [];
    const invalid: string[] = [];
    for (const line of exceptionsText.split(/\r?\n/)) {
      const [rawIndicator, ...reasonParts] = line.split('#');
      const indicator = normalizeIndicator(rawIndicator || '');
      if (!indicator) continue;
      if (!classifyIndicator(indicator).isValid) invalid.push(rawIndicator.trim());
      else parsed.push({ indicator, reason: reasonParts.join('#').trim() || undefined });
    }
    if (invalid.length) return setExceptionsError(`Linhas inválidas: ${invalid.slice(0, 5).join(', ')}`);
    setExceptionsBusy(true);
    try {
      const result = await updateClientExceptions(currentClient.id, parsed);
      setShowExceptions(false);
      onRefreshStats();
      await loadClientData();
      await loadSnapshots();
      showToast(
        `${result.exceptions.length} exceç${result.exceptions.length === 1 ? 'ão salva' : 'ões salvas'}.${result.retired ? ` ${result.retired} item(ns) da lista conflitavam e foram retirados.` : ''}`
      );
    } catch (err) {
      setExceptionsError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setExceptionsBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const paginatedEntries = entries;
  const emptyMessage = isLoading ? 'Carregando indicadores…' : loadError ? 'A lista não pôde ser carregada.' : 'Nenhum indicador encontrado para os filtros selecionados.';

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

  // Ações da lista inteira carregam os dados somente quando solicitadas.
  const runFullListAction = async (action: (all: BlocklistEntry[]) => void | Promise<void>, status?: 'active' | 'removed') => {
    if (!currentClient || fullActionBusy.current) return;
    const clientId = currentClient.id;
    fullActionBusy.current = true;
    setFullListBusy(true);
    try {
      const all = await getClientEntries(clientId, status);
      if (clientId === queryRef.current.clientId) await action(all);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível carregar a lista completa.', 'warn');
    } finally {
      fullActionBusy.current = false;
      setFullListBusy(false);
    }
  };

  const handleExportTxt = () => runFullListAction(all => {
    const content = generateFirewallTxt(all, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_${today}.txt`, content, 'text/plain;charset=utf-8');
  }, 'active');

  const handleExportNanoTxt = () => runFullListAction(all => {
    const content = generateNanoFormattedTxt(all, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_nano_${today}.txt`, content, 'text/plain;charset=utf-8');
  }, 'active');

  const handleOpenNano = () => runFullListAction(all => {
    setNanoText(generateNanoFormattedTxt(all, sortNumeric));
    setCopiedNano(false);
    setShowNanoModal(true);
  }, 'active');

  const handleCopyNanoText = async () => {
    try {
      await navigator.clipboard.writeText(nanoText);
      setCopiedNano(true);
      setTimeout(() => setCopiedNano(false), 2000);
    } catch {
      showToast('Não foi possível copiar. Selecione o texto e use Ctrl+C.', 'warn');
    }
  };

  const handleExportCsv = () => runFullListAction(all => {
    const content = generateFullCSV(all, sortNumeric);
    const today = new Date().toISOString().split('T')[0];
    triggerDownload(`${currentClient.name}_blocklist_${today}.csv`, content, 'text/csv;charset=utf-8');
  });

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
    return runFullListAction(all => {
      const matches = all.filter(item => tokenSet.has(item.indicator.toLowerCase()));
      matches.forEach(item => selectedEntryCache.current.set(item.id, item));
      setSelectedIds(prev => {
        const next = new Set(prev);
        matches.forEach(item => next.add(item.id));
        return next;
      });
      setMatchFeedback(`${matches.length} indicadores localizados e marcados em toda a lista, incluindo outras páginas.`);
    });
  };

  const getSelectedEntries = () => Array.from(selectedIds)
    .map(id => selectedEntryCache.current.get(id) || entries.find(item => item.id === id))
    .filter((item): item is BlocklistEntry => Boolean(item));

  // Ações em Lote para Selecionados
  const handleBulkToggleStatus = async (targetStatus: 'active' | 'removed') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const previous = getSelectedEntries().map(e => ({ id: e.id, status: e.status }));
    for (const id of ids) {
      await updateEntryStatus(id, targetStatus);
    }
    setSelectedIds(new Set());
    await loadClientData();
    onRefreshStats();
    showToast(`${ids.length} ${targetStatus === 'removed' ? 'marcado(s) como removido(s)' : 'reativado(s)'}.`, {
      action: {
        label: 'Desfazer',
        onClick: async () => {
          for (const p of previous) await updateEntryStatus(p.id, p.status);
          await loadClientData();
          onRefreshStats();
          showToast('Alteração desfeita.', 'info');
        }
      }
    });
  };

  const handleBulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (window.confirm(`Deseja excluir definitivamente os ${ids.length} itens selecionados?`)) {
      // Criar snapshot de segurança antes
      const snap = await createClientSnapshot(currentClient.id, `Antes de excluir ${ids.length} itens em lote`);
      await bulkDeleteEntries(ids);
      setSelectedIds(new Set());
      await loadClientData();
      loadSnapshots();
      onRefreshStats();
      showToast(`${ids.length} item(ns) excluído(s).`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            await restoreClientSnapshot(snap.id);
            await loadClientData(true);
            await loadSnapshots();
            onRefreshStats();
            showToast('Exclusão desfeita.', 'info');
          }
        }
      });
    }
  };

  const handleExportSelectedNano = () => {
    const selectedEntries = getSelectedEntries();
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
      await loadClientData(true);
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
    await loadClientData(true);
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
    await loadClientData();
    onRefreshStats();
    showToast(`${item.indicator} ${nextStatus === 'removed' ? 'marcado como removido' : 'reativado'}.`, {
      action: {
        label: 'Desfazer',
        onClick: async () => {
          await updateEntryStatus(item.id, item.status);
          await loadClientData();
          onRefreshStats();
        }
      }
    });
  };

  // Salvar Observação Editada
  const handleSaveNotes = async () => {
    if (!editingEntry) return;
    await updateEntryNotes(editingEntry.id, editNotesText.trim());
    await loadClientData();
    setEditingEntry(null);
  };

  // Excluir definitivamente Individual
  const handleConfirmDelete = async () => {
    if (!deleteConfirmId || !currentClient) return;
    const target = entries.find(e => e.id === deleteConfirmId);
    const snap = await createClientSnapshot(currentClient.id, `Antes de excluir ${target?.indicator ?? 'um item'}`);
    await bulkDeleteEntries([deleteConfirmId]);
    setSelectedIds(previous => { const next = new Set(previous); next.delete(deleteConfirmId); return next; });
    await loadClientData();
    setDeleteConfirmId(null);
    onRefreshStats();
    loadSnapshots();
    showToast(`${target?.indicator ?? 'Item'} excluído.`, {
      action: {
        label: 'Desfazer',
        onClick: async () => {
          await restoreClientSnapshot(snap.id);
          await loadClientData(true);
          await loadSnapshots();
          onRefreshStats();
        }
      }
    });
  };

  // Copiar Indicador
  const handleCopy = (indicator: string) => {
    navigator.clipboard.writeText(indicator);
    setCopiedIndicator(indicator);
    setTimeout(() => setCopiedIndicator(null), 2000);
  };

  // Repetidos e itens já cobertos por um CIDR da lista ativa (mesma regra do servidor: fica o mais antigo/abrangente)
  const handleCheckDuplicates = async () => {
    if (!currentClient || fullActionBusy.current) return;
    setIsCheckingDuplicates(true);
    try {
      await runFullListAction(all => {
        const activeEntries = all.sort((a, b) => String(a.addedDate || '').localeCompare(String(b.addedDate || '')) || a.id.localeCompare(b.id));
        const conflicts = findExceptionConflicts(activeEntries, e => e.indicator, (currentClient.exceptions || []).map(x => x.indicator));
        const conflictSet = new Set(conflicts.map(c => c.item));
        setRedundantMatches([
          ...conflicts.map(c => ({ item: c.item, coveredBy: c.exception, reason: 'exception' as const })),
          ...findRedundant(activeEntries.filter(e => !conflictSet.has(e)), e => e.indicator)
        ]);
        setShowDuplicateModal(true);
      }, 'active');
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  // Retira os redundantes (ficam como removidos, com o motivo na observação; uma versão é salva antes)
  const handleCleanDuplicatesBatch = async () => {
    if (!currentClient || redundantMatches.length === 0) return;
    setIsCleaningRedundant(true);
    try {
      await cleanRedundantEntries(currentClient.id);
      await loadClientData(true);
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
              <button type="button" className="btn" onClick={openExceptions} title="IPs, redes ou domínios que nunca podem ser bloqueados neste cliente">
                <ShieldOff aria-hidden="true" />
                Exceções
                <span className="tabs__count">{currentClient.exceptions?.length || 0}</span>
              </button>
            )}
            {currentClient && (
              <button type="button" className="btn btn--primary" onClick={() => onAddIndicators(currentClient.id)} title="Atalho: N">
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
            disabled={fullListBusy}
            className="btn btn--primary"
            title="Baixar .txt no formato NANO, com as seções === IPS ÚNICOS === e === REDES CIDR ==="
          >
            <Download aria-hidden="true" />
            Exportar NANO
          </button>
          <button
            type="button"
            onClick={handleOpenNano}
            disabled={fullListBusy}
            className="btn"
            title="Ver e copiar o texto NANO para colar no terminal"
          >
            <Terminal aria-hidden="true" />
            Copiar NANO
          </button>
          <button type="button" onClick={handleExportTxt} disabled={fullListBusy} className="btn" title="Baixar só os ativos, um por linha">
            .txt
          </button>
          <button type="button" onClick={handleExportCsv} disabled={fullListBusy} className="btn" title="Baixar todas as colunas e o histórico em CSV">
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
            disabled={fullListBusy || isCheckingDuplicates}
            className="btn"
            title="Procurar indicadores repetidos e IPs já cobertos por um CIDR da lista ativa"
          >
            <ScanSearch aria-hidden="true" />
            {isCheckingDuplicates ? 'Validando…' : 'Validar lista'}
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
            ref={searchRef}
            type="search"
            placeholder="Buscar IP, CIDR, domínio, ticket ou observação (F)"
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
              setTypeFilter(e.target.value as typeof typeFilter);
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
            onClick={() => { setSortNumeric(!sortNumeric); setPage(1); }}
            className="btn btn--sm"
            aria-pressed={sortNumeric}
            title="Alternar entre ordem numérica de IP e ordem por data"
          >
            <ArrowUpDown aria-hidden="true" />
            {sortNumeric ? 'Por IP' : 'Por data'}
          </button>
        </div>
      </div>

      {fullListBusy && <p className="text-xs text-slate-400" role="status">Preparando a lista completa…</p>}
      {loadError && (
        <div className="notice notice--danger flex items-center justify-between gap-3" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn btn--sm" onClick={() => void loadClientData()}>Tentar novamente</button>
        </div>
      )}

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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm" aria-busy={isLoading}>
        <div className="entry-cards" aria-label="Itens da lista">
          {paginatedEntries.length === 0 ? (
            <p className="py-8 text-center text-slate-500 text-xs" role="status">{emptyMessage}</p>
          ) : (
            paginatedEntries.map((item, idx) => (
              <article key={item.id} className={`entry-card ${item.status === 'active' ? '' : 'opacity-60'}`}>
                <div className="entry-card__top">
                  <button type="button" className="btn btn--sm btn--icon" onClick={event => handleToggleSelectRow(item.id, idx, event)} aria-pressed={selectedIds.has(item.id)} aria-label={`${selectedIds.has(item.id) ? 'Desmarcar' : 'Marcar'} ${item.indicator}`}>
                    {selectedIds.has(item.id) ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
                  </button>
                  <button type="button" className="entry-card__indicator text-left" onClick={() => openDossier(item.indicator)}>{item.indicator}</button>
                  <span className={item.status === 'active' ? 'chip chip--ok' : 'chip'}>{item.status === 'active' ? 'Ativo' : 'Removido'}</span>
                </div>
                <div className="entry-card__meta">
                  <span>{item.type.replace('_', ' ')}</span>
                  <span>Incluído {formatDateBR(item.addedDate)}</span>
                  {item.sourceTicket && <span>Ticket {item.sourceTicket}</span>}
                  {item.addedBy && <span>Por {item.addedBy}</span>}
                </div>
                {item.notes && <p className="entry-card__notes">{item.notes}</p>}
                <div className="entry-card__actions">
                  <button type="button" className="btn btn--sm" onClick={() => handleToggleStatus(item)}>{item.status === 'active' ? 'Remover' : 'Reativar'}</button>
                  <button type="button" className="btn btn--sm" onClick={() => openComments(item)} aria-label={`Comentários de ${item.indicator}`}>
                    <MessageSquare aria-hidden="true" /> {commentCounts[item.id] || ''}
                  </button>
                  <button type="button" className="btn btn--sm btn--icon" onClick={() => handleCopy(item.indicator)} aria-label={`Copiar ${item.indicator}`}>
                    {copiedIndicator === item.indicator ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                  <button type="button" className="btn btn--sm btn--icon" onClick={() => { setEditingEntry(item); setEditNotesText(item.notes || ''); }} aria-label={`Editar observação de ${item.indicator}`}><Edit3 aria-hidden="true" /></button>
                  <button type="button" className="btn btn--sm btn--icon btn--danger" onClick={() => setDeleteConfirmId(item.id)} aria-label={`Excluir ${item.indicator}`}><Trash2 aria-hidden="true" /></button>
                </div>
              </article>
            ))
          )}
        </div>
        <div className="overflow-x-auto entry-table-wrap">
          <table className="list-table w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold select-none">
                {/* Checkbox de Selecionar Todos Visíveis */}
                <th className="py-3 px-3 w-10 text-center">
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    disabled={isLoading || paginatedEntries.length === 0}
                    aria-label={isAllVisibleSelected ? 'Desmarcar todos desta página' : 'Selecionar todos desta página'}
                    aria-pressed={isAllVisibleSelected}
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
                <th className="py-3 px-4 w-44">Indicador</th>
                <th className="py-3 px-3 w-44">Domínio / hostname</th>
                <th className="py-3 px-3 w-24 text-center" title="Ocorrências nos últimos 90 dias">90 dias</th>
                <th className="py-3 px-3 w-24">Tipo</th>
                <th className="py-3 px-3 w-28">Incluído em</th>
                <th className="py-3 px-3 w-28">Fonte / Ticket</th>
                <th className="py-3 px-3 w-28">Status</th>
                <th className="py-3 px-4">Observações</th>
                <th className="py-3 px-4 w-28 text-right">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {paginatedEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-sans">
                    <span role="status">{emptyMessage}</span>
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
                          aria-label={`${isSelected ? 'Desmarcar' : 'Marcar'} ${item.indicator}`}
                          aria-pressed={isSelected}
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
                              openDossier(item.indicator);
                            }}
                            className={`text-xs font-bold hover:text-blue-300 hover:underline transition cursor-pointer text-left whitespace-nowrap ${item.isReservedAlert ? 'text-amber-400' : 'text-white'}`}
                            title="Clique para abrir a Ficha Técnica / Dossiê CTI Completo"
                          >
                            {item.indicator}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDossier(item.indicator);
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
                      <td className="py-2.5 px-3 font-sans">
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
                          <div className="max-w-44 leading-tight">
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
                          {item.type.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Data Inclusão */}
                      <td className="py-2.5 px-3 font-sans text-slate-400 text-[11px]">
                        {formatDateBR(item.addedDate)}
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
                      <td className="py-2.5 px-4 font-sans text-slate-400 text-xs truncate max-w-[110px]" title={item.notes}>
                        {item.notes || '-'}
                      </td>

                      {/* Ações */}
                      <td className="py-2.5 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                        <ActionMenu
                          label={`Ações de ${item.indicator}`}
                          badge={commentCounts[item.id] || undefined}
                          items={[
                            { label: 'Abrir dossiê do indicador', icon: ScanSearch, onSelect: () => openDossier(item.indicator) },
                            { label: 'Copiar indicador', icon: Copy, onSelect: () => handleCopy(item.indicator) },
                            {
                              label: commentCounts[item.id] ? `Comentários (${commentCounts[item.id]})` : 'Comentar',
                              icon: MessageSquare,
                              onSelect: () => openComments(item)
                            },
                            {
                              label: 'Editar observação',
                              icon: Edit3,
                              onSelect: () => {
                                setEditingEntry(item);
                                setEditNotesText(item.notes || '');
                              }
                            },
                            { type: 'divider' },
                            isActive
                              ? { label: 'Marcar como removido', icon: RotateCcw, title: 'Sai da exportação, mas o histórico fica guardado', onSelect: () => handleToggleStatus(item) }
                              : { label: 'Reativar bloqueio', icon: Undo2, onSelect: () => handleToggleStatus(item) },
                            { label: 'Excluir definitivamente', icon: Trash2, danger: true, onSelect: () => setDeleteConfirmId(item.id) }
                          ]}
                        />
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
            Exibindo <strong>{paginatedEntries.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + paginatedEntries.length}` : '0'}</strong> de <strong>{totalFiltered}</strong> itens filtrados (Total do cliente: {totalClient})
            {selectedIds.size > 0 && <span className="ml-2 text-blue-400 font-semibold">• {selectedIds.size} marcados</span>}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>Por página:</span>
              <select
                value={pageSize}
                aria-label="Indicadores por página"
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
                type="button"
                aria-label="Página anterior"
                disabled={isLoading || page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-1.5 rounded bg-slate-900 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                aria-label="Próxima página"
                disabled={isLoading || page >= totalPages}
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
                className="btn btn--sm btn--icon btn--quiet"
              aria-label="Fechar"
              title="Fechar"
              >
                <X aria-hidden="true" />
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
                className="btn btn--quiet"
              >
                Limpar
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchMatchModal(false)}
                  className="btn btn--quiet"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBatchMatch}
                  disabled={fullListBusy || !batchMatchInput.trim()}
                  className="btn btn--primary"
                >
                  {fullListBusy ? 'Localizando…' : 'Marcar na tabela'}
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
                className="btn btn--sm btn--icon btn--quiet"
              aria-label="Fechar"
              title="Fechar"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              A cada importação ou limpeza, o GuardList salva uma versão da lista. Para desfazer um erro, restaure a versão anterior.
            </p>

            {/* Criar Ponto de Restauração Manual */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-xs">
              <input
                type="text"
                placeholder="Nome do ponto manual (ex: Backup antes de atualizar firewall)"
                value={newSnapshotLabel}
                onChange={(e) => setNewSnapshotLabel(e.target.value)}
                className="field flex-1"
              />
              <button
                onClick={handleCreateManualSnapshot}
                className="btn btn--primary whitespace-nowrap"
              >
                Salvar versão atual
              </button>
            </div>

            {/* Lista de Versões */}
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {snapshots.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  Nenhuma versão salva para este cliente ainda. Elas são criadas automaticamente a cada importação ou limpeza.
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
                        Salva em {new Date(snap.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        disabled={isRestoringSnapshot}
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="btn btn--sm btn--primary"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Restaurar
                      </button>

                      <button
                        onClick={() => handleDeleteSnapshotItem(snap.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-900 transition"
                        title="Excluir esta versão"
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
              Você está prestes a excluir <strong>todas as {totalClient} entradas</strong> cadastradas para este cliente.
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
                className="btn btn--quiet"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={clearConfirmName.trim().toUpperCase() !== currentClient?.name.toUpperCase()}
                onClick={handleConfirmClearAll}
                className="btn btn--destructive"
              >
                Zerar lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comentários do item */}
      <Modal
        open={Boolean(commentEntry)}
        onClose={() => setCommentEntry(null)}
        title={<span className="font-mono">{commentEntry?.indicator}</span>}
        subtitle={`Conversa da equipe sobre este item · ${currentClient?.name ?? ''}`}
        size="md"
        footer={
          <form
            className="flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitComment();
            }}
          >
            <input
              className="field flex-1"
              placeholder="Ex.: bloqueado por causa do chamado SEC-1234"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={1000}
              data-dialog-initial-focus
            />
            <button type="submit" className="btn btn--primary" disabled={commentBusy || !commentText.trim()}>
              <Send aria-hidden="true" /> Enviar
            </button>
          </form>
        }
      >
        {comments.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhum comentário ainda. Registre o motivo do bloqueio, o chamado ou o que combinaram com o cliente.</p>
        ) : (
          <div className="comment-thread">
            {comments.map((c) => (
              <div key={c.id} className="comment">
                <header>
                  <strong>{c.displayName}</strong>
                  <span>
                    {formatDateTimeBR(c.at)}
                    <button
                      type="button"
                      className="ml-2 text-slate-500 hover:text-rose-400"
                      onClick={async () => {
                        try {
                          const list = await deleteComment(c.id);
                          setComments(list);
                          if (commentEntry) setCommentCounts((prev) => ({ ...prev, [commentEntry.id]: list.length }));
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'Não foi possível apagar.', 'warn');
                        }
                      }}
                      aria-label="Apagar comentário"
                      title="Apagar (só quem escreveu ou um administrador)"
                    >
                      <Trash2 className="w-3 h-3 inline" />
                    </button>
                  </span>
                </header>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Exceções do cliente */}
      <Modal
        open={showExceptions}
        onClose={() => setShowExceptions(false)}
        title={`Exceções de ${currentClient?.name ?? ''}`}
        subtitle="IPs, redes ou domínios que nunca podem ser bloqueados neste cliente: gateway, parceiros, a própria empresa."
        size="md"
        footer={
          isAdmin ? (
            <>
              <button type="button" className="btn" onClick={() => setShowExceptions(false)}>Cancelar</button>
              <button type="button" className="btn btn--primary" disabled={exceptionsBusy} onClick={saveExceptions}>Salvar exceções</button>
            </>
          ) : undefined
        }
      >
        <p className="text-xs text-slate-400 mb-3">
          Uma por linha. O que vier depois de # é o motivo. A importação recusa qualquer item que bata com uma exceção, inclusive CIDRs que contenham o IP protegido.
          {isAdmin ? ' Ao salvar, itens ativos em conflito são retirados (com versão salva antes).' : ' Só administradores alteram esta lista.'}
        </p>
        {exceptionsError && <div className="notice notice--danger mb-3"><p>{exceptionsError}</p></div>}
        <textarea
          className="field w-full py-2 font-mono text-xs"
          rows={10}
          value={exceptionsText}
          onChange={(e) => setExceptionsText(e.target.value)}
          readOnly={!isAdmin}
          placeholder={'200.150.10.1  # gateway do cliente\n177.10.0.0/16  # parceiro de pagamentos\nempresa.com.br  # domínio próprio'}
        />
        {currentClient?.exceptions?.length ? (
          <p className="text-[11px] text-slate-500 mt-2">
            Última alteração: {currentClient.exceptions.map((e) => e.addedBy).filter(Boolean).slice(-1)[0] || '—'}
          </p>
        ) : null}
      </Modal>

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
                className="btn btn--sm btn--icon btn--quiet"
              aria-label="Fechar"
              title="Fechar"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            {redundantMatches.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">Nada repetido ou coberto</h4>
                <p className="text-xs text-slate-400">
                  A lista ativa de {currentClient?.name} não tem repetidos, IPs dentro de um CIDR da própria lista nem conflitos com as exceções.
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
                    {redundantMatches.filter(m => m.reason === 'cidr').length} dentro de CIDR
                    {redundantMatches.some(m => m.reason === 'exception') ? `, ${redundantMatches.filter(m => m.reason === 'exception').length} em conflito com exceções` : ''}).
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
                        <span className="text-[11px] text-slate-500 font-sans truncate">{formatDateBR(match.item.addedDate)}</span>
                      </div>
                      <span className="font-sans text-slate-400 shrink-0">
                        {match.reason === 'duplicate' ? 'Repetido de ' : match.reason === 'exception' ? 'Conflita com a exceção ' : 'Coberto por '}
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
                className="btn btn--sm btn--icon btn--quiet"
              aria-label="Fechar"
              title="Fechar"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Este formato separa automaticamente os IPs únicos das sub-redes CIDR para você colar diretamente no terminal com o editor <strong>nano</strong>.
            </p>

            <div className="relative">
              <pre className="w-full bg-slate-950 font-mono text-xs text-blue-300 p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-80 select-all leading-relaxed whitespace-pre">
                {nanoText}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Use o botão ou Ctrl+C para copiar.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyNanoText}
                  className="btn btn--primary"
                >
                  {copiedNano ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  {copiedNano ? 'Copiado' : 'Copiar texto NANO'}
                </button>

                <button
                  onClick={handleExportNanoTxt}
                  className="btn"
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
                className="btn btn--quiet"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNotes}
                className="btn btn--primary"
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
              Esta ação excluirá o indicador da lista compartilhada deste cliente, sem manter seu histórico. Para apenas desativar o bloqueio, marque-o como "Removido".
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="btn btn--quiet"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn btn--destructive"
              >
                Excluir definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Ficha Técnica / Dossiê CTI do Indicador */}
      {selectedIpForDossier && dossierState === 'ready' && (
        <IpDossierModal
          indicator={selectedIpForDossier}
          onClose={() => setSelectedIpForDossier(null)}
          allEntries={dossierEntries}
          clients={clients}
        />
      )}
      <Modal open={Boolean(selectedIpForDossier) && dossierState !== 'ready'} title={`Dossiê de ${selectedIpForDossier || ''}`} onClose={() => setSelectedIpForDossier(null)}>
        {dossierState === 'error' ? (
          <div className="space-y-4">
            <p className="notice notice--danger" role="alert">{dossierError}</p>
            <button type="button" className="btn btn--primary" onClick={() => setDossierRetry(value => value + 1)}>Tentar novamente</button>
          </div>
        ) : <p role="status">Carregando as ocorrências deste indicador nos clientes…</p>}
      </Modal>
    </div>
  );
};
