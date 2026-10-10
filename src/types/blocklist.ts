export type ClientName =
  | 'CREA'
  | 'SULGIPE'
  | 'DELFINANCE'
  | 'SANTA CASA'
  | 'LABCHECAP'
  | 'EMBASA'
  | 'UNIT'
  | string;

export type IPType = 'IPv4' | 'IPv6' | 'CIDR' | 'Invalido';

export type EntryStatus = 'active' | 'duplicate_local' | 'duplicate_cross' | 'whitelisted' | 'removed';

export interface BlocklistEntry {
  id: string;
  client: ClientName;
  ip: string;
  normalizedIp: string;
  type: IPType;
  reason: string;
  source: string;
  addedDate: string; // YYYY-MM-DD
  weekCode: string; // ex: 2026-W41
  status: EntryStatus;
  isPrivateRange?: boolean;
  notes?: string;
}

export interface ClientAuditStatus {
  client: ClientName;
  weekCode: string;
  reviewed: boolean;
  reviewedAt?: string;
  reviewer?: string;
  notes?: string;
}

export interface DuplicateGroup {
  ip: string;
  normalizedIp: string;
  count: number;
  clients: ClientName[];
  entries: BlocklistEntry[];
  hasSameClientDuplicates: boolean;
  isCrossClient: boolean;
}
