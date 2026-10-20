import { toRange } from './redundancy.ts';

export interface AddressCount {
  /** Endereços IPv4 distintos cobertos (IPs soltos + tamanho de cada CIDR, sem contar sobreposição). */
  ipv4: number;
  /** Faixas IPv6 distintas depois de juntar as sobrepostas: o total de endereços IPv6 não cabe numa conta útil. */
  ipv6Networks: number;
}

// Junta as faixas (ordenadas por início) e soma o tamanho de cada bloco contínuo.
export function countAddresses(indicators: Iterable<string>): AddressCount {
  const v4: Array<[bigint, bigint]> = [];
  const v6: Array<[bigint, bigint]> = [];
  for (const indicator of indicators) {
    const range = toRange(indicator);
    if (range) (range.family === 4 ? v4 : v6).push([range.start, range.end]);
  }
  const merge = (ranges: Array<[bigint, bigint]>) => {
    ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const blocks: Array<[bigint, bigint]> = [];
    for (const [start, end] of ranges) {
      const last = blocks[blocks.length - 1];
      if (last && start <= last[1] + 1n) {
        if (end > last[1]) last[1] = end;
      } else {
        blocks.push([start, end]);
      }
    }
    return blocks;
  };
  const ipv4 = merge(v4).reduce((sum, [start, end]) => sum + (end - start + 1n), 0n);
  return { ipv4: Number(ipv4), ipv6Networks: merge(v6).length };
}
