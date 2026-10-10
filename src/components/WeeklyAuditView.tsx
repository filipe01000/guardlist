import React, { useState } from 'react';
import { 
  CalendarCheck, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Sparkles, 
  Building2, 
  UserCheck, 
  Save, 
  Calendar,
  Check,
  ChevronRight
} from 'lucide-react';
import { BlocklistEntry, ClientAuditStatus, ClientName } from '../types/blocklist';
import { getCurrentWeekCode } from '../utils/ipValidator';

interface WeeklyAuditViewProps {
  entries: BlocklistEntry[];
  clients: ClientName[];
  auditStatuses: ClientAuditStatus[];
  onUpdateAuditStatus: (status: ClientAuditStatus) => void;
  onCleanDuplicatesForClient: (client: ClientName) => void;
  onSelectClientInSpreadsheet: (client: ClientName) => void;
}

export const WeeklyAuditView: React.FC<WeeklyAuditViewProps> = ({
  entries,
  clients,
  auditStatuses,
  onUpdateAuditStatus,
  onCleanDuplicatesForClient,
  onSelectClientInSpreadsheet
}) => {
  const currentWeek = getCurrentWeekCode();
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null);
  const [tempNotes, setTempNotes] = useState<string>('');
  const [tempReviewer, setTempReviewer] = useState<string>('Analista de Redes');

  // Precalculate client metrics
  const clientMetrics = clients.map(client => {
    const clientEntries = entries.filter(e => e.client === client && e.status !== 'removed');
    const seen = new Set<string>();
    let duplicatesCount = 0;
    for (const item of clientEntries) {
      if (seen.has(item.normalizedIp)) {
        duplicatesCount++;
      } else {
        seen.add(item.normalizedIp);
      }
    }

    const audit = auditStatuses.find(a => a.client === client && a.weekCode === currentWeek) || {
      client,
      weekCode: currentWeek,
      reviewed: false,
      reviewedAt: undefined,
      reviewer: undefined,
      notes: ''
    };

    return {
      client,
      totalIps: clientEntries.length,
      duplicatesCount,
      uniqueIps: seen.size,
      audit
    };
  });

  const completedCount = clientMetrics.filter(m => m.audit.reviewed).length;
  const progressPercent = Math.round((completedCount / (clients.length || 1)) * 100);

  const handleToggleReviewed = (client: ClientName) => {
    const existing = auditStatuses.find(a => a.client === client && a.weekCode === currentWeek);
    const nextReviewed = existing ? !existing.reviewed : true;
    const today = new Date().toISOString().split('T')[0];

    onUpdateAuditStatus({
      client,
      weekCode: currentWeek,
      reviewed: nextReviewed,
      reviewedAt: nextReviewed ? today : undefined,
      reviewer: nextReviewed ? (existing?.reviewer || 'Analista de Redes') : undefined,
      notes: existing?.notes || ''
    });
  };

  const handleSaveNotes = (client: ClientName) => {
    const existing = auditStatuses.find(a => a.client === client && a.weekCode === currentWeek);
    onUpdateAuditStatus({
      client,
      weekCode: currentWeek,
      reviewed: existing ? existing.reviewed : false,
      reviewedAt: existing?.reviewedAt,
      reviewer: tempReviewer || existing?.reviewer,
      notes: tempNotes
    });
    setEditingNotesFor(null);
  };

  return (
    <div className="space-y-6">
      {/* Weekly Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
                <CalendarCheck className="w-5 h-5 text-emerald-400" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white">
                  Controle Semanal de Revisão das Blocklists
                </h2>
                <span className="text-xs text-slate-400">
                  Ciclo de Auditoria: <strong className="text-emerald-300 font-mono">{currentWeek}</strong>
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-300 mt-2 max-w-2xl">
              Checklist semanal para conferir a integridade das listas de bloqueio, purgar IPs duplicados e garantir que as regras estejam sincronizadas com a equipe de cada cliente.
            </p>
          </div>

          {/* Progress widget */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 min-w-[240px]">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400">Progresso da Semana:</span>
              <span className="font-bold text-emerald-400">{progressPercent}% Concluído</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div 
                className="bg-emerald-500 h-full transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 text-right">
              {completedCount} de {clients.length} clientes auditados
            </div>
          </div>
        </div>
      </div>

      {/* Client Audit Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clientMetrics.map(({ client, totalIps, duplicatesCount, uniqueIps, audit }) => {
          const isReviewed = audit.reviewed;
          const isEditingNotes = editingNotesFor === client;

          return (
            <div
              key={client}
              className={`bg-slate-900 border rounded-xl p-5 shadow-sm transition flex flex-col justify-between ${
                isReviewed 
                  ? 'border-emerald-800/60 bg-gradient-to-b from-slate-900 to-emerald-950/20' 
                  : 'border-slate-800'
              }`}
            >
              <div>
                {/* Header of client card */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-400" />
                    <h3 className="font-bold text-white text-base tracking-wide">{client}</h3>
                  </div>

                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    isReviewed 
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                      : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                  }`}>
                    {isReviewed ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Auditado
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3 text-amber-400" />
                        Pendente
                      </>
                    )}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 py-3 text-center text-xs">
                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block text-[10px]">Total IPs</span>
                    <strong className="text-slate-200 text-sm font-mono">{totalIps}</strong>
                  </div>

                  <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                    <span className="text-slate-500 block text-[10px]">Únicos</span>
                    <strong className="text-emerald-400 text-sm font-mono">{uniqueIps}</strong>
                  </div>

                  <div className={`p-2 rounded-lg border ${
                    duplicatesCount > 0 
                      ? 'bg-rose-950/40 border-rose-800/60' 
                      : 'bg-slate-950/60 border-slate-800/60'
                  }`}>
                    <span className="text-slate-500 block text-[10px]">Duplicados</span>
                    <strong className={`text-sm font-mono flex items-center justify-center gap-0.5 ${
                      duplicatesCount > 0 ? 'text-rose-400' : 'text-slate-400'
                    }`}>
                      {duplicatesCount > 0 && <AlertTriangle className="w-3 h-3" />}
                      {duplicatesCount}
                    </strong>
                  </div>
                </div>

                {/* Duplicates action alert inside card */}
                {duplicatesCount > 0 && (
                  <div className="mb-3 p-2.5 bg-rose-950/30 border border-rose-900/60 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-rose-300 flex items-center gap-1 text-[11px]">
                      <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                      {duplicatesCount} IP(s) duplicado(s) precisam de limpeza
                    </span>
                    <button
                      onClick={() => onCleanDuplicatesForClient(client)}
                      className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition flex items-center gap-1 shrink-0"
                    >
                      <Sparkles className="w-3 h-3" />
                      Limpar
                    </button>
                  </div>
                )}

                {/* Audit Review Details */}
                <div className="text-xs text-slate-400 space-y-1 mb-3 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/40">
                  <div className="flex items-center justify-between">
                    <span>Revisado em:</span>
                    <span className="text-slate-200 font-mono">{audit.reviewedAt || 'Não auditado'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Responsável:</span>
                    <span className="text-slate-200">{audit.reviewer || '-'}</span>
                  </div>
                  {audit.notes && (
                    <div className="pt-1 border-t border-slate-800 text-[11px] text-slate-300">
                      <span className="text-slate-500 block">Obs:</span>
                      {audit.notes}
                    </div>
                  )}
                </div>

                {/* Notes Editing */}
                {isEditingNotes ? (
                  <div className="space-y-2 mb-3">
                    <input
                      type="text"
                      placeholder="Nome do Analista"
                      value={tempReviewer}
                      onChange={(e) => setTempReviewer(e.target.value)}
                      className="w-full bg-slate-950 text-white text-xs p-1.5 rounded border border-slate-700"
                    />
                    <textarea
                      rows={2}
                      placeholder="Anotações da auditoria desta semana..."
                      value={tempNotes}
                      onChange={(e) => setTempNotes(e.target.value)}
                      className="w-full bg-slate-950 text-white text-xs p-2 rounded border border-slate-700"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveNotes(client)}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2.5 py-1 rounded font-medium flex items-center gap-1"
                      >
                        <Save className="w-3 h-3" />
                        Salvar
                      </button>
                      <button
                        onClick={() => setEditingNotesFor(null)}
                        className="text-slate-400 hover:text-white text-xs px-2 py-1"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingNotesFor(client);
                      setTempNotes(audit.notes || '');
                      setTempReviewer(audit.reviewer || 'Analista de Redes');
                    }}
                    className="text-[11px] text-blue-400 hover:text-blue-300 mb-3 block"
                  >
                    {audit.notes ? 'Editar anotação' : '+ Adicionar anotação da semana'}
                  </button>
                )}
              </div>

              {/* Action buttons at bottom of card */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => onSelectClientInSpreadsheet(client)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 py-1 px-2 rounded hover:bg-slate-800 transition"
                >
                  Ver na Planilha
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => handleToggleReviewed(client)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                    isReviewed
                      ? 'bg-slate-800 text-slate-300 hover:bg-rose-950/40 hover:text-rose-300'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                  }`}
                >
                  {isReviewed ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Concluído
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-3.5 h-3.5" />
                      Marcar Revisado
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
