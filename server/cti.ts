import { isIP } from 'node:net';
import type { Database } from './db.ts';
import type { CtiSummary, CtiVerdict } from '../src/types/index.ts';

// Reputação de IPs para triagem na importação e para os gráficos. Consulta AbuseIPDB, GreyNoise e OTX
// com poucas requisições simultâneas e guarda o resultado em cti_cache, para não gastar a cota de novo.

const CACHE_HOURS = Number(process.env.CTI_CACHE_HOURS || 72);
const CONCURRENCY = 4;

// Serviços conhecidos que raramente devem ser bloqueados (CDNs, nuvens, buscadores).
const KNOWN_PROVIDERS: Array<[RegExp, string]> = [
  [/google|1e100\.net/i, 'Google'],
  [/cloudflare/i, 'Cloudflare'],
  [/microsoft|azure|msedge|bing/i, 'Microsoft'],
  [/amazon|aws|cloudfront/i, 'Amazon / AWS'],
  [/akamai/i, 'Akamai'],
  [/apple/i, 'Apple'],
  [/facebook|meta platforms|fbcdn/i, 'Meta'],
  [/fastly/i, 'Fastly'],
  [/github/i, 'GitHub'],
  [/oracle cloud|oraclecloud/i, 'Oracle Cloud']
];

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } finally {
    clearTimeout(timeout);
  }
}

function knownProvider(...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(' ');
  for (const [pattern, name] of KNOWN_PROVIDERS) if (pattern.test(text)) return name;
  return null;
}

function decide(summary: Omit<CtiSummary, 'verdict' | 'verdictReason'>): { verdict: CtiVerdict; verdictReason?: string } {
  const provider = knownProvider(summary.domain, summary.isp, summary.asn, summary.greyNoise?.name);
  if (summary.greyNoise?.riot) return { verdict: 'legit', verdictReason: `Serviço legítimo conhecido (GreyNoise${summary.greyNoise.name ? `: ${summary.greyNoise.name}` : ''})` };
  if (provider && (summary.score ?? 0) < 25) return { verdict: 'legit', verdictReason: `Pertence a ${provider}` };
  if (summary.usageType && /search engine spider|content delivery/i.test(summary.usageType) && (summary.score ?? 0) < 25) {
    return { verdict: 'legit', verdictReason: summary.usageType };
  }
  if (summary.score === null && summary.greyNoise === null && summary.otxPulses === null) return { verdict: 'unknown' };
  const score = summary.score ?? 0;
  const reports = summary.totalReports ?? 0;
  if (score >= 75 || reports >= 50 || summary.greyNoise?.classification === 'malicious') return { verdict: 'high' };
  if (score < 10 && reports < 3 && !(summary.otxPulses && summary.otxPulses > 0)) return { verdict: 'low', verdictReason: 'Sem denúncias relevantes' };
  return { verdict: 'medium' };
}

async function lookup(ip: string): Promise<CtiSummary> {
  const abuseKey = process.env.ABUSEIPDB_API_KEY;
  const greyKey = process.env.GREYNOISE_API_KEY;
  const otxKey = process.env.OTX_API_KEY;
  const encoded = encodeURIComponent(ip);
  const errors: string[] = [];

  const [abuse, grey, otx] = await Promise.all([
    abuseKey
      ? getJson(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encoded}&maxAgeInDays=90`, { Accept: 'application/json', Key: abuseKey }).catch(() => null)
      : Promise.resolve(null),
    greyKey
      ? getJson(`https://api.greynoise.io/v3/community/${encoded}`, { Accept: 'application/json', key: greyKey }).catch(() => null)
      : Promise.resolve(null),
    otxKey
      ? getJson(`https://otx.alienvault.com/api/v1/indicators/${isIP(ip) === 6 ? 'IPv6' : 'IPv4'}/${encoded}/general`, { Accept: 'application/json', 'X-OTX-API-KEY': otxKey }).catch(() => null)
      : Promise.resolve(null)
  ]);

  const a = abuse && abuse.status === 200 ? abuse.body?.data : null;
  if (abuseKey && !a) errors.push(abuse?.status === 429 ? 'AbuseIPDB: limite diário atingido' : 'AbuseIPDB indisponível');
  // GreyNoise community responde 404 para IPs que ele não viu: não é erro.
  const g = grey && (grey.status === 200 || grey.status === 404) ? grey.body : null;
  if (greyKey && !g) errors.push(grey?.status === 429 ? 'GreyNoise: limite atingido' : 'GreyNoise indisponível');
  const o = otx && otx.status === 200 ? otx.body : null;
  if (otxKey && !o) errors.push('OTX indisponível');

  const base = {
    indicator: ip,
    fetchedAt: new Date().toISOString(),
    score: a ? Number(a.abuseConfidenceScore ?? 0) : null,
    totalReports: a ? Number(a.totalReports ?? 0) : null,
    lastReportedAt: a && typeof a.lastReportedAt === 'string' ? a.lastReportedAt : null,
    domain: (a && typeof a.domain === 'string' && a.domain) || null,
    isp: (a && typeof a.isp === 'string' && a.isp) || null,
    asn: (o && typeof o.asn === 'string' && o.asn) || null,
    countryCode: (a && typeof a.countryCode === 'string' && a.countryCode) || (o && typeof o.country_code === 'string' && o.country_code) || null,
    usageType: (a && typeof a.usageType === 'string' && a.usageType) || null,
    greyNoise: g
      ? { classification: typeof g.classification === 'string' ? g.classification : null, riot: Boolean(g.riot), name: typeof g.name === 'string' && g.name !== 'unknown' ? g.name : null }
      : null,
    otxPulses: o ? Number(o.pulse_info?.count ?? 0) : null,
    errors: errors.length ? errors : undefined
  };
  return { ...base, ...decide(base) };
}

