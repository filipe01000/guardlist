import type { Database } from './db.ts';
import type { BlocklistEntry, Client } from '../src/types/index.ts';
import { checkReservedRange, classifyIndicator, ipv4ToNumber } from '../src/utils/validator.ts';

// Dados de demonstração para o banco local (PGlite). Nunca roda com DATABASE_URL configurado.

const PROFILES: Array<{ name: string; firewall: string; format: 'nano' | 'raw_txt'; daysAgo: number; ips: string[] }> = [
  { name: 'SULGIPE', firewall: 'FortiGate 100F', format: 'nano', daysAgo: 3, ips: ['185.196.220.34', '193.106.191.66', '91.240.118.15', '185.220.101.5', '194.26.29.112', '45.143.203.0/24', '185.220.100.0/22', '103.152.220.0/24', '205.210.31.171', '205.210.31.176'] },
  { name: 'CREA', firewall: 'pfSense 2.7', format: 'raw_txt', daysAgo: 5, ips: ['185.220.101.5', '45.148.10.12', '89.248.165.74', '194.26.29.112', '185.191.171.10', '77.247.110.155', '45.154.255.89', '195.154.0.0/16', '185.196.220.0/24', 'c2-beacon-scan.net'] },
  { name: 'UNIT', firewall: 'Mikrotik RouterOS v7', format: 'nano', daysAgo: 9, ips: ['185.191.171.10', '162.247.74.200', '198.98.56.142', '45.154.255.89', '185.220.101.5', '194.26.29.112', '91.240.118.15', '45.143.203.0/24', '193.106.191.0/24'] },
  { name: 'SANTA CASA', firewall: 'Palo Alto PA-440', format: 'nano', daysAgo: 2, ips: ['45.154.255.89', '194.38.20.7', '178.62.204.11', '195.54.160.21', '185.220.101.5', '77.247.110.155', '194.26.29.112', '185.156.73.54', '45.143.203.0/24', '194.38.20.0/23', 'ransomware-drop.cc'] },
  { name: 'LABCHECAP', firewall: 'FortiGate 60F', format: 'raw_txt', daysAgo: 4, ips: ['80.82.77.139', '109.237.103.124', '194.26.29.112', '185.156.73.54', '185.220.101.5', '185.191.171.10', '91.240.118.15', '109.237.100.0/22', '80.82.76.0/23'] },
  { name: 'EMBASA', firewall: 'Cisco Firepower 2100', format: 'nano', daysAgo: 3, ips: ['185.156.73.54', '193.142.146.35', '194.26.29.112', '77.247.110.155', '185.220.101.5', '45.154.255.89', '185.191.171.10', '193.106.191.66', '45.143.203.0/24', '193.142.144.0/22', '2001:db8:85a3::8a2e:370:7334'] },
  { name: 'DELFINANCE', firewall: 'OPNsense 24.1', format: 'nano', daysAgo: 12, ips: ['195.54.160.21', '77.247.110.155', '185.191.171.10', '185.220.101.5', '45.143.203.0/24'] }
];

export async function seedDemoData(db: Database): Promise<void> {
  const now = new Date();
  await db.tx(async (q) => {
    for (const profile of PROFILES) {
      const lastUpdate = new Date(now.getTime() - profile.daysAgo * 86_400_000).toISOString().split('T')[0];
      const client: Client = {
        id: `client-${profile.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: profile.name,
        isArchived: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastUpdateDate: lastUpdate,
        targetFirewall: profile.firewall,
        preferredExportFormat: profile.format,
        notes: `Firewall ${profile.firewall} • Formato: ${profile.format.toUpperCase()}`
      };
      await q('INSERT INTO clients (id, data, updated_by) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO NOTHING', [
        client.id,
        JSON.stringify(client),
        'demo'
      ]);

      const entries: BlocklistEntry[] = profile.ips.map((ip, i) => {
        const classification = classifyIndicator(ip);
        const reserved = checkReservedRange(ip);
        return {
          id: `entry-${client.id}-${i}`,
          clientId: client.id,
          indicator: ip,
          type: classification.type,
          addedDate: lastUpdate,
          sourceTicket: `SEC-${1000 + i}`,
          status: 'active',
          notes: 'Bloqueio adicionado na rotina semanal.',
          isReservedAlert: reserved.isReserved,
          reservedReason: reserved.reason,
          numericValue: classification.type === 'IPv4' ? ipv4ToNumber(ip) : undefined
        };
      });
      await q(
        `INSERT INTO entries (id, client_id, indicator, status, data, updated_by)
         SELECT e->>'id', e->>'clientId', e->>'indicator', e->>'status', e, 'demo'
         FROM jsonb_array_elements($1::jsonb) AS e ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(entries)]
      );
    }
    await q(
      `INSERT INTO settings (key, data) VALUES ('app_settings', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify({ slaDays: 7, lastBackupDate: new Date(now.getTime() - 2 * 86_400_000).toISOString(), sortNumericallyByDefault: true })]
    );
  });
}
