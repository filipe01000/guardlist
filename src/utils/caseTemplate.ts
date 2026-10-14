// Texto do caso enviado ao cliente depois de incluir bloqueios.
//
// A lista de indicadores é montada aqui, de forma determinística (validada, sem repetidos e sem IPs
// já cobertos por um CIDR da mesma lista). A IA, quando usada, só escreve o parágrafo de contexto:
// nunca mexe nos endereços. O texto é genérico (não cita o cliente) e exige o ticket.
import type { IndicatorType } from '../types';
import { extractTokensFromRawInput } from './importer';
import { findRedundant, withoutRedundant } from './redundancy';
import { checkReservedRange, classifyIndicator, normalizeIndicator } from './validator';

export interface CaseValidation {
  ips: string[];
  cidrs: string[];
  domains: string[];
  /** Repetidos na colagem (ficou só um). */
  duplicates: string[];
  /** IPs ou redes já contidos num CIDR da mesma lista. */
  covered: Array<{ indicator: string; by: string }>;
  invalid: string[];
  /** Faixas privadas/reservadas: ficam no texto, mas merecem conferência. */
  reserved: Array<{ indicator: string; reason: string }>;
}

const isIp = (t: IndicatorType) => t === 'IPv4' || t === 'IPv6';
const isCidr = (t: IndicatorType) => t === 'CIDR_v4' || t === 'CIDR_v6';

