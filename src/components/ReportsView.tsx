import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Client } from '../types';
import { getReport, ReportData } from '../db/store';
import { formatDateBR, formatDateTimeBR } from '../utils/csv';
import { reportCsv, reportFileSlug, reportHtml } from '../utils/reportDocs';
import { triggerDownload } from '../utils/exporter';
import { PageHeader } from './PageHeader';

interface ReportsViewProps {
  clients: Client[];
}

type Preset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | '90d' | 'custom';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'this-week', label: 'Esta semana' },
  { id: 'last-week', label: 'Semana passada' },
  { id: 'this-month', label: 'Este mês' },
  { id: 'last-month', label: 'Mês passado' },
  { id: '90d', label: 'Últimos 90 dias' },
  { id: 'custom', label: 'Personalizado' }
];

const STATUS_LABEL = { em_dia: 'Em dia', atrasado: 'Atrasado', sem_importacao: 'Sem importação' } as const;

function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Semanas começam na segunda-feira, como a semana ISO usada no histórico.
function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  switch (preset) {
    case 'this-week':
      return { from: ymd(monday), to: ymd(today) };
    case 'last-week': {
      const start = new Date(monday);
      start.setDate(monday.getDate() - 7);
      const end = new Date(monday);
      end.setDate(monday.getDate() - 1);
      return { from: ymd(start), to: ymd(end) };
    }
    case 'this-month':
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
    case 'last-month':
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth(), 0))
      };
    case '90d': {
      const start = new Date(today);
      start.setDate(today.getDate() - 89);
      return { from: ymd(start), to: ymd(today) };
    }
  }
}

