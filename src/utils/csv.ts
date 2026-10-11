// Planilhas CSV que abrem direto no Excel em português: separador ";", BOM UTF-8 e quebras CRLF.

export type CsvCell = string | number | null | undefined;

// Evita que um valor vindo da lista seja interpretado como fórmula pelo Excel (=, +, -, @).
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !/^-?\d+([.,]\d+)?$/.test(value) ? `'${value}` : value;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value).replace('.', ',') : neutralize(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return '﻿' + rows.map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function formatDateBR(value: string | null | undefined): string {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

export function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
