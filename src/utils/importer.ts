/**
 * Mecanismo de Análise e Pré-visualização da Importação Semanal
 * Processa arquivos de dezenas de milhares de linhas com máxima eficiência via Set e Map.
 * Suporta separação automática de múltiplos IPs por linha, remoção de cabeçalhos NANO
 * (=== IPS ÚNICOS === e === REDES CIDR ===) e higienização inteligente.
 */

import { ImportPreviewItem, ImportPreviewSummary } from '../types';
import { 
  normalizeIndicator, 
  classifyIndicator, 
  isIpv4InCidr, 
  isCidrInCidr, 
  checkReservedRange 
} from './validator';

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

export function analyzeImportBatch(
  rawInput: string,
  existingActiveSet: Set<string>,
  existingActiveCidrs: string[]
): ImportPreviewSummary {
  const tokens = extractTokensFromRawInput(rawInput);
  
  const seenInThisBatch = new Set<string>();
  const items: ImportPreviewItem[] = [];

  let newCount = 0;
  let dupInFileCount = 0;
  let alreadyExistsCount = 0;
  let coveredByCidrCount = 0;
  let invalidCount = 0;
  let reservedWarningCount = 0;

  for (const { token, original } of tokens) {
    const normalized = normalizeIndicator(token);
    const classification = classifyIndicator(normalized);

    // 1. Sintaxe Inválida (palavras, erros, etc.)
    if (!classification.isValid) {
      invalidCount++;
      items.push({
        indicator: normalized || token,
        original,
        type: 'Invalid',
        category: 'invalid',
        error: classification.error || 'Formato não reconhecido como IP, CIDR ou Domínio'
      });
      continue;
    }

    // 2. Duplicado dentro do próprio arquivo/texto importado
    if (seenInThisBatch.has(normalized)) {
      dupInFileCount++;
      items.push({
        indicator: normalized,
        original,
        type: classification.type,
        category: 'dup_in_file'
      });
      continue;
    }
    seenInThisBatch.add(normalized);

    // 3. Já existente na lista ativa do cliente
    if (existingActiveSet.has(normalized)) {
      alreadyExistsCount++;
      items.push({
        indicator: normalized,
        original,
        type: classification.type,
        category: 'already_exists'
      });
      continue;
    }

    // 4. Já coberto por um CIDR existente do cliente (ex: 10.0.0.5 dentro de 10.0.0.0/24)
    let coveringCidr: string | null = null;
    if (classification.type === 'IPv4') {
      for (const cidr of existingActiveCidrs) {
        if (isIpv4InCidr(normalized, cidr)) {
          coveringCidr = cidr;
          break;
        }
      }
    } else if (classification.type === 'CIDR_v4') {
      for (const cidr of existingActiveCidrs) {
        if (isCidrInCidr(normalized, cidr)) {
          coveringCidr = cidr;
          break;
        }
      }
    }

    if (coveringCidr) {
      coveredByCidrCount++;
      items.push({
        indicator: normalized,
        original,
        type: classification.type,
        category: 'covered_by_cidr',
        coveredByCidr: coveringCidr
      });
      continue;
    }

    // 5. Verificação de Alertas: Faixas Reservadas / Privadas (RFC1918)
    const reserved = checkReservedRange(normalized);
    if (reserved.isReserved) {
      reservedWarningCount++;
      items.push({
        indicator: normalized,
        original,
        type: classification.type,
        category: 'reserved_warning',
        reservedReason: reserved.reason
      });
      continue;
    }

    // 6. Novo válido pronto para inclusão
    newCount++;
    items.push({
      indicator: normalized,
      original,
      type: classification.type,
      category: 'new'
    });
  }

  return {
    totalLines: items.length,
    newCount,
    dupInFileCount,
    alreadyExistsCount,
    coveredByCidrCount,
    invalidCount,
    reservedWarningCount,
    items
  };
}
