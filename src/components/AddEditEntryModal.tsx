import React, { useState, useEffect, useMemo } from 'react';
import { X, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BlocklistEntry, ClientName } from '../types/blocklist';
import { classifyIpType, getCurrentWeekCode, isPrivateOrLocalIp, sanitizeIpInput } from '../utils/ipValidator';
import { INITIAL_REASONS, INITIAL_SOURCES } from '../utils/seedData';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface AddEditEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: BlocklistEntry) => void;
  clients: ClientName[];
  editingEntry?: BlocklistEntry | null;
  defaultClient: ClientName;
  existingEntries: BlocklistEntry[];
}

export const AddEditEntryModal: React.FC<AddEditEntryModalProps> = ({
  isOpen,
  onClose,
  onSave,
  clients,
  editingEntry,
  defaultClient,
  existingEntries
}) => {
  const currentWeek = getCurrentWeekCode();
  const [client, setClient] = useState<ClientName>(defaultClient || clients[0]);
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState(INITIAL_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [source, setSource] = useState(INITIAL_SOURCES[0]);
  const [addedDate, setAddedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const dialogRef = useDialogFocus(isOpen);

  useEffect(() => {
    if (editingEntry) {
      setClient(editingEntry.client);
      setIp(editingEntry.ip);
      if (INITIAL_REASONS.includes(editingEntry.reason)) {
        setReason(editingEntry.reason);
        setCustomReason('');
      } else {
        setReason('Outro');
        setCustomReason(editingEntry.reason);
      }
      setSource(editingEntry.source);
      setAddedDate(editingEntry.addedDate);
      setNotes(editingEntry.notes || '');
    } else {
      setClient(defaultClient !== 'ALL' ? defaultClient : clients[0]);
      setIp('');
      setReason(INITIAL_REASONS[0]);
      setCustomReason('');
      setSource(INITIAL_SOURCES[0]);
      setAddedDate(new Date().toISOString().split('T')[0]);
      setNotes('');
    }
  }, [editingEntry, defaultClient, clients, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const cleanIp = sanitizeIpInput(ip);
  const ipType = classifyIpType(cleanIp);
  const isPrivate = isPrivateOrLocalIp(cleanIp);
  const isValid = ipType !== 'Invalido' && cleanIp.length > 0;

  // Check if duplicate in the selected client
  const duplicateWarning = useMemo(() => {
    if (!isValid) return null;
    const normalized = cleanIp.toLowerCase();
    const matches = existingEntries.filter(e => 
      e.normalizedIp === normalized && 
      e.status !== 'removed' &&
      (!editingEntry || e.id !== editingEntry.id)
    );

    const clientMatches = matches.filter(e => e.client === client);
    const otherMatches = matches.filter(e => e.client !== client);

    return {
      sameClient: clientMatches.length > 0,
      otherClients: otherMatches.map(e => e.client),
      clientMatches
    };
  }, [cleanIp, isValid, existingEntries, client, editingEntry]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    const finalReason = (reason === 'Outro' && customReason.trim()) ? customReason.trim() : reason;

    const newOrUpdated: BlocklistEntry = {
      id: editingEntry ? editingEntry.id : `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      client,
      ip: cleanIp,
      normalizedIp: cleanIp.toLowerCase(),
      type: ipType,
      reason: finalReason,
      source,
      addedDate,
      weekCode: editingEntry ? editingEntry.weekCode : currentWeek,
      status: 'active',
      isPrivateRange: isPrivate,
      notes: notes.trim()
    };

    onSave(newOrUpdated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="entry-dialog-title" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-blue-400" />
            <h3 id="entry-dialog-title" className="text-base font-bold text-white">
              {editingEntry ? 'Editar Bloqueio de IP' : 'Cadastrar Novo IP na Blocklist'}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar cadastro de indicador"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {/* Client selector */}
          <div>
            <label className="block font-medium text-slate-300 mb-1">
              Cliente:
            </label>
            <select
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-700 font-semibold focus:outline-none focus:border-blue-500"
            >
              {clients.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* IP Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-medium text-slate-300">
                Endereço IP ou Sub-rede CIDR:
              </label>
              {cleanIp && (
                <span className={`font-mono text-[11px] ${isValid ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isValid ? `${ipType} Válido` : 'Formato Inválido'}
                </span>
              )}
            </div>
            <input
              type="text"
              required
              placeholder="Ex: 185.220.101.5 ou 192.168.1.0/24"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className={`w-full font-mono text-sm p-2.5 rounded-lg border bg-slate-950 text-white focus:outline-none ${
                !cleanIp ? 'border-slate-700' : isValid ? 'border-emerald-500/80' : 'border-rose-500'
              }`}
            />
          </div>

          {/* Duplicate or Private Warning */}
          {duplicateWarning?.sameClient && (
            <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg flex items-start gap-2 text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Atenção: IP Já Cadastrado neste Cliente!</p>
                <p className="text-[11px] mt-0.5 text-rose-200">
                  O IP {cleanIp} já está na lista do cliente {client}. Se você cadastrar novamente, gerará uma duplicata que precisará ser expurgada no controle semanal.
                </p>
              </div>
            </div>
          )}

          {duplicateWarning && duplicateWarning.otherClients.length > 0 && !duplicateWarning.sameClient && (
            <div className="p-2.5 bg-indigo-950/40 border border-indigo-800 rounded-lg flex items-center gap-2 text-indigo-300 text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>
                Nota: Este IP também está ativo nos clientes: <strong>{duplicateWarning.otherClients.join(', ')}</strong>.
              </span>
            </div>
          )}

          {isPrivate && (
            <div className="p-2.5 bg-amber-950/40 border border-amber-800 rounded-lg flex items-center gap-2 text-amber-300 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Aviso: Este IP pertence a faixas reservadas/privadas (RFC1918) ou loopback.</span>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block font-medium text-slate-300 mb-1">
              Motivo do Bloqueio:
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
            >
              {INITIAL_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="Outro">Outro (especificar)</option>
            </select>
            {reason === 'Outro' && (
              <input
                type="text"
                placeholder="Descreva o motivo específico do bloqueio..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="mt-2 w-full bg-slate-950 text-white p-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
              />
            )}
          </div>

          {/* Source and Date Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-300 mb-1">
                Origem / Ferramenta:
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
              >
                {INITIAL_SOURCES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-300 mb-1">
                Data do Bloqueio:
              </label>
              <input
                type="date"
                value={addedDate}
                onChange={(e) => setAddedDate(e.target.value)}
                className="w-full bg-slate-950 text-white p-2.5 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-medium text-slate-300 mb-1">
              Observações Adicionais:
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Alerta gerado durante incidente de segurança..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 text-white p-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-lg shadow transition"
            >
              {editingEntry ? 'Salvar Alterações' : 'Adicionar à Blocklist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
