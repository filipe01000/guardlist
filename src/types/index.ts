/**
 * Tipos e interfaces principais do GuardList
 */

export type IndicatorType = 'IPv4' | 'IPv6' | 'CIDR_v4' | 'CIDR_v6' | 'Domain' | 'Invalid';

export type IndicatorStatus = 'active' | 'removed';

export interface Client {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  lastUpdateDate: string | null; // Data da última importação/atualização (YYYY-MM-DD)
  notes?: string;
  targetFirewall?: string; // Ex: 'FortiGate 100F', 'pfSense CE', 'Mikrotik RouterOS', 'Palo Alto PA-440', etc.
  preferredExportFormat?: 'nano' | 'raw_txt' | 'csv';
  lastVariation?: {
    added: number;
    removed: number;
    previousTotal: number;
  };
}

export interface IpCtiRecord {
  indicator: string;
  type: IndicatorType;
  country: { code: string; name: string; flag: string };
  asn: { number: number; name: string; org: string };
  reverseDns?: string;
  abuseIpDb: {
    score: number; // 0 - 100
    totalReports: number;
    lastReportedAt: string;
    categories: string[];
    verifiedActor?: string;
  };
  greyNoise: {
    classification: 'malicious' | 'benign' | 'unknown';
    actor: string;
    noise: boolean;
    riot: boolean; // Known benign provider (Microsoft, Cloudflare, etc.)
    lastSeen: string;
    tags: string[];
  };
  alienVaultOtx: {
    pulseCount: number;
    tags: string[];
    malwareFamilies: string[];
    lastEvaluated: string;
    confidence: number;
  };
  correlatedClients: Array<{
    clientId: string;
    clientName: string;
    addedDate: string;
    ticket?: string;
    status: IndicatorStatus;
    notes?: string;
  }>;
  timeline: Array<{
    date: string;
    clientName: string;
    event: 'inclusao' | 'alerta_soc' | 'report_cti' | 'remocao';
    description: string;
    source: string;
  }>;
}

export interface ClientOverlapMetric {
  clientA: string;
  clientB: string;
  sharedCount: number;
  percentageA: number;
  percentageB: number;
}

export interface BlocklistEntry {
  id: string;
  clientId: string;
  indicator: string; // Indicador normalizado (ex: 192.168.1.1 ou evil.com)
  originalInput?: string;
  type: IndicatorType;
  addedDate: string; // Data de inclusão (YYYY-MM-DD)
  sourceTicket?: string; // Fonte ou número do ticket/chamado
  status: IndicatorStatus; // 'active' ou 'removed' (histórico preservado)
  notes?: string;
  isReservedAlert?: boolean; // Se for IP privado/reservado (RFC1918, loopback, etc.)
  reservedReason?: string;
  numericValue?: number; // Para ordenação numérica de IPv4
}

export interface ImportPreviewItem {
  indicator: string;
  original: string;
  type: IndicatorType;
  category: 
    | 'new' // Novo, será importado
    | 'dup_in_file' // Duplicado no próprio arquivo/texto importado
    | 'already_exists' // Já existe na lista ativa do cliente
    | 'covered_by_cidr' // Já coberto por um CIDR existente do cliente
    | 'invalid' // Formato inválido
    | 'reserved_warning'; // IP privado/reservado com alerta
  coveredByCidr?: string;
  reservedReason?: string;
  error?: string;
}

export interface ImportPreviewSummary {
  totalLines: number;
  newCount: number;
  dupInFileCount: number;
  alreadyExistsCount: number;
  coveredByCidrCount: number;
  invalidCount: number;
  reservedWarningCount: number;
  items: ImportPreviewItem[];
}

export interface ImportHistoryRecord {
  id: string;
  date: string; // Data ISO
  isoWeek: string; // Ex: 2026-W41
  clientId: string;
  clientName: string;
  sourceTicket?: string;
  totalBefore: number;
  addedCount: number;
  duplicatesDiscarded: number;
  coveredByCidrDiscarded: number;
  invalidsDiscarded: number;
  totalAfter: number;
  notes?: string;
}

export interface AppSettings {
  slaDays: number; // Dias para considerar atualização atrasada (padrão: 7)
  lastBackupDate: string | null;
  sortNumericallyByDefault: boolean;
}

export interface ClientSnapshot {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: string; // Data ISO
  label: string; // Ex: "Antes da Importação 2026-W41"
  entriesCount: number;
  entries: BlocklistEntry[];
}