export function ctiConfigured() {
  return {
    abuseIpDb: Boolean(process.env.ABUSEIPDB_API_KEY),
    greyNoise: Boolean(process.env.GREYNOISE_API_KEY),
    otx: Boolean(process.env.OTX_API_KEY)
  };
}

export function createCti(db: Database) {
  async function cached(ips: string[]): Promise<Map<string, { data: CtiSummary; fetchedAt: number }>> {
    if (ips.length === 0) return new Map();
    const rows = await db.query<{ indicator: string; data: CtiSummary; fetched_at: string }>(
      'SELECT indicator, data, fetched_at FROM cti_cache WHERE indicator = ANY($1::text[])',
      [ips]
    );
    return new Map(rows.map((r) => [r.indicator, { data: r.data, fetchedAt: new Date(r.fetched_at).getTime() }]));
  }

  return {
    // Reputação de até `limit` IPs: usa o cache quando recente e consulta o restante.
    async enrich(indicators: string[], options: { force?: boolean; limit?: number } = {}) {
      const ips = [...new Set(indicators.map((x) => String(x).trim().toLowerCase()).filter((x) => isIP(x) !== 0))];
      const limit = Math.min(options.limit ?? 100, 100);
      const known = await cached(ips);
      const fresh = Date.now() - CACHE_HOURS * 3_600_000;
      const results: Record<string, CtiSummary> = {};
      const toFetch: string[] = [];
      for (const ip of ips) {
        const hit = known.get(ip);
        if (hit && !options.force && hit.fetchedAt > fresh) results[ip] = hit.data;
        else toFetch.push(ip);
      }
      const batch = toFetch.slice(0, limit);
      const configured = Object.values(ctiConfigured()).some(Boolean);
      if (configured) {
        let cursor = 0;
        const worker = async () => {
          while (cursor < batch.length) {
            const ip = batch[cursor++];
            const summary = await lookup(ip);
            results[ip] = summary;
            // Só guarda no cache quando ao menos uma fonte respondeu.
            if (!(summary.score === null && summary.greyNoise === null && summary.otxPulses === null)) {
              await db.query(
                `INSERT INTO cti_cache (indicator, data, fetched_at) VALUES ($1, $2::jsonb, now())
                 ON CONFLICT (indicator) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
                [ip, JSON.stringify(summary)]
              );
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
      }
      // Itens que ficaram de fora do lote ainda aparecem se houver cache antigo.
      for (const ip of toFetch.slice(limit)) {
        const hit = known.get(ip);
        if (hit) results[ip] = hit.data;
      }
      return { results, pending: Math.max(toFetch.length - limit, 0), configured };
    },

    async testKeys() {
      const configured = ctiConfigured();
      if (!Object.values(configured).some(Boolean)) return { configured, result: null };
      const result = await lookup('8.8.8.8');
      return { configured, result };
    }
  };
}

export type Cti = ReturnType<typeof createCti>;
