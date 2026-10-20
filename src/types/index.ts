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
  /** Imagem de capa do cliente (data URL PNG/JPEG/WebP, reduzida no navegador). */
  logo?: string;
  targetFirewall?: string; // Ex: 'FortiGate 100F', 'pfSense CE', 'Mikrotik RouterOS', 'Palo Alto PA-440', etc.
  preferredExportFormat?: 'nano' | 'raw_txt' | 'csv';
  lastVariation?: {
    added: number;
    removed: number;
    previousTotal: number;
  };
  // IPs, redes ou domínios que nunca podem ser bloqueados neste cliente (gateway, parceiros, a própria empresa).
  exceptions?: ClientException[];
}

export interface ClientException {
  indicator: string;
  reason?: string;
  addedBy?: string;
  addedAt?: string;
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
  addedBy?: string; // Quem incluiu (preenchido pelo servidor)
  removedAt?: string; // Quando foi marcado como removido (ISO)
  removedBy?: string; // Quem removeu
  lastSeenAt?: string; // Última vez que reapareceu numa importação (ISO)
  reviewedAt?: string; // Última revisão manual (mantido na lista)
  reviewedBy?: string;
}

export interface ClientEntriesPageParams {
  clientId: string;
  status?: IndicatorStatus | 'ALL';
  type?: IndicatorType | 'ALL';
  period?: 'ALL' | '7d' | '30d' | 'year';
  search?: string;
  sort?: 'numeric' | 'date';
  page?: number;
  pageSize?: number;
}

export interface ClientEntriesPage {
  entries: BlocklistEntry[];
  total: number;
  totalClient: number;
  activeCount: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  activeCounts: Record<string, number>;
  totalActiveAcrossAll: number;
  totalCorrelatedIps: number;
  addedThisWeekCount: number;
  recurring: Array<{ indicator: string; count: number }>;
  /** Conta de IPs de cada cliente ativo (sem repetir dentro do próprio cliente). */
  ipTotals: Record<string, ClientIpTotals>;
  /** Soma das contas de todos os clientes: o mesmo IP em dois clientes conta duas vezes. */
  ipTotalsSum: ClientIpTotals;
}

export interface ClientIpTotals {
  /** IPs individuais (sem os CIDRs). */
  ips: number;
  /** Quantidade de CIDRs. */
  cidrs: number;
  /** Endereços IPv4 cobertos contando o tamanho de cada CIDR, sem repetir sobreposição. */
  withCidrs: number;
  /** Faixas IPv6 (não entram no total com CIDRs). */
  ipv6Networks: number;
}

export interface CorrelationPageParams {
  search?: string;
  clientId?: string;
  severity?: 'ALL' | 'critical' | 'high' | 'medium';
  page?: number;
  pageSize?: number;
}

export interface CorrelationPage {
  sharedIndicators: Array<{
    indicator: string;
    type: string;
    clientIds: string[];
    clientNames: string[];
    occurrencesCount: number;
    severity: 'critical' | 'high' | 'medium';
    firewallsImpacted: string[];
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    totalCorrelatedIpsCount: number;
    maxDissemination: number;
    cidrSharedCount: number;
    criticalCount: number;
    activeClientsCount: number;
  };
  clientOverlapTable: Array<{ clientA: string; clientB: string; sharedCount: number }>;
}

export interface ImportPreviewItem {
  indicator: string;
  original: string;
  type: IndicatorType;
  category: 
    | 'new' // Novo, será importado
    | 'dup_in_file' // Duplicado no próprio arquivo/texto importado
    | 'already_exists' // Já existe na lista ativa do cliente
    | 'covered_by_cidr' // Coberto por um CIDR da lista do cliente ou do próprio lote
    | 'invalid' // Formato inválido
    | 'reserved_warning' // IP privado/reservado com alerta
    | 'exception'; // Está nas exceções do cliente: nunca pode ser bloqueado
  exceptionHit?: string;
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
  exceptionCount: number;
  items: ImportPreviewItem[];
  // Itens que já estão na lista e passam a ficar cobertos por um CIDR novo deste lote (retirados ao gravar).
  superseded: Array<{ indicator: string; coveredBy: string }>;
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
  importedBy?: string; // Nome de quem gravou a importação (preenchido pelo servidor)
}

export interface AppSettings {
  slaDays: number; // Dias para considerar atualização atrasada (padrão: 7)
  lastBackupDate: string | null;
  sortNumericallyByDefault: boolean;
  reviewDays?: number; // Dias sem reaparecer nem receber denúncias até ir para a fila de revisão (padrão: 90)
  approvalThreshold?: number; // Importações de analistas acima deste total aguardam um admin (padrão: 500)
  requireApprovalForReplace?: boolean; // "Substituir lista" de analistas aguarda um admin (padrão: sim)
}

