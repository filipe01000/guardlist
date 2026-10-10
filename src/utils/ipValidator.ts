import { IPType } from '../types/blocklist';

// Clean IP string by removing leading/trailing spaces, quotes, protocols, and ports
export function sanitizeIpInput(input: string): string {
  if (!input) return '';
  let clean = input.trim().replace(/^['"]+|['"]+$/g, '');
  // Remove protocols
  clean = clean.replace(/^(?:https?|ftp|ssh):\/\//i, '');
  // Remove trailing slashes or paths if pasted accidentally
  clean = clean.replace(/\/.*$/g, (match) => {
    // If it's a CIDR slash (e.g. /24 or /32 or /64), preserve it
    if (/^\/\d{1,3}$/.test(match)) {
      return match;
    }
    return '';
  });
  // If it contains a port like 192.168.1.1:8080 (and not IPv6 colons like 2001:db8::1)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(clean)) {
    clean = clean.split(':')[0];
  }
  return clean.trim();
}

// Check IPv4 format and value ranges
export function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    if (num < 0 || num > 255) return false;
    if (part.length > 1 && part.startsWith('0')) return false; // avoid octal confusion
  }
  return true;
}

// Check CIDR format (e.g. 192.168.1.0/24)
export function isValidCIDR(cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const ip = parts[0];
  const mask = Number(parts[1]);
  if (!isValidIPv4(ip)) return false;
  return !isNaN(mask) && mask >= 0 && mask <= 32;
}

// Check IPv6 format
export function isValidIPv6(ip: string): boolean {
  // Simple robust regex for IPv6 including shortened ::
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  // Also check if IPv6 with /prefix
  if (ip.includes('/')) {
    const [addr, prefix] = ip.split('/');
    const pNum = Number(prefix);
    return ipv6Regex.test(addr) && !isNaN(pNum) && pNum >= 0 && pNum <= 128;
  }
  return ipv6Regex.test(ip);
}

// Classify IP type
export function classifyIpType(ip: string): IPType {
  const clean = sanitizeIpInput(ip);
  if (!clean) return 'Invalido';
  if (clean.includes('/') && isValidCIDR(clean)) return 'CIDR';
  if (isValidIPv4(clean)) return 'IPv4';
  if (isValidIPv6(clean)) return 'IPv6';
  return 'Invalido';
}

// Check if IP is private (RFC 1918) or loopback/local
export function isPrivateOrLocalIp(ip: string): boolean {
  const clean = sanitizeIpInput(ip).split('/')[0];
  if (!isValidIPv4(clean)) return false;
  const parts = clean.split('.').map(Number);
  // 127.0.0.0/8
  if (parts[0] === 127) return true;
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (172.16.x.x to 172.31.x.x)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts[0] === 0) return true;
  return false;
}

// Extract all valid IPs or CIDRs from a multi-line raw string or log text
export function extractIpsFromText(rawText: string): string[] {
  if (!rawText) return [];
  
  // Regular expression matching potential IPv4, IPv4 with CIDR, or basic IPv6
  const lines = rawText.split(/[\r\n,;\s]+/);
  const found: string[] = [];
  
  for (const line of lines) {
    const clean = sanitizeIpInput(line);
    if (!clean) continue;
    const type = classifyIpType(clean);
    if (type !== 'Invalido') {
      found.push(clean);
    }
  }
  return found;
}

// Helper to get current ISO week (e.g. 2026-W41)
export function getCurrentWeekCode(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo < 10 ? '0' + weekNo : weekNo}`;
}

export function formatDateBr(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-');
    if (year && month && day) {
      return `${day}/${month}/${year}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}
