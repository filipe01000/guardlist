/**
 * Mecanismo de Análise e Pré-visualização da Importação Semanal
 * Processa arquivos de dezenas de milhares de linhas com máxima eficiência via Set e Map.
 * Suporta separação automática de múltiplos IPs por linha, remoção de cabeçalhos NANO
 * (=== IPS ÚNICOS === e === REDES CIDR ===) e higienização inteligente.
 */

import { ImportPreviewItem, ImportPreviewSummary } from '../types';
import { normalizeIndicator, classifyIndicator, checkReservedRange } from './validator';
import { findRedundant } from './redundancy';

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
  mode: 'append' | 'replace' = 'append'
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

    // 3. Já está na lista ativa do cliente
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
    items,
    superseded
  };
}
