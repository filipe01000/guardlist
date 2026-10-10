/**
 * Módulo de Validação e Normalização de Indicadores (IPv4, IPv6, CIDR e Domínios)
 * Isolado e testável, sem dependências externas.
 */

import { IndicatorType } from '../types';

/**
 * Normaliza um indicador bruto:
 * - Remove espaços e quebras
 * - Converte para minúsculas
 * - Remove protocolos (http://, https://) e barras
 * - Remove portas em IPv4 (ex: 192.168.1.1:8080 -> 192.168.1.1)
 * - Remove zeros à esquerda em cada octeto IPv4 (ex: 010.008.001.001 -> 10.8.1.1)
 */
export function normalizeIndicator(raw: string): string {
  if (!raw) return '';
  let clean = raw.trim().toLowerCase();

  // Ignorar ou limpar aspas
  clean = clean.replace(/^['"]+|['"]+$/g, '');

  // Remover protocolos acidentais
  clean = clean.replace(/^(?:https?|ftp|sftp):\/\//i, '');

  // Remover caminhos de URL se houver (exceto se for barra de CIDR como /24)
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length > 2 || !/^\d{1,3}$/.test(parts[1])) {
      clean = parts[0];
    }
  }

  // Se tiver porta em IPv4 (ex: 192.168.0.1:443)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(clean)) {
    clean = clean.split(':')[0];
  }

  // Normalização de zeros à esquerda em IPv4 simples (ex: 010.008.001.001 -> 10.8.1.1)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
    const octets = clean.split('.').map(o => String(parseInt(o, 10)));
    clean = octets.join('.');
  }

  // Normalização de zeros à esquerda em CIDR IPv4 (ex: 010.000.000.000/024 -> 10.0.0.0/24)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(clean)) {
    const [ipPart, maskPart] = clean.split('/');
    const octets = ipPart.split('.').map(o => String(parseInt(o, 10)));
    const mask = parseInt(maskPart, 10);
    clean = `${octets.join('.')}/${mask}`;
  }

  return clean.trim();
}

/**
 * Valida se a string é um IPv4 válido (4 octetos entre 0 e 255)
 */
export function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    if (isNaN(num) || num < 0 || num > 255) return false;
  }
  return true;
}

/**
 * Valida se é um CIDR IPv4 válido (IP válido + /0 até /32)
 */
export function isValidCIDRv4(cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const ip = parts[0];
  const maskStr = parts[1];
  if (!/^\d{1,2}$/.test(maskStr)) return false;
  const mask = Number(maskStr);
  return isValidIPv4(ip) && mask >= 0 && mask <= 32;
}

/**
 * Valida se é um IPv6 válido
 */
export function isValidIPv6(ip: string): boolean {
  if (ip.includes('/')) return false;
  // Regex padrão RFC 4291 para IPv6
  const regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  return regex.test(ip);
}

/**
 * Valida se é um CIDR IPv6 válido (IPv6 + /0 até /128)
 */
export function isValidCIDRv6(cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const ip = parts[0];
  const mask = Number(parts[1]);
  return isValidIPv6(ip) && !isNaN(mask) && mask >= 0 && mask <= 128;
}

/**
 * Valida se é um nome de domínio válido (FQDN segundo RFC 1035 e RFC 1123)
 */
export function isValidDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  // Deve conter ao menos um ponto, não ter espaços nem caracteres proibidos
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
  if (!domainRegex.test(domain)) return false;
  // Não pode ser puramente numérico (como se fosse IP)
  if (/^\d+(\.\d+)*$/.test(domain)) return false;
  return true;
}

/**
 * Classifica um indicador normalizado em um dos tipos suportados
 */
export function classifyIndicator(indicator: string): {
  type: IndicatorType;
  isValid: boolean;
  error?: string;
} {
  if (!indicator) {
    return { type: 'Invalid', isValid: false, error: 'Indicador vazio' };
  }

  if (isValidIPv4(indicator)) {
    return { type: 'IPv4', isValid: true };
  }

  if (isValidCIDRv4(indicator)) {
    return { type: 'CIDR_v4', isValid: true };
  }

  if (isValidIPv6(indicator)) {
    return { type: 'IPv6', isValid: true };
  }

  if (isValidCIDRv6(indicator)) {
    return { type: 'CIDR_v6', isValid: true };
  }

  if (isValidDomain(indicator)) {
    return { type: 'Domain', isValid: true };
  }

  return { type: 'Invalid', isValid: false, error: 'Sintaxe inválida (não é IPv4, IPv6, CIDR ou Domínio)' };
}

/**
 * Converte um IPv4 para representação numérica inteira de 32 bits (unsigned)
 * Útil para ordenação numérica correta e cálculos de sub-rede
 */
export function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

/**
 * Verifica se um endereço IPv4 está contido dentro de um bloco CIDR IPv4
 */
