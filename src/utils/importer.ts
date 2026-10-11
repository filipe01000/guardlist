/**
 * Mecanismo de Análise e Pré-visualização da Importação Semanal
 * Processa arquivos de dezenas de milhares de linhas com máxima eficiência via Set e Map.
 * Suporta separação automática de múltiplos IPs por linha, remoção de cabeçalhos NANO
 * (=== IPS ÚNICOS === e === REDES CIDR ===) e higienização inteligente.
 */

import { ImportPreviewItem, ImportPreviewSummary } from '../types';
import { normalizeIndicator, classifyIndicator, checkReservedRange } from './validator';
import { exceptionHit, findRedundant, toRange } from './redundancy';
import { parseCsv } from './csv';

/**
 * Remove cabeçalhos NANO e divide qualquer texto em tokens individuais
 * Suporta múltiplos IPs na mesma linha separados por espaço, vírgula ou tab.
 */
export function extractTokensFromRawInput(rawInput: string): Array<{
  token: string;
  original: string;
  wasInlineHeader?: boolean;
}> {
  if (!rawInput) return [];

  // Em planilhas com cabeçalho, somente a coluna de indicadores é uma lista de bloqueio.
  // Tickets e observações podem mencionar IPs/domínios que não devem ser importados.
  const csvText = rawInput.replace(/^\uFEFF/, '');
  const firstLine = csvText.split(/\r?\n/, 1)[0];
  for (const delimiter of [';', ',', '\t']) {
    const headers = (parseCsv(firstLine, delimiter)[0] ?? []).map((value) =>
      value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const indicatorColumn = headers.findIndex((header) => /^(indicador|indicator|ip|cidr|dominio|domain)$/.test(header));
    if (headers.length < 2 || indicatorColumn === -1) continue;
    const statusColumn = headers.indexOf('status');
    return parseCsv(csvText, delimiter).slice(1)
      .filter((row) => statusColumn === -1 || !/^(removido|removed)$/i.test(row[statusColumn]?.trim() ?? ''))
      .map((row) => (row[indicatorColumn] ?? '').trim())
      .filter(Boolean)
      .map((token) => ({ token, original: token }));
  }

  // 1. Substituir cabeçalhos conhecidos do nano ou marcadores por quebra de linha
  // Ex: === IPS ÚNICOS ===, === REDES CIDR ===, === DOMÍNIOS ===
  const cleaned = rawInput.replace(/===+[^=]*===+/gi, '\n');

  // 2. Dividir por quebras de linha
  const lines = cleaned.split(/\r?\n/);
  const result: Array<{ token: string; original: string }> = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    // Ignorar linhas vazias e comentários iniciados por #
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Se a linha contiver múltiplos itens separados por espaços, tabs, vírgulas ou ponto-e-vírgulas
    // Ex: "200.219.11.15 93.187.128.69 131.161.229.198"
    const subTokens = trimmed.split(/[\s,;]+/).filter(Boolean);

    for (const sub of subTokens) {
      // Ignorar caracteres de decoração ou marcadores isolados
      if (sub === '===' || sub === '==' || sub === '=') continue;
      result.push({
        token: sub,
        original: sub
      });
    }
  }

  return result;
}

/**
 * Extrai puramente todos os IPs (v4/v6) e blocos CIDR válidos contidos em qualquer texto bruto
 * Ideal para quando o usuário colou logs sujos ou listas desorganizadas com palavras misturadas.
 */
export function extractValidIndicatorsFromText(rawText: string): string[] {
  const tokens = extractTokensFromRawInput(rawText);
  const validList: string[] = [];
  const seen = new Set<string>();

  for (const item of tokens) {
    const norm = normalizeIndicator(item.token);
    const classification = classifyIndicator(norm);
    if (classification.isValid && !seen.has(norm)) {
      seen.add(norm);
      validList.push(norm);
    }
  }

  return validList;
}

/**
 * Analisa um lote contra a lista ativa do cliente.
 * - append: o lote se soma à lista; algo coberto por um CIDR da lista ou do próprio lote não entra, e itens
 *   da lista que um CIDR novo passa a cobrir aparecem em `superseded` (o servidor os retira ao gravar).
 * - replace: a lista passa a ser o lote; só o próprio lote serve de referência de cobertura.
 */
