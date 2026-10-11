// Documentos do relatório: planilha (CSV) e página com a marca (para PDF e e-mail).
// Sem dependências de tela, para rodar igual no navegador e no servidor.

import type { ReportData } from '../types/index.ts';
import { type CsvCell, formatDateBR, formatDateTimeBR, toCsv } from './csv.ts';

export const REPORT_STATUS_LABEL = { em_dia: 'Em dia', atrasado: 'Atrasado', sem_importacao: 'Sem importação' } as const;

export function reportTitle(report: ReportData): string {
  const client = report.clientId ? report.clients[0] : null;
  return client ? `Relatório do cliente ${client.name}` : 'Relatório geral da operação';
}

export function reportPeriod(report: ReportData): string {
  return `${formatDateBR(report.from)} a ${formatDateBR(report.to)}`;
}

export function reportFileSlug(report: ReportData): string {
  const client = report.clientId ? report.clients[0] : null;
  const slug = client ? client.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') : 'geral';
  return `relatorio-${slug}_${report.from}_a_${report.to}`;
}

export function reportCsv(report: ReportData): string {
  const isClient = Boolean(report.clientId);
  const client = isClient ? report.clients[0] : null;
  const rows: CsvCell[][] = [];
  rows.push([reportTitle(report)]);
  rows.push(['Período', reportPeriod(report)]);
  rows.push(['Gerado em', formatDateTimeBR(report.generatedAt), 'por', report.generatedBy]);
  rows.push([]);
  rows.push(['Resumo']);
  rows.push(['Importações', report.totals.imports]);
  rows.push(['Indicadores incluídos', report.totals.added]);
  rows.push(['Indicadores removidos', report.totals.removed]);
  if (isClient) {
    rows.push(['Ativos hoje', report.totals.activeNow]);
    rows.push(['Situação', client ? REPORT_STATUS_LABEL[client.status] : '']);
    rows.push(['Última revisão', formatDateBR(client?.lastUpdateDate)]);
    rows.push([]);
    rows.push(['Mudanças no período']);
    rows.push(['Data', 'Ação', 'Indicador', 'Tipo', 'Ticket', 'Por', 'Situação atual', 'Observação']);
    for (const c of report.changes) {
      rows.push([formatDateBR(c.date), c.action === 'incluido' ? 'Incluído' : 'Removido', c.indicator, c.type.replace('_', ' '), c.ticket, c.by, c.currentStatus === 'active' ? 'Ativo' : 'Removido', c.notes]);
    }
  } else {
    rows.push([`Clientes fora do prazo (${report.slaDays} dias)`, report.totals.late]);
    rows.push([]);
    rows.push(['Clientes']);
    rows.push(['Cliente', 'Situação', 'Última revisão', 'Importações', 'Incluídos', 'Removidos', 'Ativos hoje', 'Responsáveis']);
    for (const c of report.clients) {
      rows.push([c.name, REPORT_STATUS_LABEL[c.status], formatDateBR(c.lastUpdateDate), c.importsInPeriod, c.addedInPeriod, c.removedInPeriod, c.activeNow, c.importers.join(', ')]);
    }
  }
  rows.push([]);
  rows.push(['Importações no período']);
  rows.push(['Data', 'Semana', 'Cliente', 'Por', 'Novos', 'Descartados', 'Inválidos', 'Ticket', 'Observações']);
  for (const r of report.imports) {
    rows.push([formatDateTimeBR(r.date), r.isoWeek, r.clientName, r.importedBy || '', r.addedCount, r.duplicatesDiscarded + (r.coveredByCidrDiscarded || 0), r.invalidsDiscarded, r.sourceTicket || '', r.notes || '']);
  }
  rows.push([]);
  rows.push(['Atividade por pessoa']);
  rows.push(['Pessoa', 'Importações', 'Incluídos', 'Removidos']);
  for (const a of report.activity) rows.push([a.name, a.imports, a.added, a.removed]);
  return toCsv(rows);
}

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/**
 * Página do relatório com a marca, em tema claro e tamanho A4. Serve para imprimir/salvar em PDF
 * e como corpo do e-mail mensal. `logoUrl` precisa ser absoluto no e-mail.
 */
