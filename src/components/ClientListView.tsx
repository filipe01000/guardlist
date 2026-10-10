import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  Search, 
  Filter, 
  ArrowUpDown, 
  Trash2, 
  Edit3, 
  Copy, 
  Check, 
  Download, 
  AlertTriangle, 
  ShieldCheck, 
  RotateCcw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  Terminal,
  History,
  Undo2,
  CheckSquare,
  Square,
  ListChecks,
  Bookmark,
  X,
  Radio,
  RefreshCw
} from 'lucide-react';
import { Client, BlocklistEntry, IndicatorType, IndicatorStatus, ClientSnapshot } from '../types';
import { IpDossierModal } from './IpDossierModal';
import { 
  getClientEntries, 
  updateEntryStatus, 
  updateEntryNotes, 
  bulkDeleteEntries,
  createClientSnapshot,
  getClientSnapshots,
  restoreClientSnapshot,
  deleteClientEntriesAll,
  deleteSnapshot
} from '../db/indexedDb';
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
}

export const ClientListView: React.FC<ClientListViewProps> = ({
  clients,
  selectedClientId,
  onSelectClient,
  onRefreshStats
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
  const [duplicateGroups, setDuplicateGroups] = useState<Array<{ indicator: string; items: BlocklistEntry[] }>>([]);
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

    setMatchFeedback(`Foram localizados e marcados ${matchCount} indicadores na tabela!`);
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
      alert('Versão restaurada com sucesso!');
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

  // Excluir Definitivamente Individual
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

  // Verificar Duplicatas na Lista Inteira
  const handleCheckDuplicates = () => {
    setIsCheckingDuplicates(true);
    const activeEntries = entries.filter(e => e.status === 'active');
    const map = new Map<string, BlocklistEntry[]>();

    for (const e of activeEntries) {
      if (!map.has(e.indicator)) {
        map.set(e.indicator, []);
      }
      map.get(e.indicator)!.push(e);
    }

    const groups: Array<{ indicator: string; items: BlocklistEntry[] }> = [];
    for (const [ind, items] of map.entries()) {
      if (items.length > 1) {
        groups.push({ indicator: ind, items });
      }
    }

    setDuplicateGroups(groups);
    setShowDuplicateModal(true);
    setIsCheckingDuplicates(false);
  };

  // Limpar Duplicatas em Lote
  const handleCleanDuplicatesBatch = async () => {
    const idsToDelete: string[] = [];

    for (const group of duplicateGroups) {
      const sorted = [...group.items].sort((a, b) => new Date(b.addedDate).getTime() - new Date(a.addedDate).getTime());
      for (let i = 1; i < sorted.length; i++) {
        idsToDelete.push(sorted[i].id);
      }
    }

    if (idsToDelete.length > 0) {
      // Snapshot automático antes da limpeza
      await createClientSnapshot(currentClient.id, `Antes de limpar ${idsToDelete.length} duplicatas`);
      await bulkDeleteEntries(idsToDelete);
      await loadClientData();
      await loadSnapshots();
      onRefreshStats();
      setShowDuplicateModal(false);
    }
  };

  const isAllVisibleSelected = paginatedEntries.length > 0 && paginatedEntries.every(e => selectedIds.has(e.id));

  return (
    <div className="space-y-6">
      {/* Barra Superior de Seleção de Cliente e Ações Principais */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Seletor de Cliente */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block uppercase">
              Cliente Selecionado (Lista Isolada):
            </label>
            <select
              value={currentClient?.id}
              onChange={(e) => onSelectClient(e.target.value)}
              className="bg-slate-950 text-white font-mono font-bold text-lg px-3 py-1 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer mt-0.5"
            >
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Botões de Ação da Lista */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Versões Anteriores / Desfazer */}
          <button
            onClick={() => {
              loadSnapshots();
              setShowSnapshotsModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition shadow-sm cursor-pointer"
            title="Ver pontos de restauração e desfazer importações/alterações incorretas"
          >
            <Undo2 className="w-4 h-4 text-indigo-400" />
            Versões / Desfazer ({snapshots.length})
          </button>

          {/* Verificar Duplicatas */}
          <button
            onClick={handleCheckDuplicates}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition shadow-sm cursor-pointer"
            title="Escanear a lista ativa deste cliente em busca de IPs repetidos"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            Verificar Duplicatas
          </button>

          {/* Exportar .txt Formato NANO */}
          <button
            onClick={handleExportNanoTxt}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20 transition cursor-pointer"
            title="Exportar arquivo .txt pronto para NANO (com seções === IPS ÚNICOS === e === REDES CIDR ===)"
          >
            <Terminal className="w-4 h-4 text-purple-200" />
            Exportar .TXT (NANO)
          </button>

          {/* Pré-visualizar e Copiar p/ NANO */}
          <button
            onClick={() => setShowNanoModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 transition cursor-pointer"
            title="Visualizar e copiar texto com as seções para colar diretamente no terminal"
          >
            <Terminal className="w-3.5 h-3.5 text-purple-400" />
            Copiar p/ NANO
          </button>

          {/* Exportar .txt Simples (1 por linha) */}
          <button
            onClick={handleExportTxt}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Exportar apenas a lista ATIVA em formato simples (1 por linha)"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            .TXT Simples
          </button>

          {/* Exportar .csv */}
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Exportar todas as colunas com histórico em CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            .CSV
          </button>

          {/* Limpar / Excluir Toda a Lista */}
          <button
            onClick={() => setShowClearAllModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 transition cursor-pointer"
            title="Zerar e apagar toda a blocklist deste cliente (com snapshot de segurança antes)"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            Zerar Lista
          </button>
        </div>
      </div>

      {/* Controles de Filtros, Busca e Marcador em Lote */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Campo de Busca */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por IP, CIDR, domínio, ticket ou observação..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="w-full bg-slate-950 text-slate-100 placeholder-slate-500 text-xs sm:text-sm pl-9 pr-4 py-2 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500 font-mono"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Filtros em Linha & Marcador por Lista */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Caixa para colocar e ir marcando */}
          <button
            onClick={() => {
              setMatchFeedback(null);
              setShowBatchMatchModal(true);
            }}
            className="px-3 py-1.5 rounded-lg border bg-blue-950/60 hover:bg-blue-900/60 text-blue-300 border-blue-800 flex items-center gap-1.5 transition font-semibold"
            title="Colar uma lista de IPs para localizá-los e marcá-los automaticamente na tabela"
          >
            <ListChecks className="w-3.5 h-3.5 text-blue-400" />
            Marcar por Lista
          </button>

          <button
            type="button"
            onClick={handleEnrichVisibleIps}
            disabled={Boolean(ctiProgress) || !paginatedEntries.some(item => item.type === 'IPv4' || item.type === 'IPv6')}
            className="px-3 py-1.5 rounded-lg border bg-purple-950/60 hover:bg-purple-900/60 text-purple-200 border-purple-800 flex items-center gap-1.5 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            title="Força uma nova consulta ao AbuseIPDB para atualizar hostnames e ocorrências dos IPs visíveis"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-purple-400 ${ctiProgress ? 'animate-spin' : ''}`} />
            {ctiProgress ? `Atualizando ${ctiProgress.done}/${ctiProgress.total}` : 'Atualizar hosts e ocorrências'}
          </button>

          {lastCtiRefresh && !ctiProgress && (
            <span className="text-[10px] text-emerald-400 tabular-nums" role="status">
              {lastCtiRefresh.count} IPs · {lastCtiRefresh.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {(lastCtiRefresh.elapsedMs / 1000).toFixed(1).replace('.', ',')}s
            </span>
          )}

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="bg-slate-950 text-slate-200 rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none"
          >
            <option value="active">Apenas Ativos</option>
            <option value="removed">Apenas Removidos</option>
            <option value="ALL">Todos os Status</option>
          </select>

          {/* Tipo */}
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-950 text-slate-200 rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none"
          >
            <option value="ALL">Todos os Tipos</option>
            <option value="IPv4">IPv4</option>
            <option value="CIDR_v4">CIDR v4</option>
            <option value="IPv6">IPv6</option>
            <option value="CIDR_v6">CIDR v6</option>
            <option value="Domain">Domínio</option>
          </select>

          {/* Período */}
          <select
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value as any);
              setPage(1);
            }}
            className="bg-slate-950 text-slate-200 rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none"
          >
            <option value="ALL">Qualquer Período</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="year">Deste Ano</option>
          </select>

          {/* Alternar Ordenação Numérica */}
          <button
            onClick={() => setSortNumeric(!sortNumeric)}
            className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition ${
              sortNumeric
                ? 'bg-blue-950/80 text-blue-300 border-blue-800 font-semibold'
                : 'bg-slate-950 text-slate-400 border-slate-700'
            }`}
            title="Ordenação numérica para IPv4 (10.2.0.1 antes de 10.10.0.1)"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortNumeric ? 'Ordem Numérica' : 'Ordem de Data'}
          </button>
        </div>
      </div>

      {/* BARRA FLUTUANTE DE AÇÕES EM LOTE (SELEÇÃO ATIVA) */}
      {selectedIds.size > 0 && (
        <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 border border-blue-700/80 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white bg-blue-600 px-2.5 py-1 rounded-lg text-sm font-mono">
              {selectedIds.size}
            </span>
            <span className="text-slate-200 font-medium">
              indicador(es) selecionado(s) na tabela
            </span>
            <span className="text-slate-400 text-[11px] hidden md:inline">
              (Dica: use Ctrl+Clique para alternar ou Shift+Clique para intervalo)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleBulkToggleStatus('removed')}
              className="bg-slate-800 hover:bg-slate-700 text-amber-300 px-3 py-1.5 rounded-lg font-semibold transition"
              title="Marcar todos os selecionados como Removido"
            >
              Marcar como Removido
            </button>

            <button
              onClick={() => handleBulkToggleStatus('active')}
              className="bg-slate-800 hover:bg-slate-700 text-emerald-300 px-3 py-1.5 rounded-lg font-semibold transition"
              title="Reativar todos os selecionados"
            >
              Reativar Selecionados
            </button>

            <button
              onClick={handleExportSelectedNano}
              className="bg-purple-900/60 hover:bg-purple-800 text-purple-200 px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1"
            >
              <Terminal className="w-3.5 h-3.5" />
              Exportar NANO
            </button>

            <button
              onClick={handleBulkDeleteSelected}
              className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir Selecionados
            </button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-400 hover:text-white px-2 py-1.5 text-xs"
            >
              Desmarcar Todos
            </button>
          </div>
        </div>
      )}

      {/* Tabela de Entradas com Checkboxes e Suporte a Ctrl/Shift */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
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
                <th className="py-3 px-3 w-28">Data Inclusão</th>
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
                            className={`text-xs font-bold hover:text-purple-300 hover:underline transition cursor-pointer text-left ${item.isReservedAlert ? 'text-amber-400' : 'text-white'}`}
                            title="Clique para abrir a Ficha Técnica / Dossiê CTI Completo"
                          >
                            {item.indicator}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIpForDossier(item.indicator);
                            }}
                            className="p-1 text-slate-500 hover:text-purple-300 rounded transition opacity-0 group-hover:opacity-100"
                            title="Abrir Ficha de Inteligência CTI"
                          >
                            <Radio className="w-3 h-3 text-purple-400" />
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
                          <span className="inline-flex items-center gap-1.5 text-purple-300 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
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
                          <span className="text-purple-300 animate-pulse">···</span>
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

                          {/* Editar Observação */}
                          <button
                            onClick={() => {
                              setEditingEntry(item);
                              setEditNotesText(item.notes || '');
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition"
                            title="Editar Observação"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* Excluir Definitivamente */}
                          <button
                            onClick={() => setDeleteConfirmId(item.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                            title="Excluir Definitivamente"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Seleção rápida por lista" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  Caixa de Seleção Rápida por Lista
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
                Limpar Campo
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
                  Localizar e Marcar na Tabela
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Versões Anteriores / Snapshots (Desfazer) */}
      {showSnapshotsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Versões anteriores da lista" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">
                  Versões Anteriores &amp; Desfazer: {currentClient?.name}
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
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-2 rounded-lg transition whitespace-nowrap"
              >
                Salvar Versão Atual
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
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirmar exclusão da lista" className="bg-slate-900 border border-rose-900/60 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">
                Zerar Blocklist de {currentClient?.name}?
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Você está prestes a excluir <strong>todas as {entries.length} entradas</strong> cadastradas para este cliente.
            </p>

            <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-xs text-blue-300">
              🛡️ <strong>Segurança garantida:</strong> Um snapshot de segurança será gravado automaticamente antes da exclusão. Se você se arrepender, poderá restaurar a lista a qualquer momento pelo botão <em>Versões / Desfazer</em>.
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
                Confirmar e Zerar Lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verificação de Duplicatas na Lista Inteira */}
      {showDuplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Verificação de duplicatas" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  Verificação de Duplicatas: {currentClient?.name}
                </h3>
              </div>
              <button
                onClick={() => setShowDuplicateModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
              >
                Fechar
              </button>
            </div>

            {duplicateGroups.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">Lista 100% Higienizada!</h4>
                <p className="text-xs text-slate-400">
                  Nenhum IP duplicado foi encontrado na blocklist ativa de {currentClient?.name}.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-amber-950/40 border border-amber-800 rounded-xl text-xs text-amber-200 flex items-center justify-between">
                  <div>
                    Foram encontrados <strong>{duplicateGroups.length}</strong> IPs repetidos.
                  </div>
                  <button
                    onClick={handleCleanDuplicatesBatch}
                    className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    Remover Repetições em Lote (Manter Mais Recente)
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {duplicateGroups.map((group, idx) => (
                    <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono font-bold text-white text-sm">
                          {group.indicator}
                        </span>
                        <span className="text-rose-400 font-semibold">
                          {group.items.length} repetições
                        </span>
                      </div>
                      <div className="space-y-1 text-[11px] text-slate-400 font-sans">
                        {group.items.map((item, i) => (
                          <div key={item.id} className="flex items-center justify-between bg-slate-900/60 p-1.5 rounded">
                            <span>Data: {item.addedDate} | Ticket: {item.sourceTicket || 'S/N'}</span>
                            {i === 0 && <span className="text-emerald-400 font-bold">(Será mantido)</span>}
                          </div>
                        ))}
                      </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Visualização do formato NANO" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-purple-400" />
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
              <pre className="w-full bg-slate-950 font-mono text-xs text-purple-300 p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-80 select-all leading-relaxed whitespace-pre">
                {generateNanoFormattedTxt(entries, sortNumeric)}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Pressione Ctrl+C ou use o botão para copiar tudo para a área de transferência.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyNanoText}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow"
                >
                  {copiedNano ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  {copiedNano ? 'Copiado para a Área de Transferência!' : 'Copiar Texto NANO'}
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

      {/* MODAL: Editar Observação */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Editar observação" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white">Editar Observação</h3>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div ref={internalDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirmar exclusão definitiva" className="bg-slate-900 border border-rose-900/50 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">Excluir Definitivamente?</h3>
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
                Excluir Definitivamente
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
