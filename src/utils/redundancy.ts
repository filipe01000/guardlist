// Redundâncias numa lista de bloqueio: o mesmo indicador repetido, ou um IP/rede já contido em um CIDR maior.
// Usado na importação, na exportação para o firewall e no servidor (que retira os redundantes da lista ativa).
// Sem dependências, para rodar igual no navegador e no Node.

export interface RedundantMatch<T> {
  item: T;
  coveredBy: string;
  reason: 'duplicate' | 'cidr';
}

interface Range {
  family: 4 | 6;
  start: bigint;
  end: bigint;
}

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(ip: string): bigint | null {
  if (!ip.includes(':') || ip.includes('%')) return null;
  let text = ip;
  // IPv4 embutido no final (ex.: ::ffff:1.2.3.4)
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

// Converte IP ou CIDR em faixa [início, fim]. Domínios e textos inválidos retornam null.
export function toRange(indicator: string): Range | null {
  const [address, prefixText, extra] = indicator.trim().toLowerCase().split('/');
  if (extra !== undefined) return null;
  const v4 = parseIpv4(address);
  const family: 4 | 6 = v4 !== null ? 4 : 6;
  const value = v4 ?? parseIpv6(address);
  if (value === null) return null;
  const bits = family === 4 ? 32 : 128;
  let prefix = bits;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > bits) return null;
  }
  const hostBits = BigInt(bits - prefix);
  const start = (value >> hostBits) << hostBits;
  return { family, start, end: start + (1n << hostBits) - 1n };
}

/**
 * Encontra os itens redundantes de uma lista. Fica o item mais abrangente; entre repetidos idênticos,
 * fica o que vem primeiro na ordem recebida (passe a lista ordenada por data para manter o mais antigo).
 */
export function findRedundant<T>(items: T[], indicatorOf: (item: T) => string): RedundantMatch<T>[] {
  const ranged: Array<{ item: T; indicator: string; range: Range; order: number }> = [];
  const others = new Map<string, T>();
  const redundant: RedundantMatch<T>[] = [];

  items.forEach((item, order) => {
    const indicator = indicatorOf(item).trim();
    const range = toRange(indicator);
    if (range) {
      ranged.push({ item, indicator, range, order });
      return;
    }
    // Domínios e demais: só repetição exata
    const key = indicator.toLowerCase();
    const kept = others.get(key);
    if (kept !== undefined) redundant.push({ item, coveredBy: indicatorOf(kept), reason: 'duplicate' });
    else others.set(key, item);
  });

  // Ordena por família, início crescente e tamanho decrescente: quem cobre vem antes de quem é coberto.
  ranged.sort((a, b) =>
    a.range.family - b.range.family ||
    (a.range.start < b.range.start ? -1 : a.range.start > b.range.start ? 1 : 0) ||
    (a.range.end > b.range.end ? -1 : a.range.end < b.range.end ? 1 : 0) ||
    a.order - b.order
  );

  let cover: (typeof ranged)[number] | null = null;
  for (const current of ranged) {
    if (cover && cover.range.family === current.range.family && current.range.end <= cover.range.end) {
      const same = cover.range.start === current.range.start && cover.range.end === current.range.end;
      redundant.push({ item: current.item, coveredBy: cover.indicator, reason: same ? 'duplicate' : 'cidr' });
      continue;
    }
    cover = current;
  }
  return redundant;
}

// Um item conflita com uma exceção quando bloquearia algum endereço dela: mesma faixa, faixa dentro da outra
// ou sobreposição. Para domínios, o próprio domínio ou um subdomínio dele.
export function exceptionHit(indicator: string, exceptions: string[]): string | null {
  const range = toRange(indicator);
  const lower = indicator.trim().toLowerCase();
  for (const exception of exceptions) {
    const exc = exception.trim().toLowerCase();
    if (!exc) continue;
    const excRange = toRange(exc);
    if (range && excRange) {
      if (range.family === excRange.family && range.start <= excRange.end && excRange.start <= range.end) return exception;
    } else if (!range && !excRange) {
      if (lower === exc || lower.endsWith(`.${exc}`)) return exception;
    }
  }
  return null;
}

export function findExceptionConflicts<T>(
  items: T[],
  indicatorOf: (item: T) => string,
  exceptions: string[]
): Array<{ item: T; exception: string }> {
  if (exceptions.length === 0) return [];
  const conflicts: Array<{ item: T; exception: string }> = [];
  for (const item of items) {
    const exception = exceptionHit(indicatorOf(item), exceptions);
    if (exception) conflicts.push({ item, exception });
  }
  return conflicts;
}

// Lista sem os redundantes, preservando a ordem original.
export function withoutRedundant<T>(items: T[], indicatorOf: (item: T) => string): T[] {
  // Compara por posição, para funcionar também com valores iguais (ex.: a mesma string duas vezes).
  const indexed = items.map((item, index) => ({ item, index }));
  const drop = new Set(findRedundant(indexed, (entry) => indicatorOf(entry.item)).map((match) => match.item.index));
  return items.filter((_, index) => !drop.has(index));
}