function ipv4Number(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** Ordem numérica para IPv4 (e redes IPv4 pelo endereço de rede); o restante em ordem alfabética. */
function byAddress(a: string, b: string): number {
  const [ipA, maskA] = a.split('/');
  const [ipB, maskB] = b.split('/');
  const v4A = /^\d+\.\d+\.\d+\.\d+$/.test(ipA);
  const v4B = /^\d+\.\d+\.\d+\.\d+$/.test(ipB);
  if (v4A && v4B) return ipv4Number(ipA) - ipv4Number(ipB) || Number(maskA ?? 32) - Number(maskB ?? 32);
  if (v4A !== v4B) return v4A ? -1 : 1;
  return a.localeCompare(b);
}

/** Valida o que foi colado (ou trazido do dia), com as mesmas regras da importação. */
export function validateCaseIndicators(raw: string): CaseValidation {
  const result: CaseValidation = { ips: [], cidrs: [], domains: [], duplicates: [], covered: [], invalid: [], reserved: [] };
  const valid: Array<{ value: string; type: IndicatorType }> = [];
  for (const { token, original } of extractTokensFromRawInput(raw)) {
    const value = normalizeIndicator(token);
    const { type, isValid } = classifyIndicator(value);
    if (!value || !isValid) {
      if (original.trim()) result.invalid.push(original.trim());
      continue;
    }
    valid.push({ value, type });
  }

  for (const match of findRedundant(valid, (v) => v.value)) {
    if (match.reason === 'duplicate') result.duplicates.push(match.item.value);
    else result.covered.push({ indicator: match.item.value, by: match.coveredBy });
  }

  for (const { value, type } of withoutRedundant(valid, (v) => v.value)) {
    if (isIp(type)) result.ips.push(value);
    else if (isCidr(type)) result.cidrs.push(value);
    else result.domains.push(value);
    const reserved = isIp(type) || isCidr(type) ? checkReservedRange(value) : null;
    if (reserved?.isReserved) result.reserved.push({ indicator: value, reason: reserved.reason || 'faixa reservada' });
  }
  result.ips.sort(byAddress);
  result.cidrs.sort(byAddress);
  result.domains.sort();
  result.duplicates = [...new Set(result.duplicates)];
  return result;
}

/** Quantidade de endereços de um bloco IPv4 (IPv6 é grande demais para ser útil no texto). */
export function cidrSize(cidr: string): number | null {
  const [ip, mask] = cidr.split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  const bits = Number(mask);
  return Number.isInteger(bits) && bits >= 0 && bits <= 32 ? 2 ** (32 - bits) : null;
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

export type CaseKind = 'ip' | 'ips' | 'cidr' | 'cidrs' | 'mixed' | 'empty';

export function caseKind(v: Pick<CaseValidation, 'ips' | 'cidrs' | 'domains'>): CaseKind {
  const total = v.ips.length + v.cidrs.length + v.domains.length;
  if (total === 0) return 'empty';
  const kinds = [v.ips.length, v.cidrs.length, v.domains.length].filter(Boolean).length;
  if (kinds > 1) return 'mixed';
  if (v.ips.length) return v.ips.length === 1 ? 'ip' : 'ips';
  if (v.cidrs.length) return v.cidrs.length === 1 ? 'cidr' : 'cidrs';
  return 'mixed'; // só domínios: usa o texto geral, que tem a seção de domínios
}

export const CASE_KIND_LABEL: Record<CaseKind, string> = {
  ip: 'Inclusão única de IP',
  ips: 'Inclusão de IPs em lista',
  cidr: 'Inclusão única de CIDR',
  cidrs: 'Inclusão de vários CIDRs',
  mixed: 'Inclusão de IPs e faixas (misto)',
  empty: 'Nada a incluir'
};

/** "3 endereços IP e 2 faixas de rede" */
export function caseSummary(v: Pick<CaseValidation, 'ips' | 'cidrs' | 'domains'>): string {
  const parts: string[] = [];
  if (v.ips.length) parts.push(v.ips.length === 1 ? '1 endereço IP' : `${v.ips.length} endereços IP`);
  if (v.cidrs.length) parts.push(v.cidrs.length === 1 ? '1 faixa de rede' : `${v.cidrs.length} faixas de rede`);
  if (v.domains.length) parts.push(v.domains.length === 1 ? '1 domínio' : `${v.domains.length} domínios`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0] ?? '';
}

// ---------- Texto do caso (modelo da equipe) ----------

/** Motivos prontos. O primeiro é o texto do modelo da equipe (varredura). */
export type CaseReason = 'scan' | 'bruteforce' | 'reputation' | 'malware' | 'custom';

export const CASE_REASONS: Array<{ id: CaseReason; label: string }> = [
  { id: 'scan', label: 'Varredura automatizada (reconhecimento)' },
  { id: 'bruteforce', label: 'Tentativas de acesso / força bruta' },
  { id: 'reputation', label: 'Reputação maliciosa em bases de inteligência' },
  { id: 'malware', label: 'Comunicação com infraestrutura maliciosa' },
  { id: 'custom', label: 'Texto próprio (ou escrito pela IA)' }
];

/** Palavras que mudam com a quantidade e o tipo do que foi bloqueado. */
function wordsFor(kind: CaseKind) {
  switch (kind) {
    case 'ip':
      return { origin: 'um endereço IP associado', these: 'Essa origem realiza', blocked: 'do endereço identificado', list: 'o seguinte endereço IP foi adicionado' };
    case 'ips':
      return { origin: 'endereços IP associados', these: 'Essas origens realizam', blocked: 'dos endereços identificados', list: 'os seguintes endereços IP foram adicionados' };
    case 'cidr':
      return { origin: 'uma faixa de rede (CIDR) associada', these: 'Essa origem realiza', blocked: 'da faixa identificada', list: 'a seguinte faixa de rede (CIDR) foi adicionada' };
    case 'cidrs':
      return { origin: 'faixas de rede (CIDR) associadas', these: 'Essas origens realizam', blocked: 'das faixas identificadas', list: 'as seguintes faixas de rede (CIDR) foram adicionadas' };
    default:
      return { origin: 'endereços IP e faixas de rede associados', these: 'Essas origens realizam', blocked: 'dos endereços e faixas identificados', list: 'os seguintes endereços IP e faixas de rede foram adicionados' };
  }
}

/** Parágrafos do motivo, já com a concordância do caso. */
export function reasonText(reason: CaseReason, kind: CaseKind): string {
  const w = wordsFor(kind);
  const realizes = w.these;
  switch (reason) {
    case 'scan':
      return [
        `Durante as atividades de monitoramento dos eventos de segurança, foram identificadas conexões originadas de ${w.origin} a serviços automatizados de varredura na Internet.`,
        '',
        `${realizes} atividades de reconhecimento em ativos expostos, buscando identificar portas abertas e serviços acessíveis. Embora esse comportamento, por si só, não caracterize uma tentativa de comprometimento, ele pode representar uma etapa inicial de reconhecimento utilizada antes de possíveis ataques. Como medida preventiva, foi realizado o bloqueio ${w.blocked}.`
      ].join('\n');
    case 'bruteforce':
      return [
        `Durante as atividades de monitoramento dos eventos de segurança, foram identificadas tentativas repetidas de acesso originadas de ${w.origin} a atividades de força bruta contra serviços expostos.`,
        '',
        `${realizes} sucessivas tentativas de autenticação com credenciais diversas, comportamento característico de ataques automatizados de adivinhação de senha. Para reduzir o risco de acesso indevido, foi realizado o bloqueio ${w.blocked}.`
      ].join('\n');
    case 'reputation':
      return [
        `Durante as atividades de monitoramento dos eventos de segurança, foram identificadas conexões originadas de ${w.origin} a atividades maliciosas em bases públicas de inteligência de ameaças.`,
        '',
        `Essas bases registram denúncias recentes de abuso relacionadas ${kind === 'ip' || kind === 'cidr' ? 'a essa origem' : 'a essas origens'}. Considerando o histórico de reputação e a exposição do ambiente, como medida preventiva foi realizado o bloqueio ${w.blocked}.`
      ].join('\n');
    case 'malware':
      return [
        `Durante as atividades de monitoramento dos eventos de segurança, foi identificada comunicação envolvendo ${w.origin} a infraestrutura utilizada por campanhas maliciosas (distribuição de malware ou comando e controle).`,
        '',
        `Para interromper essa comunicação e evitar possíveis impactos ao ambiente, foi realizado o bloqueio ${w.blocked}.`
      ].join('\n');
    default:
      return '';
  }
}

export function greeting(date: Date): string {
  const h = date.getHours();
  return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite';
}

export interface CaseOptions {
  ticket: string;
  date: Date;
  reason: CaseReason;
  /** Texto do motivo quando reason = 'custom' (escrito à mão ou pela IA). */
  customReason?: string;
}

/** Monta o corpo do caso no formato da equipe. Lança erro se faltar ticket ou indicador. */
export function buildCaseText(v: Pick<CaseValidation, 'ips' | 'cidrs' | 'domains'>, options: CaseOptions): { subject: string; body: string; kind: CaseKind } {
  const ticket = options.ticket.trim();
  if (!ticket) throw new Error('Informe o ticket TLD.');
  const kind = caseKind(v);
  if (kind === 'empty') throw new Error('Nenhum indicador válido para o caso.');
  const w = wordsFor(kind);

  const reason = options.reason === 'custom' ? (options.customReason ?? '').trim() : reasonText(options.reason, kind);
  const lines: string[] = [`Prezados, ${greeting(options.date)}!`, ''];
  if (reason) lines.push(reason, '');
  lines.push(`Após a análise dos eventos, ${w.list} à BlockList:`, '');

  if (kind === 'mixed') {
    if (v.ips.length) lines.push('Endereços IP:', ...v.ips, '');
    if (v.cidrs.length) lines.push('Faixas de rede (CIDR):', ...v.cidrs, '');
    if (v.domains.length) lines.push('Domínios:', ...v.domains, '');
  } else {
    lines.push(...v.ips, ...v.cidrs, ...v.domains, '');
  }
  if (kind === 'cidr' || kind === 'cidrs') {
    const total = v.cidrs.reduce((sum, c) => sum + (cidrSize(c) ?? 0), 0);
    if (total) lines.push(`O bloqueio por faixa abrange todos os endereços contidos ${kind === 'cidr' ? 'nela' : 'nelas'} (${fmt(total)} endereços no total).`, '');
  }
  lines.push(`Ticket TLD: ${ticket}`);

  return { subject: `[${ticket}] Inclusão na BlockList – ${caseSummary(v)}`, body: lines.join('\n'), kind };
}
