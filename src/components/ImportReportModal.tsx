import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Download, FileSignature, FileText, Loader2 } from 'lucide-react';
import type { ImportHistoryRecord } from '../types';
import { getImportReport } from '../db/store';
import { formatDateTimeBR } from '../utils/csv';
import { triggerDownload } from '../utils/exporter';
import { importReportCsv, importReportHtml, reportSections, type ImportReportData } from '../utils/importReport';
import { printHtml } from '../utils/printHtml';
import { requestCaseBuilder } from './contextActions';
import { Modal } from './Modal';
import './ImportReport.css';

interface Props {
  historyId: string | null;
  onClose: () => void;
}

/** Relatório de uma importação: o que entrou na lista e o que ficou de fora, item por item. */
export const ImportReportModal: React.FC<Props> = ({ historyId, onClose }) => {
  const [data, setData] = useState<{ history: ImportHistoryRecord; report: ImportReportData | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!historyId) return;
    setData(null);
    setError(null);
    let cancelled = false;
    getImportReport(historyId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível abrir o relatório.'); });
    return () => { cancelled = true; };
  }, [historyId]);

  const copy = async (id: string, values: string[]) => {
    try {
      await navigator.clipboard.writeText(values.join('\n'));
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // sem acesso à área de transferência: nada a fazer além de não marcar como copiado
    }
  };

  const history = data?.history;
  const report = data?.report;
  const sections = report ? reportSections(report) : [];
  const slug = history ? `importacao-${history.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${history.date.slice(0, 10)}` : 'importacao';

  return (
    <Modal
      open={Boolean(historyId)}
      onClose={onClose}
      size="lg"
      title={history ? `Relatório da importação · ${history.clientName}` : 'Relatório da importação'}
      subtitle={history ? `${formatDateTimeBR(history.date)} · ${history.importedBy || '—'}${history.sourceTicket ? ` · ticket ${history.sourceTicket}` : ''}` : undefined}
      footer={
        history && report ? (
          <>
            <button type="button" className="btn" onClick={() => triggerDownload(`${slug}.csv`, importReportCsv(history, report), 'text/csv;charset=utf-8')}>
              <Download aria-hidden="true" /> Planilha (.csv)
            </button>
            <button type="button" className="btn" onClick={() => printHtml(importReportHtml(history, report, `${window.location.origin}/brand/guardlist-mark.png`))}>
              <FileText aria-hidden="true" /> PDF
            </button>
            {report.saved.length > 0 && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  onClose();
                  requestCaseBuilder(report.saved, history.clientId);
                }}
              >
                <FileSignature aria-hidden="true" /> Gerar caso com os gravados ({report.saved.length})
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {error ? (
        <div className="notice notice--danger" role="alert"><p>{error}</p></div>
      ) : !data ? (
        <div className="empty-state"><Loader2 className="animate-spin" aria-hidden="true" /><p>Abrindo o relatório…</p></div>
      ) : !report ? (
        <div className="empty-state">
          <FileText aria-hidden="true" />
          <p>Esta importação foi gravada antes do relatório detalhado existir. Só há os totais: {history!.addedCount} gravados, {history!.duplicatesDiscarded + (history!.coveredByCidrDiscarded || 0)} descartados e {history!.invalidsDiscarded} inválidos.</p>
        </div>
      ) : (
        <div className="ir">
          <div className="ir-summary">
            <div><span>Modo</span><strong>{report.mode === 'replace' ? 'Substituir lista' : 'Adicionar'}</strong></div>
            <div><span>Linhas lidas</span><strong>{report.totalLines}</strong></div>
            <div><span>Gravados</span><strong className="is-ok">+{report.saved.length}</strong></div>
            {report.result && <div><span>Lista</span><strong>{report.result.totalBefore} → {report.result.totalAfter}</strong></div>}
          </div>
          {report.source && <p className="ir-source">Arquivo: {report.source}</p>}

          {sections.map((section, index) => (
            <details key={section.id} className={`ir-section ${section.tone ? `is-${section.tone}` : ''}`} open={index < 3}>
              <summary>
                <ChevronDown aria-hidden="true" className="ir-chev" />
                <span className="ir-title">{section.title}</span>
                <span className="ir-count">{section.rows.length}</span>
                <button
                  type="button"
                  className="btn btn--sm btn--quiet ir-copy"
                  onClick={(e) => {
                    e.preventDefault();
                    void copy(section.id, section.rows.map((row) => row[0]));
                  }}
                  title="Copiar os indicadores desta seção (um por linha)"
                >
                  {copied === section.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied === section.id ? 'Copiado' : 'Copiar'}
                </button>
              </summary>
              <ul className="ir-list">
                {section.rows.map((row, i) => (
                  <li key={`${row[0]}-${i}`}>
                    <code data-indicator={row[0]}>{row[0]}</code>
                    {row[1] && <span>{row[1]}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </Modal>
  );
};
