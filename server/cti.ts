import { isIP } from 'node:net';
import type { Database } from './db.ts';
import type { CidrAnalysis, CtiSummary, CtiVerdict, IpAnalysis } from '../src/types/index.ts';

// Reputação de IPs. Todas as consultas ao AbuseIPDB, GreyNoise e OTX passam por aqui:
// - cti_cache: resumo de 90 dias, usado na triagem da importação, na lista do cliente e nos gráficos;
// - cti_analysis_cache: consulta detalhada de 12 meses (página Análise de IP e dossiê), guardada por pouco tempo.
// As duas ficam separadas para os números de cada tela não se misturarem.

const CACHE_HOURS = Number(process.env.CTI_CACHE_HOURS || 72);
const ANALYSIS_CACHE_MIN = Number(process.env.CTI_ANALYSIS_CACHE_MIN || 60);
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

// Scanners de pesquisa conhecidos: varrem a internet toda, não miram o cliente. Bloquear ou não é decisão da equipe.
const KNOWN_SCANNERS: Array<[RegExp, string]> = [
  [/censys/i, 'Censys'],
  [/shodan/i, 'Shodan'],
  [/shadowserver/i, 'Shadowserver'],
  [/binaryedge/i, 'BinaryEdge'],
  [/rapid7|project sonar/i, 'Rapid7 (Project Sonar)'],
  [/stretchoid/i, 'Stretchoid'],
  [/internet-measurement|driftnet/i, 'Driftnet'],
  [/onyphe/i, 'Onyphe'],
  [/leakix/i, 'LeakIX'],
  [/criminalip|ai-spera/i, 'Criminal IP'],
  [/internet-census|recyber/i, 'Internet Census']
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

function matchName(list: Array<[RegExp, string]>, ...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(' ');
  for (const [pattern, name] of list) if (pattern.test(text)) return name;
  return null;
}

/** Veredito da reputação. Exportado para os testes: é a regra que separa alto, médio, baixo, scanner e legítimo. */
export function decide(summary: Omit<CtiSummary, 'verdict' | 'verdictReason'>): { verdict: CtiVerdict; verdictReason?: string } {
  const score = summary.score ?? 0;
  const reports = summary.totalReports ?? 0;
  const names = [summary.domain, summary.isp, summary.asn, summary.greyNoise?.name, ...(summary.hostnames ?? [])];
  const provider = matchName(KNOWN_PROVIDERS, ...names);
  if (summary.greyNoise?.riot) return { verdict: 'legit', verdictReason: `Serviço legítimo conhecido (GreyNoise${summary.greyNoise.name ? `: ${summary.greyNoise.name}` : ''})` };
  if (provider && score < 25) return { verdict: 'legit', verdictReason: `Pertence a ${provider}` };
  if (summary.usageType && /search engine spider|content delivery/i.test(summary.usageType) && score < 25) {
    return { verdict: 'legit', verdictReason: summary.usageType };
  }
  const scanner = matchName(KNOWN_SCANNERS, ...names);
  if (score < 75) {
    if (scanner) return { verdict: 'scanner', verdictReason: `Scanner de pesquisa conhecido (${scanner})` };
    if (summary.isWhitelisted) return { verdict: 'scanner', verdictReason: 'Na lista branca do AbuseIPDB (serviço conhecido)' };
    if (summary.greyNoise?.classification === 'benign') {
      return { verdict: 'scanner', verdictReason: `Varredura benigna segundo o GreyNoise${summary.greyNoise.name ? ` (${summary.greyNoise.name})` : ''}` };
    }
  }
  if (summary.score === null && summary.greyNoise === null && summary.otxPulses === null) return { verdict: 'unknown' };
  if (score >= 75 || reports >= 50 || summary.greyNoise?.classification === 'malicious') return { verdict: 'high' };
  if (score < 10 && reports < 3 && !(summary.otxPulses && summary.otxPulses > 0)) return { verdict: 'low', verdictReason: 'Sem denúncias relevantes' };
  // Médio: diz de onde veio o alerta, para não parecer contraditório com nota 0 no AbuseIPDB.
  const why: string[] = [];
  if (score > 0 || reports > 0) why.push(`nota ${score}% e ${reports} denúncias no AbuseIPDB`);
  else if (summary.score !== null) why.push('sem denúncias recentes no AbuseIPDB');
  if (summary.otxPulses) why.push(`${summary.otxPulses} alertas (pulses) no OTX`);
  return { verdict: 'medium', verdictReason: why.length ? `Risco médio: ${why.join(score > 0 || reports > 0 ? '; ' : ', mas ')}` : undefined };
}

const labelOf = (value: any): string =>
  typeof value === 'string' ? value : String(value?.display_name || value?.name || value?.target || value?.id || '').trim();

// verbose: janela de 12 meses e as denúncias do AbuseIPDB (página de análise e dossiê, uma consulta por vez).
async function lookupFull(ip: string, verbose: boolean): Promise<{ summary: CtiSummary; detail: IpAnalysis['detail'] }> {
  const abuseKey = process.env.ABUSEIPDB_API_KEY;
  const greyKey = process.env.GREYNOISE_API_KEY;
  const otxKey = process.env.OTX_API_KEY;
  const encoded = encodeURIComponent(ip);
  const errors: string[] = [];

  const [abuse, grey, otx] = await Promise.all([
    abuseKey
      ? getJson(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encoded}&maxAgeInDays=${verbose ? '365&verbose' : '90'}`, { Accept: 'application/json', Key: abuseKey }).catch(() => null)
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

  const hostnames: string[] = a && Array.isArray(a.hostnames) ? a.hostnames.filter((h: unknown): h is string => typeof h === 'string' && Boolean(h)).slice(0, 10) : [];
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
    hostnames,
    isWhitelisted: a && typeof a.isWhitelisted === 'boolean' ? a.isWhitelisted : null,
    greyNoise: g
      ? { classification: typeof g.classification === 'string' ? g.classification : null, riot: Boolean(g.riot), name: typeof g.name === 'string' && g.name !== 'unknown' ? g.name : null }
      : null,
    otxPulses: o ? Number(o.pulse_info?.count ?? 0) : null,
    errors: errors.length ? errors : undefined
  };
  const pulses: any[] = o && Array.isArray(o.pulse_info?.pulses) ? o.pulse_info.pulses : [];
  const detail: IpAnalysis['detail'] = a || o
    ? {
        countryName: a && typeof a.countryName === 'string' ? a.countryName : null,
        isTor: Boolean(a?.isTor),
        isWhitelisted: base.isWhitelisted,
        isPublic: a && typeof a.isPublic === 'boolean' ? a.isPublic : null,
        hostnames,
        distinctUsers: a && typeof a.numDistinctUsers === 'number' ? a.numDistinctUsers : null,
        reports: (a && Array.isArray(a.reports) ? a.reports : [])
          .slice()
          .sort((x: any, y: any) => String(y?.reportedAt).localeCompare(String(x?.reportedAt)))
          .slice(0, 50)
          .map((r: any) => ({
            reportedAt: String(r?.reportedAt ?? ''),
            comment: typeof r?.comment === 'string' ? r.comment.slice(0, 600) : '',
            categories: Array.isArray(r?.categories) ? r.categories.filter((c: unknown) => typeof c === 'number') : [],
            reporterCountryCode: typeof r?.reporterCountryCode === 'string' ? r.reporterCountryCode : null
          })),
        otxTags: [...new Set(pulses.flatMap((p) => p?.tags || []).map(labelOf).filter(Boolean))].slice(0, 15),
        malwareFamilies: [...new Set(pulses.flatMap((p) => p?.malware_families || []).map(labelOf).filter(Boolean))].slice(0, 15)
      }
    : null;
  return { summary: { ...base, ...decide(base) }, detail };
}

async function lookup(ip: string): Promise<CtiSummary> {
  return (await lookupFull(ip, false)).summary;
}

export function ctiConfigured() {
  return {
    abuseIpDb: Boolean(process.env.ABUSEIPDB_API_KEY),
    greyNoise: Boolean(process.env.GREYNOISE_API_KEY),
    otx: Boolean(process.env.OTX_API_KEY)
  };
}

const answered = (summary: CtiSummary) => !(summary.score === null && summary.greyNoise === null && summary.otxPulses === null);

/** Resumo do cache com o veredito refeito pela regra atual: mudar a regra vale na hora, sem esperar o cache vencer. */
export function rejudge(summary: CtiSummary): CtiSummary {
  const { verdict: _verdict, verdictReason: _reason, ...facts } = summary;
  return { ...facts, ...decide(facts) };
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

  // Consulta detalhada recente (IP ou rede), para não gastar a cota a cada vez que a página abre.
  async function recentAnalysis<T>(key: string): Promise<T | null> {
    const rows = await db.query<{ data: T }>(
      `SELECT data FROM cti_analysis_cache WHERE indicator = $1 AND fetched_at > now() - make_interval(mins => $2::int)`,
      [key, ANALYSIS_CACHE_MIN]
    );
    return rows[0]?.data ?? null;
  }

  async function saveAnalysis(key: string, data: unknown) {
    await db.query(
      `INSERT INTO cti_analysis_cache (indicator, data, fetched_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (indicator) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
      [key, JSON.stringify(data)]
    );
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
        if (hit && !options.force && hit.fetchedAt > fresh) results[ip] = rejudge(hit.data);
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
            if (answered(summary)) {
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
        if (hit) results[ip] = rejudge(hit.data);
      }
      return { results, pending: Math.max(toFetch.length - limit, 0), configured };
    },

    // Consulta detalhada de um IP (12 meses, com denúncias). Fica guardada por ANALYSIS_CACHE_MIN minutos;
    // force refaz a consulta. Não mexe no cache de 90 dias da triagem.
    async analyze(indicator: string, options: { force?: boolean } = {}): Promise<IpAnalysis> {
      const ip = String(indicator ?? '').trim().toLowerCase();
      if (isIP(ip) === 0) throw Object.assign(new Error('Informe um endereço IP válido.'), { status: 400 });
      const configured = ctiConfigured();
      if (!Object.values(configured).some(Boolean)) {
        const fetchedAt = new Date().toISOString();
        return { configured, detail: null, fetchedAt, summary: { indicator: ip, fetchedAt, verdict: 'unknown', score: null, totalReports: null, lastReportedAt: null, domain: null, isp: null, asn: null, countryCode: null, usageType: null, greyNoise: null, otxPulses: null } };
      }
      if (!options.force) {
        const hit = await recentAnalysis<IpAnalysis>(`ip:${ip}`);
        if (hit) return { ...hit, summary: rejudge(hit.summary), cached: true };
      }
      const { summary, detail } = await lookupFull(ip, true);
      const result: IpAnalysis = { configured, summary, detail, fetchedAt: summary.fetchedAt };
      if (answered(summary)) await saveAnalysis(`ip:${ip}`, result);
      return result;
    },

    // Rede inteira no AbuseIPDB: quais IPs dela foram denunciados. O plano grátis aceita até /24 e 30 dias.
    async analyzeBlock(network: string, options: { force?: boolean } = {}): Promise<CidrAnalysis> {
      const cidr = String(network ?? '').trim();
      const key = process.env.ABUSEIPDB_API_KEY;
      const fetchedAt = new Date().toISOString();
      if (!key) return { network: cidr, configured: false, detail: null, fetchedAt };
      if (!options.force) {
        const hit = await recentAnalysis<CidrAnalysis>(`net:${cidr}`);
        if (hit) return { ...hit, cached: true };
      }
      const response = await getJson(
        `https://api.abuseipdb.com/api/v2/check-block?network=${encodeURIComponent(cidr)}&maxAgeInDays=30`,
        { Accept: 'application/json', Key: key }
      ).catch(() => null);
      if (!response) return { network: cidr, configured: true, detail: null, fetchedAt, error: 'AbuseIPDB indisponível. Tente de novo em instantes.' };
      if (response.status !== 200) {
        const detail = String(response.body?.errors?.[0]?.detail ?? '');
        const error = response.status === 429
          ? 'Limite diário do AbuseIPDB atingido.'
          : /bitmask wider/i.test(detail)
            ? 'O plano grátis do AbuseIPDB só consulta redes de até /24 (256 endereços). Divida a rede em /24 para consultar.'
            : detail || `AbuseIPDB respondeu com erro ${response.status}.`;
        return { network: cidr, configured: true, detail: null, fetchedAt, error };
      }
      const result: CidrAnalysis = { network: cidr, configured: true, fetchedAt, detail: parseBlock(response.body?.data ?? {}) };
      await saveAnalysis(`net:${cidr}`, result);
      return result;
    },

    async testKeys() {
      const configured = ctiConfigured();
      if (!Object.values(configured).some(Boolean)) return { configured, result: null };
      const result = await lookup('8.8.8.8');
      return { configured, result };
    }
  };
}

/** Converte a resposta do check-block do AbuseIPDB. Exportado para os testes. */
export function parseBlock(d: any): NonNullable<CidrAnalysis['detail']> {
  return {
    networkAddress: String(d?.networkAddress ?? ''),
    netmask: String(d?.netmask ?? ''),
    minAddress: String(d?.minAddress ?? ''),
    maxAddress: String(d?.maxAddress ?? ''),
    numPossibleHosts: Number(d?.numPossibleHosts ?? 0),
    addressSpaceDesc: String(d?.addressSpaceDesc ?? ''),
    reported: (Array.isArray(d?.reportedAddress) ? d.reportedAddress : [])
      .map((r: any) => ({
        ip: String(r?.ipAddress ?? ''),
        numReports: Number(r?.numReports ?? 0),
        mostRecentReport: String(r?.mostRecentReport ?? ''),
        score: Number(r?.abuseConfidenceScore ?? 0),
        countryCode: typeof r?.countryCode === 'string' ? r.countryCode : null
      }))
      .filter((r: { ip: string }) => r.ip)
      .sort((a: { score: number; numReports: number }, b: { score: number; numReports: number }) => b.score - a.score || b.numReports - a.numReports)
  };
}

export type Cti = ReturnType<typeof createCti>;
