// Planilhas CSV que abrem direto no Excel em português: separador ";", BOM UTF-8 e quebras CRLF.

export type CsvCell = string | number | null | undefined;

// Evita que um valor vindo da lista seja interpretado como fórmula pelo Excel (=, +, -, @).
export function neutralize(value: string): string {
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

// Lê campos entre aspas, aspas escapadas e quebras de linha dentro de uma célula.
export function parseCsv(text: string, delimiter: string = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field); field = '';
    } else if (char === '\r' || char === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += char;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Datas sempre no horário de Brasília, também quando geradas no servidor (que roda em UTC).
const TIME_ZONE = 'America/Sao_Paulo';

export function formatDateBR(value: string | null | undefined): string {
  if (!value) return '';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
}

export function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE });
}
