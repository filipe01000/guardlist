// Relatório de uma importação: o que entrou na lista e o que ficou de fora (e por quê).
// Montado a partir da pré-visualização no momento da gravação; o servidor completa com os
// removidos (modo substituir) e os números finais.
import type { ImportHistoryRecord } from '../types';
import { type CsvCell, formatDateTimeBR, toCsv } from './csv';

export interface ImportReportData {
  mode: 'append' | 'replace';
  source?: string;
  totalLines: number;
  /** Novos indicadores gravados. */
  saved: string[];
  /** Modo substituir: já estavam na lista e continuam. */
  kept: string[];
  /** Modo adicionar: já estavam na lista (não foram regravados). */
  alreadyExists: string[];
  /** Repetidos dentro da própria lista colada. */
  duplicates: string[];
  /** Já cobertos por um CIDR (da lista ou do próprio lote). */
  coveredByCidr: Array<{ indicator: string; by: string }>;
  /** Itens da lista atual que um CIDR novo passou a cobrir (saem por redundância). */
  supersededByNewCidr: Array<{ indicator: string; by: string }>;
  exceptions: Array<{ indicator: string; rule: string }>;
  invalid: Array<{ original: string; error: string }>;
  reserved: Array<{ indicator: string; reason: string; saved: boolean }>;
  /** IPs de serviços legítimos que não foram gravados. */
  legitSkipped: string[];
  /** Preenchido pelo servidor: arquivados ao substituir a lista. */
  removed?: string[];
  /** Preenchido pelo servidor: números finais da gravação. */
  result?: { added: number; retired: number; removed: number; blockedByException: number; totalBefore: number; totalAfter: number };
}

const LIMIT = 20_000;
const cap = <T,>(list: T[]) => list.slice(0, LIMIT);

interface PreviewLike {
  totalLines: number;
  items: Array<{ indicator: string; original: string; category: string; coveredByCidr?: string; exceptionHit?: string; error?: string; reservedReason?: string }>;
  superseded: Array<{ indicator: string; coveredBy: string }>;
}

export function buildImportReport(
  preview: PreviewLike,
  options: { mode: 'append' | 'replace'; source?: string; saved: Set<string>; legitSkipped: string[] }
): ImportReportData {
  const of = (category: string) => preview.items.filter((i) => i.category === category);
  return {
    mode: options.mode,
    source: options.source,
    totalLines: preview.totalLines,
    // Só os itens que entraram (novos ou faixas reservadas aceitas); a cópia repetida na colagem não conta.
    saved: cap([...new Set(preview.items.filter((i) => (i.category === 'new' || i.category === 'reserved_warning') && options.saved.has(i.indicator)).map((i) => i.indicator))]),
    kept: options.mode === 'replace' ? cap(of('already_exists').map((i) => i.indicator)) : [],
    alreadyExists: options.mode === 'append' ? cap(of('already_exists').map((i) => i.indicator)) : [],
    duplicates: cap([...new Set(of('dup_in_file').map((i) => i.indicator))]),
    coveredByCidr: cap(of('covered_by_cidr').map((i) => ({ indicator: i.indicator, by: i.coveredByCidr || '' }))),
    supersededByNewCidr: cap(preview.superseded.map((s) => ({ indicator: s.indicator, by: s.coveredBy }))),
    exceptions: cap(of('exception').map((i) => ({ indicator: i.indicator, rule: i.exceptionHit || '' }))),
    invalid: cap(of('invalid').map((i) => ({ original: i.original || i.indicator, error: i.error || 'Formato não reconhecido' }))),
    reserved: cap(of('reserved_warning').map((i) => ({ indicator: i.indicator, reason: i.reservedReason || 'faixa reservada', saved: options.saved.has(i.indicator) }))),
    legitSkipped: cap(options.legitSkipped)
  };
}

