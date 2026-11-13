import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * IP do cliente, usado em limites de taxa, bloqueios e auditoria.
 *
 * Cabeçalhos como X-Forwarded-For e CF-Connecting-IP podem ser escritos por qualquer cliente.
 * Antes eles valiam sempre, então um atacante escolhia o próprio IP: escapava dos limites e podia
 * fazer outro IP ser bloqueado. Agora só valem quando quem os escreveu é um proxy confiável.
 *
 * - CLIENT_IP_HEADER: cabeçalho posto pela borda, por exemplo `cf-connecting-ip`. No Render ele já
 *   vem ligado em `cf-connecting-ip`, porque todo pedido passa pela Cloudflare, que reescreve esse
 *   cabeçalho. Use `none` para desligar.
 * - TRUST_PROXY: quantos proxies na frente do servidor acrescentam ao X-Forwarded-For.
 *   `loopback` (padrão) aceita só proxy na própria máquina; um número N aceita N saltos;
 *   `none` usa apenas o endereço da conexão.
 */

type TrustRule =
  | { kind: 'none' }
  | { kind: 'loopback' }
  | { kind: 'hops'; hops: number };

const MAX_TRUSTED_HOPS = 5;

export function parseTrustProxyRule(raw: string | undefined): TrustRule {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'none' || value === 'false' || value === '0') {
    return { kind: 'none' };
  }
  if (/^\d+$/.test(value)) {
    return { kind: 'hops', hops: Math.min(Number(value), MAX_TRUSTED_HOPS) };
  }
  // Vazio, `loopback` ou valor desconhecido: o padrão mais restrito.
  return { kind: 'loopback' };
}

export function resolveClientIpHeaderName(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const configured = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configured === 'none') return null;
  if (configured) return configured;
  return env.RENDER === 'true' ? 'cf-connecting-ip' : null;
}

function normalizeIp(raw: string | undefined): string {
  let value = String(raw ?? '').trim();
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    value = value.slice(7);
  }
  return isIP(value) ? value : '';
}

function isLoopback(ip: string): boolean {
  return ip === '::1' || ip.startsWith('127.');
}

function firstHeaderValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

let missingEdgeHeaderWarned = false;

export function extractClientIp(req: Request): string {
  const headerName = resolveClientIpHeaderName();
  if (headerName) {
    const fromEdge = normalizeIp(firstHeaderValue(req.headers[headerName]));
    if (fromEdge) return fromEdge;
    if (!missingEdgeHeaderWarned) {
      missingEdgeHeaderWarned = true;
      console.warn(
        `[client-ip] Pedido sem ${headerName} válido; usando o endereço da conexão. Confira CLIENT_IP_HEADER e TRUST_PROXY.`
      );
    }
  }

  const peer = normalizeIp(req.socket?.remoteAddress) || '0.0.0.0';
  const rule = parseTrustProxyRule(process.env.TRUST_PROXY);
  if (rule.kind === 'none') return peer;

  // Do salto mais próximo ao mais distante: a conexão e depois o X-Forwarded-For da direita para a
  // esquerda. Cada proxy confiável acrescenta à direita o endereço de quem falou com ele.
  const forwarded = String(firstHeaderValue(req.headers['x-forwarded-for']) ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reverse();
  const hops = [peer, ...forwarded];
  const lastIndex = Math.min(
    rule.kind === 'hops' ? rule.hops : hops.length - 1,
    hops.length - 1
  );

  let current = peer;
  for (let i = 1; i <= lastIndex; i++) {
    if (rule.kind === 'loopback' && !isLoopback(current)) break;
    const next = normalizeIp(hops[i]);
    // Entrada inválida: fica no último salto confiável em vez de aceitar o texto do cliente.
    if (!next) break;
    current = next;
  }
  return current;
}

export function resetClientIpWarningsForTests(): void {
  missingEdgeHeaderWarned = false;
}
