// Busca a logo de um cliente a partir do site dele: logo do cabeçalho (<img> com "logo"),
// imagem de compartilhamento (og:image), ícone grande (apple-touch-icon / icon) ou favicon.
// Devolve a imagem como data URL para o navegador reduzir e gravar.
//
// Segurança: só https/http para hosts públicos (bloqueia IPs internos e reservados em cada
// redirecionamento), tempo e tamanho limitados, e só aceita conteúdo de imagem.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { checkReservedRange } from '../src/utils/validator.ts';

const UA = 'Mozilla/5.0 (GuardList; busca de logo do cliente)';
const MAX_HTML = 1_500_000;
const MAX_IMAGE = 2_000_000;
const MIN_GOOD_SIZE = 120;

export class LogoError extends Error {}

async function assertPublic(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LogoError('Use um endereço http ou https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new LogoError(`Não encontrei o site ${host}.`);
  for (const address of addresses) {
    const lower = address.toLowerCase();
    if (checkReservedRange(address).isReserved || lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      throw new LogoError('Endereço interno ou reservado não é permitido.');
    }
  }
}

/** fetch com redirecionamentos conferidos um a um (nenhum pode levar para a rede interna). */
async function safeFetch(start: string, accept: string): Promise<Response> {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: accept },
      redirect: 'manual',
      signal: AbortSignal.timeout(9000)
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new LogoError('Redirecionamentos demais.');
}

async function readLimited(response: Response, max: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > max) throw new LogoError('Arquivo grande demais.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new LogoError('Arquivo grande demais.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
}

/** Candidatas em ordem de preferência. */
export function logoCandidates(html: string, base: URL): string[] {
  const out: Array<{ href: string; score: number }> = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (!content) continue;
    if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') out.push({ href: content, score: 90 });
    else if (key === 'twitter:image' || key === 'twitter:image:src') out.push({ href: content, score: 85 });
  }
  // Logo do cabeçalho: <img> com "logo", "marca" ou "brand" no endereço, na classe, no id ou no texto alternativo.
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src') || attr(tag, 'data-src');
    if (!src || src.startsWith('data:')) continue;
    const hint = [src, attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'alt')].join(' ').toLowerCase();
    if (/logo|marca|brand/.test(hint)) out.push({ href: src, score: /\.svg(\?|$)/i.test(src) ? 100 : 98 });
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !/icon/.test(rel)) continue;
    const size = Number((attr(tag, 'sizes') || '').split('x')[0]) || 0;
    out.push({ href, score: (rel.includes('apple-touch-icon') ? 70 : 40) + Math.min(size, 512) / 100 });
  }
  out.push({ href: '/apple-touch-icon.png', score: 20 }, { href: '/favicon.ico', score: 10 });
  // Imagens de outros domínios (selos, parceiros, widgets) perdem prioridade.
  const own = siteKey(base.hostname);
  const seen = new Set<string>();
  return out
    .map((c) => {
      try {
        const url = new URL(c.href.replace(/&amp;/g, '&'), base);
        return { href: url.toString(), score: c.score - (siteKey(url.hostname) === own ? 0 : 60) };
      } catch {
        return { href: '', score: 0 };
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((c) => c.href)
    .filter((href) => href && !seen.has(href) && seen.add(href));
}

/** Domínio "principal" de um host (ex.: img.sulgipe.com.br → sulgipe.com.br). */
function siteKey(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  const twoLevel = parts.length > 2 && /^(com|org|net|gov|edu|art|ind|adv|eng|co)$/.test(parts[parts.length - 2]);
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

/** Largura e altura lidas do cabeçalho do arquivo (PNG, GIF, JPEG, WebP); SVG conta como grande. */
export function imageSize(bytes: Buffer, type: string): { w: number; h: number } | null {
  if (type === 'image/svg+xml') return { w: 1000, h: 1000 };
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes.length > 10 && bytes.toString('ascii', 0, 3) === 'GIF') return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
  if (bytes.length > 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Busca no site do cliente e devolve a melhor imagem como data URL (tenta também com "www."). */
export async function fetchLogoFromSite(site: string): Promise<{ dataUrl: string; source: string }> {
  const raw = site.trim();
  if (!raw) throw new LogoError('Informe o site do cliente.');
  try {
    return await fetchLogoFrom(raw);
  } catch (error) {
    const host = raw.replace(/^https?:\/\//i, '');
    if (!/^www\./i.test(host) && error instanceof LogoError && !/interno/.test(error.message)) {
      try {
        return await fetchLogoFrom(`www.${host}`);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

async function fetchLogoFrom(raw: string): Promise<{ dataUrl: string; source: string }> {
  const start = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let base: URL;
  try {
    base = new URL(start);
  } catch {
    throw new LogoError('Endereço inválido.');
  }

  let candidates: string[];
  try {
    const page = await safeFetch(base.toString(), 'text/html,application/xhtml+xml');
    const html = page.ok ? (await readLimited(page, MAX_HTML)).toString('utf8') : '';
    candidates = logoCandidates(html, new URL(page.url || base.toString()));
  } catch (error) {
    if (error instanceof LogoError) throw error;
    throw new LogoError(`Não consegui abrir ${base.hostname}.`);
  }

  // A primeira imagem com pelo menos 120 px vence; ícones pequenos só se não houver nada melhor.
  let fallback: { dataUrl: string; source: string; size: number } | null = null;
  let foreign: { dataUrl: string; source: string } | null = null;
  const own = siteKey(base.hostname);
  for (const href of candidates.slice(0, 10)) {
    try {
      const response = await safeFetch(href, 'image/*');
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !/^image\/(png|jpeg|jpg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) continue;
      const bytes = await readLimited(response, MAX_IMAGE);
      if (bytes.length < 200) continue;
      const found = { dataUrl: `data:${type === 'image/jpg' ? 'image/jpeg' : type};base64,${bytes.toString('base64')}`, source: href };
      const dims = imageSize(bytes, type);
      const size = dims ? Math.max(dims.w, dims.h) : 0;
      // Imagem de outro domínio (selo, parceiro) só entra se o site não tiver nenhuma própria.
      if (siteKey(new URL(href).hostname) !== own) {
        foreign ??= found;
        continue;
      }
      if (size >= MIN_GOOD_SIZE) return found;
      if (!fallback || size > fallback.size) fallback = { ...found, size };
    } catch (error) {
      if (error instanceof LogoError && /interno/.test(error.message)) throw error;
    }
  }
  if (fallback) return { dataUrl: fallback.dataUrl, source: fallback.source };
  if (foreign) return foreign;
  throw new LogoError(`Não encontrei uma imagem no site ${base.hostname}. Envie a logo manualmente.`);
}
