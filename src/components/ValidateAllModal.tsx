import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { cleanAllClients, validateAllClients, type ClientValidation } from '../db/store';
import type { ShowToast } from '../App';

interface ValidateAllModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenList: (clientId: string) => void;
  onOpenReview: () => void;
  showToast: ShowToast;
}

// Validação de todas as listas de uma vez: repetidos, IPs dentro de CIDR, conflitos com exceções e itens para revisão.
export const ValidateAllModal: React.FC<ValidateAllModalProps> = ({ open, onClose, onDone, onOpenList, onOpenReview, showToast }) => {
  const [rows, setRows] = useState<ClientValidation[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setRows(null);
    setError(null);
    validateAllClients().then(setRows).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const fixable = (r: ClientValidation) => r.duplicates + r.covered + r.exceptionConflicts;
  const totals = (rows || []).reduce(
    (acc, r) => ({
      duplicates: acc.duplicates + r.duplicates,
      covered: acc.covered + r.covered,
      exceptions: acc.exceptions + r.exceptionConflicts,
      review: acc.review + r.reviewDue,
      clients: acc.clients + (fixable(r) > 0 ? 1 : 0)
    }),
    { duplicates: 0, covered: 0, exceptions: 0, review: 0, clients: 0 }
  );
  const totalFix = totals.duplicates + totals.covered + totals.exceptions;

  const cleanAll = async () => {
    setCleaning(true);
    try {
      const result = await cleanAllClients();
      showToast(`${result.retired} itens retirados em ${result.clients} clientes. Cada lista alterada ganhou uma versão salva antes.`);
      onDone();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao corrigir.');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Validação de todas as listas"
      subtitle="Repetidos, IPs já contidos em um CIDR da mesma lista, conflitos com exceções e bloqueios parados para revisão."
      footer={
        <>
          {totals.review > 0 && (
            <button type="button" className="btn" onClick={() => { onClose(); onOpenReview(); }}>
              Abrir revisão ({totals.review})
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={!rows || totalFix === 0 || cleaning} onClick={cleanAll}>
            {cleaning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            {totalFix ? `Corrigir ${totalFix} em ${totals.clients} cliente${totals.clients === 1 ? '' : 's'}` : 'Nada para corrigir'}
          </button>
        </>
      }
    >
      {error && <div className="notice notice--danger mb-3"><p>{error}</p></div>}
      {!rows ? (
        <div className="empty-state"><Loader2 className="animate-spin" aria-hidden="true" /><p>Verificando todas as listas…</p></div>
      ) : (
        <>
          <div className="workspace-summary mb-4" aria-label="Resumo da validação">
            <div className="workspace-summary__item"><span>Repetidos</span><strong>{totals.duplicates}</strong><small>mesmo indicador mais de uma vez</small></div>
            <div className="workspace-summary__item"><span>Dentro de CIDR</span><strong>{totals.covered}</strong><small>já cobertos por uma rede</small></div>
            <div className={`workspace-summary__item ${totals.exceptions ? 'has-warning' : ''}`}><span>Exceções</span><strong>{totals.exceptions}</strong><small>bloqueariam IP protegido</small></div>
            <div className="workspace-summary__item"><span>Para revisão</span><strong>{totals.review}</strong><small>parados há muito tempo</small></div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="text-right">Ativos</th>
                  <th className="text-right">Repetidos</th>
                  <th className="text-right">Em CIDR</th>
                  <th className="text-right">Exceções</th>
                  <th className="text-right">Revisão</th>
                  <th>Exemplos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.clientId} className="is-clickable" onClick={() => { onClose(); onOpenList(r.clientId); }}>
                    <td>
                      <span className="data-table__primary">{r.name}</span>
                      {fixable(r) === 0 && <CheckCircle2 className="inline w-3.5 h-3.5 ml-1.5 text-emerald-400" aria-label="Lista limpa" />}
                    </td>
                    <td className="text-right font-mono tabular-nums">{r.active}</td>
                    <td className={`text-right font-mono tabular-nums ${r.duplicates ? 'text-amber-300' : ''}`}>{r.duplicates}</td>
                    <td className={`text-right font-mono tabular-nums ${r.covered ? 'text-amber-300' : ''}`}>{r.covered}</td>
                    <td className={`text-right font-mono tabular-nums ${r.exceptionConflicts ? 'text-rose-400' : ''}`}>{r.exceptionConflicts}</td>
                    <td className="text-right font-mono tabular-nums">{r.reviewDue}</td>
                    <td><span className="data-table__clamp font-mono text-[11px]" title={r.samples.join('\n')}>{r.samples.slice(0, 2).join(' · ') || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Corrigir retira os itens que sobram (ficam como removidos, com o motivo na observação). Fica o item mais antigo ou o CIDR mais abrangente.
          </p>
        </>
      )}
    </Modal>
  );
};
