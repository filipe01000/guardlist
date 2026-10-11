/**
 * Módulo de Exportação de Blocklists Prontas para Firewall
 * Suporta .txt limpo (1 item por linha) e .csv completo, com ordenação numérica de IPs.
 */

import { BlocklistEntry } from '../types';
import { ipv4ToNumber, isValidIPv4 } from './validator';
import { neutralize } from './csv';
import { withoutRedundant } from './redundancy';

export function sortEntriesNumerically(entries: BlocklistEntry[]): BlocklistEntry[] {
  return [...entries].sort((a, b) => {
    const isIpv4A = a.type === 'IPv4' && isValidIPv4(a.indicator);
    const isIpv4B = b.type === 'IPv4' && isValidIPv4(b.indicator);

    if (isIpv4A && isIpv4B) {
      const numA = a.numericValue ?? ipv4ToNumber(a.indicator);
      const numB = b.numericValue ?? ipv4ToNumber(b.indicator);
      return numA - numB;
    }

    if (isIpv4A && !isIpv4B) return -1;
    if (!isIpv4A && isIpv4B) return 1;

    return a.indicator.localeCompare(b.indicator);
  });
}

// Lista que vai para o firewall: só ativos, sem repetidos e sem IPs ou redes já contidos em um CIDR da lista.
export function firewallEntries(entries: BlocklistEntry[]): BlocklistEntry[] {
  return withoutRedundant(entries.filter(e => e.status === 'active'), e => e.indicator);
}

export function generateFirewallTxt(entries: BlocklistEntry[], sortNumeric: boolean = true): string {
  const clean = firewallEntries(entries);
  const list = sortNumeric ? sortEntriesNumerically(clean) : clean;
  return list.map(e => e.indicator).join('\r\n');
}

/**
 * Gera arquivo .txt no formato estruturado para edição direta via NANO no Linux:
 * === IPS ÚNICOS ===
 * 1.2.3.4
 * 5.6.7.8
 * 
 * === REDES CIDR ===
 * 10.0.0.0/24
 */
export function generateNanoFormattedTxt(entries: BlocklistEntry[], sortNumeric: boolean = true): string {
  const activeEntries = firewallEntries(entries);
  const sorted = sortNumeric ? sortEntriesNumerically(activeEntries) : activeEntries;

  const uniqueIps: string[] = [];
  const cidrNetworks: string[] = [];
  const domains: string[] = [];

  const seenIps = new Set<string>();
  const seenCidrs = new Set<string>();
  const seenDomains = new Set<string>();

  for (const entry of sorted) {
    const ind = entry.indicator.trim();
    if (!ind) continue;

    if (entry.type === 'CIDR_v4' || entry.type === 'CIDR_v6' || ind.includes('/')) {
      if (!seenCidrs.has(ind)) {
        seenCidrs.add(ind);
        cidrNetworks.push(ind);
      }
    } else if (entry.type === 'Domain') {
      if (!seenDomains.has(ind)) {
        seenDomains.add(ind);
        domains.push(ind);
      }
    } else {
      if (!seenIps.has(ind)) {
        seenIps.add(ind);
        uniqueIps.push(ind);
      }
    }
  }

  // Se existirem domínios, adiciona-os com os IPs únicos
  const allSingleItems = domains.length > 0 ? [...uniqueIps, ...domains] : uniqueIps;

  const lines: string[] = [
    '=== IPS ÚNICOS ===',
    ...(allSingleItems.length > 0 ? allSingleItems : ['']),
    '',
    '',
    '=== REDES CIDR ===',
    ...(cidrNetworks.length > 0 ? cidrNetworks : ['']),
    ''
  ];

  return lines.join('\r\n');
}

export function generateFullCSV(entries: BlocklistEntry[], sortNumeric: boolean = true, delimiter: string = ';'): string {
  const list = sortNumeric ? sortEntriesNumerically(entries) : entries;
  const BOM = '\uFEFF';
  const headers = ['Indicador', 'Tipo', 'Data Inclusao', 'Fonte Ticket', 'Status', 'Observacao'];

  const escapeCSV = (val: string | undefined | null) => {
    if (!val) return '""';
    return `"${neutralize(String(val)).replace(/"/g, '""')}"`;
  };

  const rows = list.map(e => [
    escapeCSV(e.indicator),
    escapeCSV(e.type),
    escapeCSV(e.addedDate),
    escapeCSV(e.sourceTicket),
    escapeCSV(e.status === 'active' ? 'Ativo' : 'Removido'),
    escapeCSV(e.notes)
  ].join(delimiter));

  return BOM + [headers.map(escapeCSV).join(delimiter), ...rows].join('\r\n');
}

export function triggerDownload(filename: string, content: string, mimeType: string = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  triggerBlobDownload(filename, blob);
}

export function triggerBlobDownload(filename: string, blob: Blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {}
    }, 1500);
  } catch (err) {
    console.error('Blob download fallback trigger:', err);
    // Fallback: FileReader data URL
    const reader = new FileReader();
    reader.onload = () => {
      const a = document.createElement('a');
      a.href = reader.result as string;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    reader.readAsDataURL(blob);
  }
}


