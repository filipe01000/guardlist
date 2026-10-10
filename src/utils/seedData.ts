import { BlocklistEntry, ClientAuditStatus } from '../types/blocklist';
import { classifyIpType, getCurrentWeekCode, isPrivateOrLocalIp, sanitizeIpInput } from './ipValidator';

export const INITIAL_CLIENTS: string[] = [
  'CREA',
  'SULGIPE',
  'DELFINANCE',
  'SANTA CASA',
  'LABCHECAP',
  'EMBASA',
  'UNIT'
];

export const INITIAL_REASONS: string[] = [
  'Brute-force SSH / RDP',
  'Scanner Shodan / Masscan',
  'Tentativa de Exploit Web / SQLi',
  'Botnet Mirai / Scanner IoT',
  'DDoS / Amplificação DNS',
  'Tentativa de Acesso Não Autorizado',
  'Phishing / C2 Conhecido',
  'Tentativa de Enumeração SMB',
  'Scraper Malicioso / Abuso de API'
];

export const INITIAL_SOURCES: string[] = [
  'Firewall Fortinet',
  'Firewall Mikrotik',
  'PFSense Suricata',
  'WAF Cloudflare',
  'Alerta SOC / SIEM',
  'AbuseIPDB Feed',
  'Análise Manual de Logs'
];

const currentWeek = getCurrentWeekCode();

interface RawSeedEntry {
  client: string;
  ip: string;
  reason: string;
  source: string;
  addedDate: string;
  notes?: string;
}