// Reputação consolidada de um IP (AbuseIPDB, GreyNoise e OTX), guardada em cache no servidor.
// 'scanner': scanner de pesquisa conhecido (Censys, Shodan…) ou lista branca do AbuseIPDB; não é ataque dirigido.
export type CtiVerdict = 'legit' | 'scanner' | 'low' | 'medium' | 'high' | 'unknown';

export interface CtiSummary {
  indicator: string;
  fetchedAt: string;
  verdict: CtiVerdict;
  verdictReason?: string;
  score: number | null;
  totalReports: number | null;
  lastReportedAt: string | null;
  domain: string | null;
  isp: string | null;
  asn: string | null;
  countryCode: string | null;
  usageType: string | null;
  /** Hostnames do AbuseIPDB (ausente em resumos antigos do cache). */
  hostnames?: string[];
  /** Lista branca do AbuseIPDB (ausente em resumos antigos do cache). */
  isWhitelisted?: boolean | null;
  greyNoise: { classification: string | null; riot: boolean; name: string | null } | null;
  otxPulses: number | null;
  errors?: string[];
}

/** Análise detalhada de um IP (página Análise de IP): o resumo de sempre mais o que só a consulta detalhada traz. */
export interface IpAnalysis {
  summary: CtiSummary;
  configured: { abuseIpDb: boolean; greyNoise: boolean; otx: boolean };
  /** Quando a consulta foi feita; cached = veio da consulta recente guardada no servidor. */
  fetchedAt: string;
  cached?: boolean;
  detail: {
    countryName: string | null;
    isTor: boolean;
    isWhitelisted: boolean | null;
    isPublic: boolean | null;
    hostnames: string[];
    distinctUsers: number | null;
    /** Denúncias mais recentes do AbuseIPDB (até 50). */
    reports: Array<{ reportedAt: string; comment: string; categories: number[]; reporterCountryCode: string | null }>;
    /** Tags e famílias de malware dos pulses do OTX. */
    otxTags: string[];
    malwareFamilies: string[];
  } | null;
}

/** Análise de uma rede CIDR no AbuseIPDB (check-block): só IPv4, até /24 e 30 dias no plano grátis. */
export interface CidrAnalysis {
  network: string;
  configured: boolean;
  fetchedAt: string;
  cached?: boolean;
  /** Mensagem do AbuseIPDB quando a consulta não é permitida (rede maior que /24, cota etc.). */
  error?: string;
  detail: {
    networkAddress: string;
    netmask: string;
    minAddress: string;
    maxAddress: string;
    numPossibleHosts: number;
    addressSpaceDesc: string;
    /** IPs da rede com denúncia nos últimos 30 dias. */
    reported: Array<{ ip: string; numReports: number; mostRecentReport: string; score: number; countryCode: string | null }>;
  } | null;
}

export interface EntryComment {
  id: number;
  entryId: string;
  clientId: string;
  indicator: string;
  username: string;
  displayName: string;
  body: string;
  at: string;
}

export interface PendingImport {
  id: string;
  clientId: string;
  clientName: string;
  mode: 'append' | 'replace';
  itemCount: number;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  sourceTicket?: string;
  notes?: string;
  sample: string[];
}

export interface ImportOutcome {
  status: 'done' | 'pending';
  pendingId?: string;
  added: number;
  retired: number;
  removed: number;
  blockedByException: number;
  snapshotId?: string;
  historyId?: string;
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

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'analyst';
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil?: string | null;
}

// Relatório de um período (geral ou de um cliente), gerado no servidor.
export interface ReportClientRow {
  clientId: string;
  name: string;
  notes: string;
  lastUpdateDate: string | null;
  status: 'em_dia' | 'atrasado' | 'sem_importacao';
  activeNow: number;
  addedInPeriod: number;
  removedInPeriod: number;
  importsInPeriod: number;
  importers: string[];
}

export interface ReportChangeRow {
  action: 'incluido' | 'removido';
  date: string;
  indicator: string;
  type: string;
  ticket: string;
  notes: string;
  by: string;
  currentStatus: 'active' | 'removed';
}

export interface ReportDayRow {
  date: string;
  added: number;
  removed: number;
  imports: number;
  /** Clientes que receberam inclusões no dia. */
  clients: number;
}

export interface ReportData {
  from: string;
  to: string;
  clientId: string | null;
  generatedAt: string;
  generatedBy: string;
  slaDays: number;
  /** Um item por dia do período. */
  daily: ReportDayRow[];
  dailySummary: {
    days: number;
    /** Dias com pelo menos um indicador incluído. */
    activeDays: number;
    avgAddedPerDay: number;
    avgAddedPerActiveDay: number;
    peak: { date: string; added: number } | null;
  };
  totals: { clients: number; added: number; removed: number; imports: number; late: number; activeNow: number };
  clients: ReportClientRow[];
  changes: ReportChangeRow[];
  imports: ImportHistoryRecord[];
  activity: Array<{ name: string; imports: number; added: number; removed: number }>;
}