export function reportHtml(report: ReportData, options: { logoUrl: string; forPrint?: boolean }): string {
  const isClient = Boolean(report.clientId);
  const client = isClient ? report.clients[0] : null;
  const num = (n: number) => n.toLocaleString('pt-BR');
  const kpis: Array<[string, string, string]> = [
    ['Importações', num(report.totals.imports), 'no período'],
    ['Incluídos', `+${num(report.totals.added)}`, 'indicadores novos'],
    ['Removidos', num(report.totals.removed), 'marcados como removidos'],
    isClient
      ? ['Ativos hoje', num(report.totals.activeNow), client ? REPORT_STATUS_LABEL[client.status] : '']
      : ['Fora do prazo', num(report.totals.late), `de ${report.totals.clients} clientes (${report.slaDays} dias)`]
  ];

  const table = (head: string[], rows: string[][], numeric: number[] = []) => `
    <table>
      <thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="empty">Nada registrado neste período.</td></tr>`}</tbody>
    </table>`;

  const mainSection = isClient
    ? `<h2>Mudanças no período</h2>${table(
        ['Data', 'Ação', 'Indicador', 'Tipo', 'Ticket', 'Por', 'Observação'],
        report.changes.map((c) => [esc(formatDateBR(c.date)), c.action === 'incluido' ? '<span class="tag ok">Incluído</span>' : '<span class="tag">Removido</span>', `<span class="mono">${esc(c.indicator)}</span>`, esc(c.type.replace('_', ' ')), esc(c.ticket || '—'), esc(c.by || '—'), esc(c.notes || '')])
      )}`
    : `<h2>Clientes</h2>${table(
        ['Cliente', 'Situação', 'Última revisão', 'Importações', 'Incluídos', 'Removidos', 'Ativos hoje'],
        report.clients.map((c) => [`<strong>${esc(c.name)}</strong>`, `<span class="tag ${c.status === 'em_dia' ? 'ok' : c.status === 'atrasado' ? 'bad' : 'warn'}">${REPORT_STATUS_LABEL[c.status]}</span>`, esc(formatDateBR(c.lastUpdateDate) || '—'), num(c.importsInPeriod), num(c.addedInPeriod), num(c.removedInPeriod), num(c.activeNow)]),
        [3, 4, 5, 6]
      )}`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(reportTitle(report))} · ${esc(reportPeriod(report))}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif; color: #172033; background: #fff; font-size: 12px; line-height: 1.45; }
  .page { max-width: 820px; margin: 0 auto; padding: ${options.forPrint ? '0' : '24px'}; }
  header.brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1f4fd1; padding-bottom: 12px; margin-bottom: 18px; }
  header.brand .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: #0f1b33; }
  header.brand img { width: 30px; height: 30px; }
  header.brand .meta { text-align: right; color: #5b6478; font-size: 11px; }
  h1 { font-size: 20px; margin: 0 0 2px; color: #0f1b33; }
  .period { color: #5b6478; margin: 0 0 16px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi { border: 1px solid #dfe4ee; border-radius: 8px; padding: 10px 12px; }
  .kpi span { display: block; color: #5b6478; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .kpi strong { display: block; font-size: 20px; color: #0f1b33; margin: 2px 0; }
  .kpi small { color: #7a8396; font-size: 10px; }
  h2 { font-size: 13px; margin: 20px 0 8px; color: #0f1b33; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; font-weight: 600; color: #5b6478; border-bottom: 1px solid #c9d0de; padding: 6px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  td { border-bottom: 1px solid #edf0f5; padding: 6px 6px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: 'IBM Plex Mono', Consolas, monospace; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; background: #eef1f6; color: #3a4459; font-size: 10px; font-weight: 600; }
  .tag.ok { background: #e3f6ec; color: #17663f; } .tag.bad { background: #fde8e8; color: #9b1c1c; } .tag.warn { background: #fdf3dc; color: #8a5a00; }
  .empty { color: #7a8396; text-align: center; padding: 14px; }
  .notes { color: #3a4459; white-space: pre-line; margin: -6px 0 12px; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #dfe4ee; color: #7a8396; font-size: 10px; }
</style></head>
<body><div class="page">
  <header class="brand">
    <div class="logo"><img src="${esc(options.logoUrl)}" alt="">GuardList</div>
    <div class="meta">Gerado em ${esc(formatDateTimeBR(report.generatedAt))}<br>por ${esc(report.generatedBy)}</div>
  </header>
  <h1>${esc(reportTitle(report))}</h1>
  <p class="period">Período: ${esc(reportPeriod(report))}</p>
  ${client?.notes ? `<p class="notes">${esc(client.notes)}</p>` : ''}
  <div class="kpis">${kpis.map(([label, value, hint]) => `<div class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></div>`).join('')}</div>
  ${mainSection}
  <h2>Importações no período</h2>
  ${table(['Data', 'Cliente', 'Por', 'Novos', 'Ticket'], report.imports.map((r) => [esc(formatDateTimeBR(r.date)), esc(r.clientName), esc(r.importedBy || '—'), num(r.addedCount), esc(r.sourceTicket || '—')]), [3])}
  ${report.activity.length ? `<h2>Atividade por pessoa</h2>${table(['Pessoa', 'Importações', 'Incluídos', 'Removidos'], report.activity.map((a) => [esc(a.name), num(a.imports), num(a.added), num(a.removed)]), [1, 2, 3])}` : ''}
  <footer>Incluídos contam pela data de inclusão; removidos, pela data em que foram marcados. Documento gerado pelo GuardList.</footer>
</div></body></html>`;
}