function statusChip(status: keyof typeof STATUS_LABEL) {
  const cls = status === 'em_dia' ? 'chip chip--ok' : status === 'atrasado' ? 'chip chip--danger' : 'chip chip--warn';
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ clients }) => {
  const activeClients = useMemo(() => clients.filter((c) => !c.isArchived), [clients]);
  const [scope, setScope] = useState<string>('ALL');
  const [preset, setPreset] = useState<Preset>('this-month');
  const initial = presetRange('this-month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') {
      const range = presetRange(next);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReport({
      from,
      to,
      startIso: new Date(`${from}T00:00:00`).toISOString(),
      endIso: new Date(`${to}T23:59:59.999`).toISOString(),
      clientId: scope === 'ALL' ? undefined : scope
    })
      .then((data) => !cancelled && setReport(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Não foi possível gerar o relatório.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, scope]);

  const isClientReport = scope !== 'ALL';
  const client = report?.clients[0];
  const periodLabel = `${formatDateBR(from)} a ${formatDateBR(to)}`;

  const handleExport = () => {
    if (!report) return;
    triggerDownload(`${reportFileSlug(report)}.csv`, reportCsv(report), 'text/csv;charset=utf-8');
  };

  // PDF: abre a página do relatório com a marca numa moldura invisível e chama a impressão
  // (no diálogo, escolha "Salvar como PDF").
  const handlePdf = () => {
    if (!report) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return frame.remove();
    doc.open();
    doc.write(reportHtml(report, { logoUrl: `${window.location.origin}/brand/guardlist-mark.png`, forPrint: true }));
    doc.close();
    const print = () => {
      win.focus();
      win.print();
      window.setTimeout(() => frame.remove(), 1500);
    };
    const logo = doc.querySelector('img');
    if (logo && !logo.complete) {
      logo.addEventListener('load', print, { once: true });
      logo.addEventListener('error', print, { once: true });
    } else {
      window.setTimeout(print, 60);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description="Resumo de um período para a operação inteira ou para um cliente: planilha para a equipe ou PDF com a marca, pronto para mandar ao cliente."
        actions={
          <>
            <button type="button" className="btn" onClick={handleExport} disabled={!report || loading}>
              <Download aria-hidden="true" />
              Planilha (.csv)
            </button>
            <button type="button" className="btn btn--primary" onClick={handlePdf} disabled={!report || loading} title="Abre a impressão; escolha Salvar como PDF">
              <FileText aria-hidden="true" />
              PDF para o cliente
            </button>
          </>
        }
      />

      <div className="report-filters">
        <div>
          <label className="field-label" htmlFor="report-scope">Relatório</label>
          <select id="report-scope" className="field w-full" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="ALL">Geral da operação</option>
            <optgroup label="Por cliente">
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="report-filters__period">
          <span className="field-label">Período</span>
          <div className="segmented segmented--wrap" role="group" aria-label="Período">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choosePreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="report-filters__dates">
          <label>
            <span className="field-label">De</span>
            <input type="date" className="field" value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
          </label>
          <label>
            <span className="field-label">Até</span>
            <input type="date" className="field" value={to} min={from} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
          </label>
        </div>
      </div>

      {error && <div className="notice notice--danger" role="alert"><p>{error}</p></div>}

      {!report ? (
        <div className="data-panel empty-state">
          <Loader2 className="animate-spin" aria-hidden="true" />
          <p>Gerando relatório…</p>
        </div>
      ) : (
        <div key={`${scope}-${from}-${to}`} className={`space-y-6 view-enter ${loading ? 'opacity-60' : ''}`}>
          <div className="workspace-summary" aria-label="Resumo do período">
            <div className="workspace-summary__item">
              <span>Importações</span>
              <strong>{report.totals.imports}</strong>
              <small>{periodLabel}</small>
            </div>
            <div className="workspace-summary__item">
              <span>Incluídos</span>
              <strong>+{report.totals.added}</strong>
              <small>Indicadores novos no período</small>
            </div>
            <div className="workspace-summary__item">
              <span>Removidos</span>
              <strong>{report.totals.removed}</strong>
              <small>Marcados como removidos</small>
            </div>
            {isClientReport ? (
              <div className="workspace-summary__item">
                <span>Ativos hoje</span>
                <strong>{report.totals.activeNow}</strong>
                <small>{client ? `${STATUS_LABEL[client.status]} · revisão ${formatDateBR(client.lastUpdateDate) || '—'}` : ''}</small>
              </div>
            ) : (
              <div className={`workspace-summary__item ${report.totals.late > 0 ? 'has-warning' : ''}`}>
                <span>Fora do prazo</span>
                <strong>{report.totals.late}</strong>
                <small>de {report.totals.clients} clientes (prazo de {report.slaDays} dias)</small>
              </div>
            )}
          </div>

          {isClientReport && client?.notes && (
            <p className="text-xs text-slate-400 whitespace-pre-line -mt-2">{client.notes}</p>
          )}

          {!isClientReport ? (
            <section className="data-panel" aria-labelledby="report-clients-title">
              <header className="data-panel__header">
                <h2 id="report-clients-title">Clientes</h2>
                <span>{report.clients.length} ativos</span>
              </header>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Situação</th>
                      <th>Última revisão</th>
                      <th className="text-right">Importações</th>
                      <th className="text-right">Incluídos</th>
                      <th className="text-right">Removidos</th>
                      <th className="text-right">Ativos hoje</th>
                      <th>Responsáveis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.clients.map((c) => (
                      <tr key={c.clientId} className="is-clickable" onClick={() => setScope(c.clientId)} title={`Abrir relatório de ${c.name}`}>
                        <td><span className="data-table__primary">{c.name}</span></td>
                        <td>{statusChip(c.status)}</td>
                        <td className="font-mono whitespace-nowrap">{formatDateBR(c.lastUpdateDate) || '—'}</td>
                        <td className="text-right font-mono tabular-nums">{c.importsInPeriod}</td>
                        <td className="text-right font-mono tabular-nums text-emerald-400">{c.addedInPeriod ? `+${c.addedInPeriod}` : '0'}</td>
                        <td className="text-right font-mono tabular-nums">{c.removedInPeriod}</td>
                        <td className="text-right font-mono tabular-nums text-white">{c.activeNow}</td>
                        <td><span className="data-table__clamp">{c.importers.join(', ') || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="data-panel" aria-labelledby="report-changes-title">
              <header className="data-panel__header">
                <h2 id="report-changes-title">Mudanças no período</h2>
                <span>{report.changes.length} {report.changes.length === 1 ? 'registro' : 'registros'}</span>
              </header>
              {report.changes.length === 0 ? (
                <div className="empty-state">
                  <FileSpreadsheet aria-hidden="true" />
                  <strong>Nenhuma mudança neste período</strong>
                  <p>Escolha um período maior ou outro cliente.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table" style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 96 }}>Data</th>
                        <th style={{ width: 104 }}>Ação</th>
                        <th>Indicador</th>
                        <th style={{ width: 92 }}>Tipo</th>
                        <th style={{ width: 110 }}>Ticket</th>
                        <th style={{ width: 130 }}>Por</th>
                        <th>Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.changes.map((c, i) => (
                        <tr key={`${c.action}-${c.indicator}-${i}`}>
                          <td className="font-mono whitespace-nowrap">{formatDateBR(c.date)}</td>
                          <td>{c.action === 'incluido' ? <span className="chip chip--ok">Incluído</span> : <span className="chip">Removido</span>}</td>
                          <td className="font-mono text-white">{c.indicator}</td>
                          <td><span className="data-tag">{c.type.replace('_', ' ')}</span></td>
                          <td className="font-mono">{c.ticket || '—'}</td>
                          <td>{c.by || '—'}</td>
                          <td><span className="data-table__clamp" title={c.notes}>{c.notes || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6">
            <section className="data-panel" aria-labelledby="report-imports-title">
              <header className="data-panel__header">
                <h2 id="report-imports-title">Importações no período</h2>
                <span>{report.imports.length}</span>
              </header>
              {report.imports.length === 0 ? (
                <p className="rail-empty pt-4">Nenhuma importação gravada neste período.</p>
              ) : (
                <ul className="rail-list pt-2">
                  {report.imports.map((r) => (
                    <li key={r.id} className="rail-row cursor-default">
                      <strong>{r.clientName}</strong>
                      <span className="is-muted">+{r.addedCount} · {formatDateTimeBR(r.date)}{r.importedBy ? ` · ${r.importedBy}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="data-panel" aria-labelledby="report-activity-title">
              <header className="data-panel__header">
                <h2 id="report-activity-title">Atividade por pessoa</h2>
              </header>
              {report.activity.length === 0 ? (
                <p className="rail-empty pt-4">Ninguém importou ou removeu indicadores neste período.</p>
              ) : (
                <table className="data-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th className="text-right">Import.</th>
                      <th className="text-right">Incl.</th>
                      <th className="text-right">Rem.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.activity.map((a) => (
                      <tr key={a.name}>
                        <td className="text-white">{a.name}</td>
                        <td className="text-right font-mono tabular-nums">{a.imports}</td>
                        <td className="text-right font-mono tabular-nums">{a.added}</td>
                        <td className="text-right font-mono tabular-nums">{a.removed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <p className="text-[11px] text-slate-500">
            Gerado em {formatDateTimeBR(report.generatedAt)} por {report.generatedBy}. Incluídos contam pela data de inclusão; removidos, pela data em que foram marcados.
          </p>
        </div>
      )}
    </div>
  );
};