export function analyzeImportBatch(
  rawInput: string,
  existingActiveSet: Set<string>,
  _existingActiveCidrs: string[] = [],
  mode: 'append' | 'replace' = 'append',
  exceptions: string[] = []
): ImportPreviewSummary {
  const tokens = extractTokensFromRawInput(rawInput);

  const seenInThisBatch = new Set<string>();
  const items: ImportPreviewItem[] = [];
  const existingLower = new Set([...existingActiveSet].map((indicator) => indicator.toLowerCase()));

  for (const { token, original } of tokens) {
    const normalized = normalizeIndicator(token);
    const classification = classifyIndicator(normalized);

    // 1. Sintaxe inválida (palavras, erros etc.)
    if (!classification.isValid) {
      items.push({
        indicator: normalized || token,
        original,
        type: 'Invalid',
        category: 'invalid',
        error: classification.error || 'Formato não reconhecido como IP, CIDR ou Domínio'
      });
      continue;
    }

    // 2. Repetido dentro do próprio arquivo/texto
    if (seenInThisBatch.has(normalized)) {
      items.push({ indicator: normalized, original, type: classification.type, category: 'dup_in_file' });
      continue;
    }
    seenInThisBatch.add(normalized);

    // 3. Nas exceções do cliente (gateway, parceiros...): nunca entra
    const hit = exceptionHit(normalized, exceptions);
    if (hit) {
      items.push({ indicator: normalized, original, type: classification.type, category: 'exception', exceptionHit: hit });
      continue;
    }

    // 4. Já está na lista ativa do cliente
    if (existingLower.has(normalized)) {
      items.push({ indicator: normalized, original, type: classification.type, category: 'already_exists' });
      continue;
    }

    items.push({ indicator: normalized, original, type: classification.type, category: 'new' });
  }

  // 4. Cobertura por CIDR (e repetições equivalentes, como 1.2.3.4 e 1.2.3.4/32).
  //    A lista atual vem primeiro, para que em empate o item já gravado seja o mantido.
  type Ref = { indicator: string; item?: ImportPreviewItem };
  const batchRefs: Ref[] = items
    .filter((item) => item.category === 'new' || (mode === 'replace' && item.category === 'already_exists'))
    .map((item) => ({ indicator: item.indicator, item }));
  const existingRefs: Ref[] = mode === 'append' ? [...existingActiveSet].map((indicator) => ({ indicator })) : [];
  const superseded: ImportPreviewSummary['superseded'] = [];

  for (const match of findRedundant([...existingRefs, ...batchRefs], (ref) => ref.indicator)) {
    if (match.item.item) {
      match.item.item.category = 'covered_by_cidr';
      match.item.item.coveredByCidr = match.coveredBy;
    } else {
      superseded.push({ indicator: match.item.indicator, coveredBy: match.coveredBy });
    }
  }

  // 5. Faixas reservadas/privadas (RFC 1918 etc.) ficam como alerta, fora da gravação por padrão.
  for (const item of items) {
    if (item.category !== 'new') continue;
    const reserved = checkReservedRange(item.indicator);
    if (reserved.isReserved) {
      item.category = 'reserved_warning';
      item.reservedReason = reserved.reason;
    }
  }

  const count = (category: ImportPreviewItem['category']) => items.filter((item) => item.category === category).length;
  return {
    totalLines: items.length,
    newCount: count('new'),
    dupInFileCount: count('dup_in_file'),
    alreadyExistsCount: count('already_exists'),
    coveredByCidrCount: count('covered_by_cidr'),
    invalidCount: count('invalid'),
    reservedWarningCount: count('reserved_warning'),
    exceptionCount: count('exception'),
    items,
    superseded
  };
}

export type OrganizeMode = 'number' | 'range';

/**
 * Reorganiza o texto colado para facilitar a conferência:
 * - "number": IPv4 em ordem numérica, depois CIDRs, IPv6 e domínios;
 * - "range": IPv4 agrupados pela mesma faixa /24, com um cabeçalho por faixa.
 * Repetidos e linhas inválidas viram comentários (#) no topo, que a importação ignora.
 */
export function organizeIndicators(rawText: string, mode: OrganizeMode): { text: string; total: number; duplicates: number; invalid: number } {
  const counts = new Map<string, number>();
  const invalid: string[] = [];
  for (const { token } of extractTokensFromRawInput(rawText)) {
    const norm = normalizeIndicator(token);
    if (!classifyIndicator(norm).isValid) {
      invalid.push(token);
      continue;
    }
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  const unique = [...counts.keys()];
  const rangeOf = (x: string) => toRange(x);
  const ipv4 = unique.filter((x) => !x.includes('/') && rangeOf(x)?.family === 4);
  const cidr4 = unique.filter((x) => x.includes('/') && rangeOf(x)?.family === 4);
  const ipv6 = unique.filter((x) => rangeOf(x)?.family === 6);
  const domains = unique.filter((x) => !rangeOf(x)).sort();
  const byNumber = (a: string, b: string) => {
    const ra = rangeOf(a)!;
    const rb = rangeOf(b)!;
    return ra.start < rb.start ? -1 : ra.start > rb.start ? 1 : ra.end > rb.end ? -1 : ra.end < rb.end ? 1 : 0;
  };
  ipv4.sort(byNumber);
  cidr4.sort(byNumber);
  ipv6.sort(byNumber);

  const lines: string[] = [];
  const repeated = [...counts].filter(([, n]) => n > 1);
  if (repeated.length) {
    lines.push(`# ${repeated.length} repetido(s) removido(s):`);
    for (const [value, n] of repeated) lines.push(`#   ${value} (${n}x)`);
  }
  if (invalid.length) {
    lines.push(`# ${invalid.length} linha(s) inválida(s) ignorada(s): ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? ' …' : ''}`);
  }
  if (lines.length) lines.push('');

  if (mode === 'range') {
    const groups = new Map<string, string[]>();
    for (const ip of ipv4) {
      const key = ip.split('.').slice(0, 3).join('.');
      groups.set(key, [...(groups.get(key) ?? []), ip]);
    }
    for (const [key, ips] of groups) {
      const cover = cidr4.find((net) => { const r = rangeOf(net)!; return ips.every((ip) => { const x = rangeOf(ip)!; return r.start <= x.start && x.end <= r.end; }); });
      const hint = cover ? ` (já dentro de ${cover})` : ips.length >= 8 ? ` (avalie bloquear ${key}.0/24)` : '';
      lines.push(`# ${key}.x — ${ips.length} IP${ips.length > 1 ? 's' : ''}${hint}`);
      lines.push(...ips, '');
    }
  } else if (ipv4.length) {
    lines.push(`# IPv4 (${ipv4.length})`, ...ipv4, '');
  }
  if (cidr4.length) lines.push(`# Redes CIDR (${cidr4.length})`, ...cidr4, '');
  if (ipv6.length) lines.push(`# IPv6 (${ipv6.length})`, ...ipv6, '');
  if (domains.length) lines.push(`# Domínios (${domains.length})`, ...domains, '');

  return {
    text: lines.join('\n').trimEnd(),
    total: unique.length,
    duplicates: repeated.reduce((n, [, c]) => n + c - 1, 0),
    invalid: invalid.length
  };
}
