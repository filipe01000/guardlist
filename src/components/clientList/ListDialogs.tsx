import React from 'react';
import { AlertTriangle, Check, Clock, Copy, Download, History, ScanSearch, ShieldCheck, Terminal, Trash2, Undo2, X } from 'lucide-react';
import type { BlocklistEntry, ClientSnapshot } from '../../types';
import { formatDateBR } from '../../utils/csv';

// Janelas da lista do cliente (ClientListView): versões, zerar a lista, validação e texto NANO.
// Só apresentação: o estado e as ações continuam no ClientListView.

export type ListIssue = { item: BlocklistEntry; coveredBy: string; reason: 'duplicate' | 'cidr' | 'exception' };

type DialogRef = React.RefObject<HTMLDivElement | null>;

const DialogHeader: React.FC<{ icon: React.ReactNode; title: string; onClose: () => void }> = ({ icon, title, onClose }) => (
  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-base font-bold text-white">{title}</h3>
    </div>
    <button onClick={onClose} className="btn btn--sm btn--icon btn--quiet" aria-label="Fechar" title="Fechar">
      <X aria-hidden="true" />
    </button>
  </div>
);

export const SnapshotsDialog: React.FC<{
  dialogRef: DialogRef;
  clientName?: string;
  snapshots: ClientSnapshot[];
  newLabel: string;
  onNewLabelChange: (value: string) => void;
  onCreate: () => void;
  onRestore: (snap: ClientSnapshot) => void;
  onDelete: (id: string) => void;
  isRestoring: boolean;
  onClose: () => void;
}> = ({ dialogRef, clientName, snapshots, newLabel, onNewLabelChange, onCreate, onRestore, onDelete, isRestoring, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Versões anteriores da lista" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
      <DialogHeader icon={<History className="w-5 h-5 text-blue-400" />} title={`Versões de ${clientName ?? ''}`} onClose={onClose} />

      <p className="text-xs text-slate-300">
        A cada importação ou limpeza, o GuardList salva uma versão da lista. Para desfazer um erro, restaure a versão anterior.
      </p>

      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center gap-2 text-xs">
        <input
          type="text"
          placeholder="Nome do ponto manual (ex: Backup antes de atualizar firewall)"
          value={newLabel}
          onChange={(e) => onNewLabelChange(e.target.value)}
          className="field flex-1"
        />
        <button onClick={onCreate} className="btn btn--primary whitespace-nowrap">Salvar versão atual</button>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
        {snapshots.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            Nenhuma versão salva para este cliente ainda. Elas são criadas automaticamente a cada importação ou limpeza.
          </div>
        ) : (
          snapshots.map((snap) => (
            <div key={snap.id} className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{snap.label}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">{snap.entriesCount} itens</span>
                </div>
                <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  Salva em {new Date(snap.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button disabled={isRestoring} onClick={() => onRestore(snap)} className="btn btn--sm btn--primary">
                  <Undo2 className="w-3.5 h-3.5" />
                  Restaurar
                </button>
                <button onClick={() => onDelete(snap.id)} className="p-1.5 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-900 transition" title="Excluir esta versão">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

export const ClearListDialog: React.FC<{
  dialogRef: DialogRef;
  clientName?: string;
  total: number;
  confirmName: string;
  onConfirmNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ dialogRef, clientName, total, confirmName, onConfirmNameChange, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Confirmar exclusão da lista" className="bg-slate-900 border border-rose-900/60 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 modal-panel">
      <div className="flex items-center gap-2 text-rose-400">
        <AlertTriangle className="w-6 h-6" />
        <h3 className="text-base font-bold text-white">Zerar a lista de {clientName}?</h3>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed">
        Você está prestes a excluir <strong>todas as {total} entradas</strong> cadastradas para este cliente.
      </p>

      <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-xs text-blue-300">
        Antes de apagar, uma versão da lista é salva. Para voltar atrás, use <strong>Versões</strong>.
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">
          Digite o nome do cliente (<span className="text-white font-mono">{clientName}</span>) para confirmar:
        </label>
        <input
          type="text"
          placeholder={clientName}
          value={confirmName}
          onChange={(e) => onConfirmNameChange(e.target.value)}
          className="w-full bg-slate-950 text-white text-xs p-2.5 rounded-xl border border-slate-700 uppercase font-mono"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <button type="button" onClick={onCancel} className="btn btn--quiet">Cancelar</button>
        <button
          type="button"
          disabled={confirmName.trim().toUpperCase() !== clientName?.toUpperCase()}
          onClick={onConfirm}
          className="btn btn--destructive"
        >
          Zerar lista
        </button>
      </div>
    </div>
  </div>
);

export const RedundantDialog: React.FC<{
  dialogRef: DialogRef;
  clientName?: string;
  matches: ListIssue[];
  isCleaning: boolean;
  onClean: () => void;
  onClose: () => void;
}> = ({ dialogRef, clientName, matches, isCleaning, onClean, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Verificação de duplicatas" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
      <DialogHeader icon={<ScanSearch className="w-5 h-5 text-slate-400" />} title={`Validação da lista · ${clientName ?? ''}`} onClose={onClose} />

      {matches.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
          <h4 className="text-sm font-bold text-white">Nada repetido ou coberto</h4>
          <p className="text-xs text-slate-400">
            A lista ativa de {clientName} não tem repetidos, IPs dentro de um CIDR da própria lista nem conflitos com as exceções.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="notice notice--warn">
            <AlertTriangle aria-hidden="true" />
            <p>
              <strong>{matches.length}</strong>{' '}
              {matches.length === 1 ? 'item sobra' : 'itens sobram'} na lista ativa
              {' '}({matches.filter(m => m.reason === 'duplicate').length} repetido(s),{' '}
              {matches.filter(m => m.reason === 'cidr').length} dentro de CIDR
              {matches.some(m => m.reason === 'exception') ? `, ${matches.filter(m => m.reason === 'exception').length} em conflito com exceções` : ''}).
              Ao retirar, eles ficam como removidos, com o motivo na observação, e uma versão é salva antes.
            </p>
            <button type="button" onClick={onClean} disabled={isCleaning} className="btn btn--sm btn--primary whitespace-nowrap">
              {isCleaning ? 'Retirando…' : `Retirar ${matches.length}`}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 p-1.5 font-mono text-xs">
            {matches.map(match => (
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
);

export const NanoDialog: React.FC<{
  dialogRef: DialogRef;
  clientName?: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}> = ({ dialogRef, clientName, text, copied, onCopy, onDownload, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Visualização do formato NANO" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 space-y-4 modal-panel">
      <DialogHeader icon={<Terminal className="w-5 h-5 text-blue-400" />} title={`Formato NANO (Linux Firewall): ${clientName ?? ''}`} onClose={onClose} />

      <p className="text-xs text-slate-300">
        Este formato separa automaticamente os IPs únicos das sub-redes CIDR para você colar diretamente no terminal com o editor <strong>nano</strong>.
      </p>

      <div className="relative">
        <pre className="w-full bg-slate-950 font-mono text-xs text-blue-300 p-4 rounded-xl border border-slate-800 overflow-x-auto max-h-80 select-all leading-relaxed whitespace-pre">
          {text}
        </pre>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
        <span className="text-[11px] text-slate-400">Use o botão ou Ctrl+C para copiar.</span>
        <div className="flex items-center gap-2">
          <button onClick={onCopy} className="btn btn--primary">
            {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado' : 'Copiar texto NANO'}
          </button>
          <button onClick={onDownload} className="btn">
            <Download className="w-4 h-4" />
            Baixar .txt
          </button>
        </div>
      </div>
    </div>
  </div>
);
