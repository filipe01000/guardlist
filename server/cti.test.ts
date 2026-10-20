import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, parseBlock } from './cti.ts';
import type { CtiSummary } from '../src/types/index.ts';

type Base = Omit<CtiSummary, 'verdict' | 'verdictReason'>;
const base = (extra: Partial<Base> = {}): Base => ({
  indicator: '192.0.2.1', fetchedAt: '2026-10-20T00:00:00.000Z',
  score: 0, totalReports: 0, lastReportedAt: null, domain: null, isp: null, asn: null,
  countryCode: null, usageType: null, greyNoise: null, otxPulses: 0, ...extra
});

test('reputação: nota alta, muitas denúncias ou GreyNoise malicioso é alto risco', () => {
  assert.equal(decide(base({ score: 100, totalReports: 399 })).verdict, 'high');
  assert.equal(decide(base({ score: 30, totalReports: 60 })).verdict, 'high');
  assert.equal(decide(base({ greyNoise: { classification: 'malicious', riot: false, name: null } })).verdict, 'high');
});

test('reputação: serviço conhecido é legítimo, mesmo com denúncias antigas', () => {
  assert.equal(decide(base({ domain: 'google.com', score: 0, totalReports: 234 })).verdict, 'legit');
  assert.equal(decide(base({ greyNoise: { classification: 'benign', riot: true, name: 'Cloudflare' } })).verdict, 'legit');
});

test('reputação: Censys e lista branca do AbuseIPDB viram scanner, não médio', () => {
  const censys = decide(base({ domain: 'censys.com', isp: 'Censys, Inc.', otxPulses: 39 }));
  assert.equal(censys.verdict, 'scanner');
  assert.match(censys.verdictReason ?? '', /Censys/);
  assert.equal(decide(base({ isWhitelisted: true, otxPulses: 12 })).verdict, 'scanner');
  assert.equal(decide(base({ hostnames: ['scan-12.shadowserver.org'] })).verdict, 'scanner');
  assert.equal(decide(base({ greyNoise: { classification: 'benign', riot: false, name: 'Shodan.io' } })).verdict, 'scanner');
});

test('reputação: scanner com nota alta continua alto risco', () => {
  assert.equal(decide(base({ domain: 'censys.com', score: 90 })).verdict, 'high');
});

test('reputação: médio explica de onde veio o alerta; sem nada é baixo; sem fontes é sem dados', () => {
  const medium = decide(base({ otxPulses: 3 }));
  assert.equal(medium.verdict, 'medium');
  assert.match(medium.verdictReason ?? '', /OTX/);
  assert.equal(decide(base()).verdict, 'low');
  assert.equal(decide(base({ score: null, totalReports: null, otxPulses: null })).verdict, 'unknown');
});

test('rede no AbuseIPDB: os piores IPs primeiro e linhas sem IP descartadas', () => {
  const parsed = parseBlock({
    networkAddress: '193.32.162.0', netmask: '255.255.255.0', minAddress: '193.32.162.0', maxAddress: '193.32.162.255',
    numPossibleHosts: 256, addressSpaceDesc: 'Public address',
    reportedAddress: [
      { ipAddress: '193.32.162.0', numReports: 4, mostRecentReport: '2026-10-11T01:30:25+00:00', abuseConfidenceScore: 18, countryCode: 'RO' },
      { ipAddress: '193.32.162.5', numReports: 579, mostRecentReport: '2026-10-20T21:08:32+00:00', abuseConfidenceScore: 100, countryCode: 'RO' },
      { numReports: 1 }
    ]
  });
  assert.equal(parsed.numPossibleHosts, 256);
  assert.deepEqual(parsed.reported.map((r) => [r.ip, r.score]), [['193.32.162.5', 100], ['193.32.162.0', 18]]);
});