/** Seções do relatório, na ordem em que aparecem (tela, planilha e PDF). */
export function reportSections(r: ImportReportData) {
  return [
    { id: 'saved', title: 'Gravados (novos na lista)', tone: 'ok', rows: r.saved.map((i) => [i]) },
    { id: 'kept', title: 'Mantidos (já estavam e continuam)', tone: '', rows: r.kept.map((i) => [i]) },
    { id: 'alreadyExists', title: 'Já estavam na lista', tone: '', rows: r.alreadyExists.map((i) => [i]) },
    { id: 'duplicates', title: 'Repetidos na lista enviada', tone: 'warn', rows: r.duplicates.map((i) => [i]) },
    { id: 'coveredByCidr', title: 'Já cobertos por um CIDR', tone: 'warn', rows: r.coveredByCidr.map((i) => [i.indicator, `dentro de ${i.by}`]) },
    { id: 'superseded', title: 'Retirados da lista: um CIDR novo já os cobre', tone: 'warn', rows: r.supersededByNewCidr.map((i) => [i.indicator, `dentro de ${i.by}`]) },
    { id: 'exceptions', title: 'Recusados pelas exceções do cliente', tone: 'bad', rows: r.exceptions.map((i) => [i.indicator, i.rule && i.rule !== i.indicator ? `regra ${i.rule}` : '']) },
    { id: 'reserved', title: 'Faixas privadas/reservadas', tone: 'warn', rows: r.reserved.map((i) => [i.indicator, `${i.reason}${i.saved ? ' · gravado' : ' · não gravado'}`]) },
    { id: 'legit', title: 'Serviços legítimos não gravados', tone: '', rows: r.legitSkipped.map((i) => [i]) },
    { id: 'invalid', title: 'Inválidos (ignorados)', tone: 'bad', rows: r.invalid.map((i) => [i.original, i.error]) },
    { id: 'removed', title: 'Arquivados ao substituir a lista', tone: 'bad', rows: (r.removed ?? []).map((i) => [i]) }
  ].filter((s) => s.rows.length > 0);
}

export function importReportCsv(history: ImportHistoryRecord, r: ImportReportData): string {
  const rows: CsvCell[][] = [];
  rows.push([`Relatório da importação · ${history.clientName}`]);
  rows.push(['Data', formatDateTimeBR(history.date), 'Por', history.importedBy || '']);
  rows.push(['Modo', r.mode === 'replace' ? 'Substituir lista' : 'Adicionar à lista', 'Ticket', history.sourceTicket || '']);
  if (r.source) rows.push(['Arquivo', r.source]);
  rows.push(['Linhas lidas', r.totalLines]);
  if (r.result) {
    rows.push(['Lista antes', r.result.totalBefore, 'Lista depois', r.result.totalAfter]);
  }
  rows.push([]);
  rows.push(['Resumo']);
  for (const s of reportSections(r)) rows.push([s.title, s.rows.length]);
  for (const s of reportSections(r)) {
    rows.push([]);
    rows.push([s.title]);
    for (const row of s.rows) rows.push(row);
  }
  return toCsv(rows);
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Página A4 para imprimir/salvar em PDF. */
export function importReportHtml(history: ImportHistoryRecord, r: ImportReportData, logoUrl: string): string {
  const sections = reportSections(r);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Importação · ${esc(history.clientName)} · ${esc(formatDateTimeBR(history.date))}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { margin: 0; font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif; color: #172033; font-size: 12px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1f4fd1; padding-bottom: 10px; margin-bottom: 14px; }
  header .logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; } header img { width: 26px; height: 26px; }
  h1 { font-size: 18px; margin: 0 0 4px; } .meta { color: #5b6478; margin: 0 0 12px; }
  .sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; margin: 0 0 14px; }
  .sum div { display: flex; justify-content: space-between; border-bottom: 1px solid #edf0f5; padding: 3px 0; }
  h2 { font-size: 12.5px; margin: 16px 0 6px; } h2 small { color: #7a8396; font-weight: 400; }
  .list { columns: 3; column-gap: 18px; font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 10.5px; }
  .list div { break-inside: avoid; padding: 1px 0; } .list span { color: #7a8396; font-family: 'IBM Plex Sans', Arial, sans-serif; }
  footer { margin-top: 18px; border-top: 1px solid #dfe4ee; padding-top: 8px; color: #7a8396; font-size: 10px; }
</style></head><body>
<header><div class="logo"><img src="${esc(logoUrl)}" alt="">GuardList</div><div class="meta">${esc(formatDateTimeBR(history.date))} · ${esc(history.importedBy || '')}</div></header>
<h1>Relatório da importação · ${esc(history.clientName)}</h1>
<p class="meta">${r.mode === 'replace' ? 'Lista substituída' : 'Indicadores adicionados à lista'}${history.sourceTicket ? ` · ticket ${esc(history.sourceTicket)}` : ''}${r.source ? ` · arquivo ${esc(r.source)}` : ''} · ${r.totalLines} linhas lidas${r.result ? ` · lista: ${r.result.totalBefore} → ${r.result.totalAfter}` : ''}</p>
<div class="sum">${sections.map((s) => `<div><span>${esc(s.title)}</span><strong>${s.rows.length}</strong></div>`).join('')}</div>
${sections.map((s) => `<h2>${esc(s.title)} <small>(${s.rows.length})</small></h2><div class="list">${s.rows.map((row) => `<div>${esc(row[0])}${row[1] ? ` <span>${esc(row[1])}</span>` : ''}</div>`).join('')}</div>`).join('')}
<footer>Documento gerado pelo GuardList.</footer>
</body></html>`;
}