const rawSeedList: RawSeedEntry[] = [
  // CREA
  {
    client: 'CREA',
    ip: '185.220.101.5',
    reason: 'Scanner Shodan / Masscan',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-02',
    notes: 'IP de nó Tor tentando varredura de portas'
  },
  {
    client: 'CREA',
    ip: '45.148.10.12',
    reason: 'Brute-force SSH / RDP',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-04',
    notes: 'Mais de 400 tentativas em 5 minutos'
  },
  {
    client: 'CREA',
    ip: '185.220.101.5', // Duplicata interna proposital no CREA
    reason: 'Scanner Shodan / Masscan',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-08',
    notes: 'Reincidência registrada pelo turno noturno'
  },
  {
    client: 'CREA',
    ip: '194.26.29.112', // Duplicata cruzada com EMBASA
    reason: 'Botnet Mirai / Scanner IoT',
    source: 'AbuseIPDB Feed',
    addedDate: '2026-10-05'
  },
  {
    client: 'CREA',
    ip: '89.248.165.74',
    reason: 'Tentativa de Exploit Web / SQLi',
    source: 'WAF Cloudflare',
    addedDate: '2026-10-07'
  },

  // SULGIPE
  {
    client: 'SULGIPE',
    ip: '91.240.118.15',
    reason: 'Tentativa de Enumeração SMB',
    source: 'Firewall Mikrotik',
    addedDate: '2026-09-28'
  },
  {
    client: 'SULGIPE',
    ip: '193.106.191.66',
    reason: 'Brute-force SSH / RDP',
    source: 'Análise Manual de Logs',
    addedDate: '2026-10-03'
  },
  {
    client: 'SULGIPE',
    ip: '185.196.220.34',
    reason: 'Scanner Shodan / Masscan',
    source: 'Firewall Mikrotik',
    addedDate: '2026-10-06'
  },
  {
    client: 'SULGIPE',
    ip: '193.106.191.66', // Duplicata interna no SULGIPE
    reason: 'Brute-force SSH / RDP',
    source: 'Firewall Mikrotik',
    addedDate: '2026-10-09'
  },

  // DELFINANCE
  {
    client: 'DELFINANCE',
    ip: '185.191.171.10', // Duplicata cruzada com UNIT
    reason: 'Phishing / C2 Conhecido',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-01'
  },
  {
    client: 'DELFINANCE',
    ip: '195.54.160.21',
    reason: 'Tentativa de Exploit Web / SQLi',
    source: 'WAF Cloudflare',
    addedDate: '2026-10-05'
  },
  {
    client: 'DELFINANCE',
    ip: '77.247.110.155',
    reason: 'DDoS / Amplificação DNS',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-07'
  },
  {
    client: 'DELFINANCE',
    ip: '45.143.203.2/24', // Bloco CIDR
    reason: 'Scanner Shodan / Masscan',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-06',
    notes: 'Sub-rede maliciosa inteira bloqueada'
  },

  // SANTA CASA
  {
    client: 'SANTA CASA',
    ip: '45.154.255.89',
    reason: 'Brute-force SSH / RDP',
    source: 'PFSense Suricata',
    addedDate: '2026-10-02'
  },
  {
    client: 'SANTA CASA',
    ip: '194.38.20.7',
    reason: 'Tentativa de Exploit Web / SQLi',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-04'
  },
  {
    client: 'SANTA CASA',
    ip: '45.154.255.89', // Duplicata interna SANTA CASA
    reason: 'Brute-force SSH / RDP',
    source: 'Firewall Mikrotik',
    addedDate: '2026-10-08'
  },
  {
    client: 'SANTA CASA',
    ip: '178.62.204.11',
    reason: 'Scraper Malicioso / Abuso de API',
    source: 'WAF Cloudflare',
    addedDate: '2026-10-06'
  },

  // LABCHECAP
  {
    client: 'LABCHECAP',
    ip: '194.26.29.112', // Duplicata cruzada também no LABCHECAP
    reason: 'Botnet Mirai / Scanner IoT',
    source: 'PFSense Suricata',
    addedDate: '2026-10-03'
  },
  {
    client: 'LABCHECAP',
    ip: '80.82.77.139',
    reason: 'Scanner Shodan / Masscan',
    source: 'Análise Manual de Logs',
    addedDate: '2026-10-05'
  },
  {
    client: 'LABCHECAP',
    ip: '109.237.103.124',
    reason: 'Tentativa de Acesso Não Autorizado',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-07'
  },

  // EMBASA
  {
    client: 'EMBASA',
    ip: '194.26.29.112', // Duplicata cruzada com CREA e LABCHECAP
    reason: 'Botnet Mirai / Scanner IoT',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-02'
  },
  {
    client: 'EMBASA',
    ip: '185.156.73.54',
    reason: 'DDoS / Amplificação DNS',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-04'
  },
  {
    client: 'EMBASA',
    ip: '193.142.146.35',
    reason: 'Tentativa de Exploit Web / SQLi',
    source: 'WAF Cloudflare',
    addedDate: '2026-10-06'
  },
  {
    client: 'EMBASA',
    ip: '185.156.73.54', // Duplicata interna na EMBASA
    reason: 'DDoS / Amplificação DNS',
    source: 'Firewall Fortinet',
    addedDate: '2026-10-09'
  },

  // UNIT
  {
    client: 'UNIT',
    ip: '185.191.171.10', // Duplicata cruzada com DELFINANCE
    reason: 'Phishing / C2 Conhecido',
    source: 'Firewall Mikrotik',
    addedDate: '2026-10-03'
  },
  {
    client: 'UNIT',
    ip: '162.247.74.200',
    reason: 'Brute-force SSH / RDP',
    source: 'PFSense Suricata',
    addedDate: '2026-10-05'
  },
  {
    client: 'UNIT',
    ip: '198.98.56.142',
    reason: 'Tentativa de Enumeração SMB',
    source: 'Alerta SOC / SIEM',
    addedDate: '2026-10-07'
  }
];

export function createInitialSeedEntries(): BlocklistEntry[] {
  return rawSeedList.map((item, index) => {
    const cleanIp = sanitizeIpInput(item.ip);
    const ipType = classifyIpType(cleanIp);
    const isPriv = isPrivateOrLocalIp(cleanIp);
    return {
      id: `entry-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
      client: item.client,
      ip: item.ip,
      normalizedIp: cleanIp.toLowerCase(),
      type: ipType,
      reason: item.reason,
      source: item.source,
      addedDate: item.addedDate,
      weekCode: currentWeek,
      status: 'active',
      isPrivateRange: isPriv,
      notes: item.notes || ''
    };
  });
}

export function createInitialAuditStatuses(): ClientAuditStatus[] {
  const currentW = getCurrentWeekCode();
  return INITIAL_CLIENTS.map((client, idx) => ({
    client,
    weekCode: currentW,
    // Provide realistic varied initial checklist states
    reviewed: idx < 2, // CREA and SULGIPE checked, others pending
    reviewedAt: idx < 2 ? '2026-10-09' : undefined,
    reviewer: idx < 2 ? 'Equipe de Redes' : undefined,
    notes: idx === 0 ? 'Removida 1 duplicata e validada lista no Fortinet' : ''
  }));
}