export function isIpv4InCidr(ip: string, cidr: string): boolean {
  if (!isValidIPv4(ip) || !isValidCIDRv4(cidr)) return false;

  const [netIp, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (prefix === 0) return true;

  const ipNum = ipv4ToNumber(ip);
  const netNum = ipv4ToNumber(netIp);

  // Máscara de sub-rede
  const mask = ((0xFFFFFFFF << (32 - prefix)) >>> 0);

  return (ipNum & mask) === (netNum & mask);
}

/**
 * Verifica se um sub-bloco CIDR está totalmente contido dentro de um bloco CIDR maior
 */
export function isCidrInCidr(subCidr: string, parentCidr: string): boolean {
  if (!isValidCIDRv4(subCidr) || !isValidCIDRv4(parentCidr)) return false;

  const [subIp, subPrefixStr] = subCidr.split('/');
  const [, parentPrefixStr] = parentCidr.split('/');
  const subPrefix = Number(subPrefixStr);
  const parentPrefix = Number(parentPrefixStr);

  // O bloco filho precisa ter prefixo maior ou igual (máscara mais restrita)
  if (subPrefix < parentPrefix) return false;

  return isIpv4InCidr(subIp, parentCidr);
}

/**
 * Verifica se um IPv4 ou CIDR pertence a faixas reservadas/privadas
 * (RFC 1918, loopback, link-local, documentação, multicast, etc.)
 * Normalmente não devem ser bloqueados em bordas de firewall público.
 */
export function checkReservedRange(indicator: string): {
  isReserved: boolean;
  reason?: string;
} {
  let ip = indicator;
  if (indicator.includes('/')) {
    ip = indicator.split('/')[0];
  }

  if (isValidIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const p0 = parts[0];
    const p1 = parts[1];

    // 0.0.0.0/8 (Origem nesta rede)
    if (p0 === 0) {
      return { isReserved: true, reason: 'Rede local "0.0.0.0/8" (RFC 1122)' };
    }

    // 127.0.0.0/8 (Loopback)
    if (p0 === 127) {
      return { isReserved: true, reason: 'Loopback 127.0.0.0/8 (RFC 1122)' };
    }

    // 10.0.0.0/8 (RFC 1918 Privado)
    if (p0 === 10) {
      return { isReserved: true, reason: 'IP Privado Classe A 10.0.0.0/8 (RFC 1918)' };
    }

    // 172.16.0.0/12 (RFC 1918 Privado)
    if (p0 === 172 && p1 >= 16 && p1 <= 31) {
      return { isReserved: true, reason: 'IP Privado Classe B 172.16.0.0/12 (RFC 1918)' };
    }

    // 192.168.0.0/16 (RFC 1918 Privado)
    if (p0 === 192 && p1 === 168) {
      return { isReserved: true, reason: 'IP Privado Classe C 192.168.0.0/16 (RFC 1918)' };
    }

    // 169.254.0.0/16 (Link-Local / APIPA)
    if (p0 === 169 && p1 === 254) {
      return { isReserved: true, reason: 'Link-Local APIPA 169.254.0.0/16 (RFC 3927)' };
    }

    // 100.64.0.0/10 (CGNAT de operadoras)
    if (p0 === 100 && p1 >= 64 && p1 <= 127) {
      return { isReserved: true, reason: 'CGNAT Compartilhado 100.64.0.0/10 (RFC 6598)' };
    }

    // Faixas de documentação (RFC 5737)
    if (p0 === 192 && p1 === 0 && parts[2] === 2) {
      return { isReserved: true, reason: 'Faixa de Documentação TEST-NET-1 (RFC 5737)' };
    }
    if (p0 === 198 && p1 === 51 && parts[2] === 100) {
      return { isReserved: true, reason: 'Faixa de Documentação TEST-NET-2 (RFC 5737)' };
    }
    if (p0 === 203 && p1 === 0 && parts[2] === 113) {
      return { isReserved: true, reason: 'Faixa de Documentação TEST-NET-3 (RFC 5737)' };
    }

    // 224.0.0.0/4 (Multicast)
    if (p0 >= 224 && p0 <= 239) {
      return { isReserved: true, reason: 'Multicast 224.0.0.0/4 (RFC 5771)' };
    }

    // 240.0.0.0/4 e Broadcast 255.255.255.255
    if (p0 >= 240) {
      return { isReserved: true, reason: 'Faixa Reservada para testes / Broadcast (RFC 1112)' };
    }
  }

  // IPv6 reservado
  if (isValidIPv6(ip)) {
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') {
      return { isReserved: true, reason: 'IPv6 Loopback (::1)' };
    }
    if (ip.startsWith('fe80:') || ip.startsWith('fe80::')) {
      return { isReserved: true, reason: 'IPv6 Link-Local (fe80::/10)' };
    }
    if (ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
      return { isReserved: true, reason: 'IPv6 Unique Local Address ULA (fc00::/7)' };
    }
  }

  return { isReserved: false };
}

/**
 * Calcula o código da semana ISO atual (ex: 2026-W41)
 */
export function getIsoWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo < 10 ? '0' + weekNo : weekNo}`;
}

/**
 * Calcula a diferença em dias entre uma data passada e hoje
 */
export function getDaysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  try {
    const past = new Date(dateStr);
    const today = new Date();
    // Zerar horas para cálculo exato de dias civis
    past.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - past.getTime();
    return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  } catch {
    return null;
  }
}
