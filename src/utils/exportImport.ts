import { BlocklistEntry } from '../types/blocklist';

/**
 * Triggers browser download for any text or blob content
 */
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates Excel-friendly CSV with UTF-8 BOM
 */
export function exportToCSV(entries: BlocklistEntry[], delimiter: string = ';'): string {
  // UTF-8 BOM for Microsoft Excel compatibility
  const BOM = '\uFEFF';
  const headers = [
    'Cliente',
    'IP/CIDR',
    'Tipo',
    'Motivo do Bloqueio',
    'Origem/Fonte',
    'Data de Inclusao',
    'Semana de Controle',
    'Status',
    'Observacoes'
  ];

  const escapeCSV = (val: string | undefined | null) => {
    if (val === undefined || val === null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = entries.map(entry => [
    escapeCSV(entry.client),
    escapeCSV(entry.ip),
    escapeCSV(entry.type),
    escapeCSV(entry.reason),
    escapeCSV(entry.source),
    escapeCSV(entry.addedDate),
    escapeCSV(entry.weekCode),
    escapeCSV(entry.status === 'active' ? 'Ativo' : entry.status),
    escapeCSV(entry.notes)
  ].join(delimiter));

  return BOM + [headers.map(escapeCSV).join(delimiter), ...rows].join('\r\n');
}

/**
 * Generates raw plain text IP list (one per line)
 */
export function exportToPlainIPList(entries: BlocklistEntry[], uniqueOnly: boolean = true): string {
  let ips = entries.map(e => e.ip);
  if (uniqueOnly) {
    ips = Array.from(new Set(ips));
  }
  return ips.join('\n');
}

/**
 * Generates Mikrotik RouterOS address-list CLI script
 */
export function exportToMikrotik(entries: BlocklistEntry[], listNamePrefix: string = 'BLOCKLIST'): string {
  const lines: string[] = ['# Mikrotik RouterOS Address-List Script', `# Gerado em: ${new Date().toLocaleString('pt-BR')}`, ''];
  
  for (const entry of entries) {
    const listName = `${listNamePrefix}_${entry.client.replace(/\s+/g, '_')}`;
    const comment = `${entry.reason || 'Blocklist Semanal'} - ${entry.addedDate}`;
    lines.push(`/ip firewall address-list add list="${listName}" address="${entry.ip}" comment="${comment}"`);
  }
  return lines.join('\r\n');
}

/**
 * Generates Fortinet FortiGate CLI configuration script
 */
export function exportToFortinet(entries: BlocklistEntry[]): string {
  const lines: string[] = [
    '# FortiOS CLI Address Objects',
    `# Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    'config firewall address'
  ];

  for (const entry of entries) {
    const addrName = `BLK_${entry.client.replace(/\s+/g, '_')}_${entry.ip.replace(/[/.:]/g, '_')}`;
    lines.push(`  edit "${addrName}"`);
    if (entry.ip.includes('/')) {
      // CIDR
      lines.push(`    set subnet ${entry.ip}`);
    } else {
      lines.push(`    set subnet ${entry.ip}/32`);
    }
    lines.push(`    set comment "${entry.client} - ${entry.reason || 'Blocklist'}"`);
    lines.push('  next');
  }
  lines.push('end');
  return lines.join('\r\n');
}

/**
 * Generates Linux iptables rules
 */
export function exportToIptables(entries: BlocklistEntry[]): string {
  const lines: string[] = [
    '#!/bin/bash',
    `# Regras Iptables Drop - Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    ''
  ];
  for (const entry of entries) {
    lines.push(`iptables -A INPUT -s ${entry.ip} -m comment --comment "${entry.client}: ${entry.reason || 'Blocklist'}" -j DROP`);
  }
  return lines.join('\n');
}

/**
 * Parses CSV text to extract Blocklist entries
 */
export function parseCSV(csvText: string, defaultClient: string = 'CREA', currentWeek: string): Partial<BlocklistEntry>[] {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const results: Partial<BlocklistEntry>[] = [];

  const stripQuotes = (val: string) => val ? val.trim().replace(/^["']|["']$/g, '').trim() : '';

  // Determine if first row is header
  const firstCols = lines[0].split(delimiter).map(stripQuotes);
  const isHeader = firstCols.some(c => /cliente|ip|cidr|motivo|data|source/i.test(c));
  const startIndex = isHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(delimiter).map(stripQuotes);
    if (cols.length === 0) continue;

    // Check where IP is:
    // If column 0 looks like an IP, client might be default
    let client = defaultClient;
    let ip = '';
    let reason = 'Importado via CSV';
    let source = 'Arquivo CSV';
    let addedDate = new Date().toISOString().split('T')[0];
    let notes = '';

    if (cols.length === 1) {
      ip = cols[0];
    } else if (cols.length >= 2) {
      // Check if cols[0] is client name or IP
      if (cols[0].match(/\d+\.\d+\.\d+\.\d+/)) {
        ip = cols[0];
        client = cols[1] || defaultClient;
      } else {
        client = cols[0] || defaultClient;
        ip = cols[1];
        if (cols[2]) reason = cols[2];
        if (cols[3]) source = cols[3];
        if (cols[4] && /^\d{4}-\d{2}-\d{2}/.test(cols[4])) addedDate = cols[4];
        if (cols[5]) notes = cols[5];
      }
    }

    if (ip) {
      results.push({
        client,
        ip,
        reason,
        source,
        addedDate,
        weekCode: currentWeek,
        notes
      });
    }
  }

  return results;
}
