import { toRange } from './redundancy.ts';

export interface AddressCount {
  /** Endereços IPv4 distintos cobertos (IPs soltos + tamanho de cada CIDR, sem contar sobreposição). */
  ipv4: number;
  /** Faixas IPv6 distintas depois de juntar as sobrepostas: o total de endereços IPv6 não cabe numa conta útil. */
  ipv6Networks: number;
  /** IPs individuais distintos (sem /prefixo), IPv4 e IPv6: o total "sem os CIDRs". */
  singleIps: number;
  /** Entradas que são CIDR (com /prefixo), IPv4 e IPv6, sem repetir. */
  cidrs: number;
}

// Junta as faixas (ordenadas por início) e soma o tamanho de cada bloco contínuo.
export function countAddresses(indicators: Iterable<string>): AddressCount {
  const v4: Array<[bigint, bigint]> = [];
  const v6: Array<[bigint, bigint]> = [];
  const singles = new Set<string>();
  const cidrs = new Set<string>();
  for (const indicator of indicators) {
    const range = toRange(indicator);
    if (!range) continue;
    (range.family === 4 ? v4 : v6).push([range.start, range.end]);
    const key = `${range.family}:${range.start}:${range.end}`;
    if (indicator.includes('/')) cidrs.add(key);
    else singles.add(key);
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
  return { ipv4: Number(ipv4), ipv6Networks: merge(v6).length, singleIps: singles.size, cidrs: cidrs.size };
}

export interface IpTotals {
  ips: number;
  cidrs: number;
  withCidrs: number;
  ipv6Networks: number;
}

/**
 * Conta de cada cliente (IPs, CIDRs e total com CIDRs, sem repetir dentro do cliente) e a soma de todos
 * (o mesmo IP em dois clientes conta duas vezes, como nos firewalls).
 */
export function ipTotalsByClient(rows: Iterable<{ clientId: string; indicator: string }>): { perClient: Record<string, IpTotals>; sum: IpTotals } {
  const byClient = new Map<string, string[]>();
  for (const row of rows) {
    const list = byClient.get(row.clientId);
    if (list) list.push(row.indicator);
    else byClient.set(row.clientId, [row.indicator]);
  }
  const perClient: Record<string, IpTotals> = {};
  const sum: IpTotals = { ips: 0, cidrs: 0, withCidrs: 0, ipv6Networks: 0 };
  for (const [clientId, list] of byClient) {
    const count = countAddresses(list);
    const totals = { ips: count.singleIps, cidrs: count.cidrs, withCidrs: count.ipv4, ipv6Networks: count.ipv6Networks };
    perClient[clientId] = totals;
    sum.ips += totals.ips;
    sum.cidrs += totals.cidrs;
    sum.withCidrs += totals.withCidrs;
    sum.ipv6Networks += totals.ipv6Networks;
  }
  return { perClient, sum };
}
