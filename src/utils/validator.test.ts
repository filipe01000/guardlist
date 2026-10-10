/**
 * Suíte de Testes Unitários para o Módulo de Validação e Normalização
 * Pode ser executada no browser com resultados detalhados.
 */

import {
  normalizeIndicator,
  classifyIndicator,
  isIpv4InCidr,
  isCidrInCidr,
  checkReservedRange,
  ipv4ToNumber
} from './validator';
import { generateNanoFormattedTxt } from './exporter';
import { extractTokensFromRawInput, extractValidIndicatorsFromText } from './importer';

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  error?: string;
}

export function runValidatorTests(): {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
} {
  const results: TestResult[] = [];

  function assertEqual(suite: string, name: string, actual: any, expected: any) {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({
      suite,
      name,
      passed,
      expected,
      actual,
      error: passed ? undefined : `Esperado: ${JSON.stringify(expected)}, obtido: ${JSON.stringify(actual)}`
    });
  }

  // --- 1. Testes de Normalização ---
  const sNorm = 'Normalização de Indicadores';

  assertEqual(
    sNorm,
    'Deve remover espaços e converter para minúsculas',
    normalizeIndicator('   Evil-Domain.COM   '),
    'evil-domain.com'
  );

  assertEqual(
    sNorm,
    'Deve remover zeros à esquerda em IPv4 (010.008.001.001 -> 10.8.1.1)',
    normalizeIndicator('010.008.001.001'),
    '10.8.1.1'
  );

  assertEqual(
    sNorm,
    'Deve remover protocolo http:// e https://',
    normalizeIndicator('https://185.220.101.5/'),
    '185.220.101.5'
  );

  assertEqual(
    sNorm,
    'Deve remover porta em IPv4 (192.168.1.1:8080 -> 192.168.1.1)',
    normalizeIndicator('192.168.1.1:8080'),
    '192.168.1.1'
  );

  assertEqual(
    sNorm,
    'Deve normalizar zeros em CIDR (010.000.000.000/024 -> 10.0.0.0/24)',
    normalizeIndicator('010.000.000.000/024'),
    '10.0.0.0/24'
  );

  // --- 2. Testes de Classificação de Tipos ---
  const sClass = 'Classificação de Indicadores';

  assertEqual(
    sClass,
    'Deve classificar IPv4 padrão corretamente',
    classifyIndicator('45.148.10.12').type,
    'IPv4'
  );

  assertEqual(
    sClass,
    'Deve classificar CIDR IPv4 corretamente',
    classifyIndicator('194.26.29.0/24').type,
    'CIDR_v4'
  );

  assertEqual(
    sClass,
    'Deve classificar IPv6 padrão e abreviado corretamente',
    classifyIndicator('2001:db8::1').type,
    'IPv6'
  );

  assertEqual(
    sClass,
    'Deve classificar CIDR IPv6 corretamente',
    classifyIndicator('2001:db8::/32').type,
    'CIDR_v6'
  );

  assertEqual(
    sClass,
    'Deve classificar FQDN de Domínio corretamente',
    classifyIndicator('botnet-c2-server.org').type,
    'Domain'
  );

  assertEqual(
    sClass,
    'Deve marcar octeto inválido > 255 como Inválido',
    classifyIndicator('256.1.1.1').type,
    'Invalid'
  );

  assertEqual(
    sClass,
    'Deve marcar máscara CIDR > 32 como Inválido',
    classifyIndicator('10.0.0.0/33').type,
    'Invalid'
  );

  assertEqual(
    sClass,
    'Deve marcar caracteres inválidos como Inválido',
    classifyIndicator('ip-malicioso-sem-tld').type,
    'Invalid'
  );

  // --- 3. Testes de Contenção de CIDR ---
  const sCidr = 'Contenção em CIDR';

  assertEqual(
    sCidr,
    'Deve identificar 10.0.0.5 dentro de 10.0.0.0/24',
    isIpv4InCidr('10.0.0.5', '10.0.0.0/24'),
    true
  );

  assertEqual(
    sCidr,
    'Deve identificar que 10.0.1.5 NÃO está dentro de 10.0.0.0/24',
    isIpv4InCidr('10.0.1.5', '10.0.0.0/24'),
    false
  );

  assertEqual(
    sCidr,
    'Deve identificar sub-rede 192.168.1.0/26 dentro de 192.168.1.0/24',
    isCidrInCidr('192.168.1.0/26', '192.168.1.0/24'),
    true
  );

  assertEqual(
    sCidr,
    'Deve identificar que /24 NÃO está contido em /26',
    isCidrInCidr('192.168.1.0/24', '192.168.1.0/26'),
    false
  );

  // --- 4. Testes de Faixas Reservadas e Privadas (RFC 1918 / Bogons) ---
  const sRes = 'Detecção de Faixas Reservadas e Privadas';

  assertEqual(
    sRes,
    'Deve detectar RFC 1918 10.0.0.1 como privado',
    checkReservedRange('10.0.0.1').isReserved,
    true
  );

  assertEqual(
    sRes,
    'Deve detectar RFC 1918 172.20.1.10 como privado',
    checkReservedRange('172.20.1.10').isReserved,
    true
  );

  assertEqual(
    sRes,
    'Deve detectar RFC 1918 192.168.1.1 como privado',
    checkReservedRange('192.168.1.1').isReserved,
    true
  );

  assertEqual(
    sRes,
    'Deve detectar Loopback 127.0.0.1',
    checkReservedRange('127.0.0.1').isReserved,
    true
  );

  assertEqual(
    sRes,
    'Deve detectar Link-Local APIPA 169.254.1.1',
    checkReservedRange('169.254.1.1').isReserved,
    true
  );

  assertEqual(
    sRes,
    'Deve detectar IP público atacante como NÃO reservado (falso para alerta)',
    checkReservedRange('185.220.101.5').isReserved,
    false
  );

  // --- 5. Teste de Conversão Numérica IPv4 ---
  const sNum = 'Ordenação Numérica IPv4';

  assertEqual(
    sNum,
    'Conversão numérica de 10.0.0.1 deve ser menor que 10.0.0.2',
    ipv4ToNumber('10.0.0.1') < ipv4ToNumber('10.0.0.2'),
    true
  );

  assertEqual(
    sNum,
    '10.2.0.1 deve vir antes de 10.10.0.1 na ordenação numérica (diferente da alfabética)',
    ipv4ToNumber('10.2.0.1') < ipv4ToNumber('10.10.0.1'),
    true
  );

  // --- 6. Teste de Formatação de Exportação NANO ---
  const sNano = 'Formatação de Exportação NANO';
  const nanoMock = [
    { id: '1', clientId: 'c1', indicator: '192.168.1.1', type: 'IPv4' as const, addedDate: '2026-10-10', status: 'active' as const },
    { id: '2', clientId: 'c1', indicator: '10.0.0.0/24', type: 'CIDR_v4' as const, addedDate: '2026-10-10', status: 'active' as const }
  ];
  const nanoOut = generateNanoFormattedTxt(nanoMock, true);

  assertEqual(
    sNano,
    'Deve conter a seção === IPS ÚNICOS ===',
    nanoOut.includes('=== IPS ÚNICOS ==='),
    true
  );

  assertEqual(
    sNano,
    'Deve conter a seção === REDES CIDR ===',
    nanoOut.includes('=== REDES CIDR ==='),
    true
  );

  assertEqual(
    sNano,
    'Deve colocar o IP 192.168.1.1 antes do cabeçalho de CIDR',
    nanoOut.indexOf('192.168.1.1') < nanoOut.indexOf('=== REDES CIDR ==='),
    true
  );

  // --- 7. Teste de Higienização de Cabeçalhos e Múltiplos IPs por Linha ---
  const sExtract = 'Extração Inteligente de Cabeçalhos e Múltiplos IPs';
  const messyInput = '=== IPS ÚNICOS === 200.219.11.15 93.187.128.69 === REDES CIDR === 45.205.1.240/29';
  const tokens = extractTokensFromRawInput(messyInput);
  const valids = extractValidIndicatorsFromText(messyInput);

  assertEqual(
    sExtract,
    'Deve extrair 3 tokens válidos da linha com cabeçalhos misturados',
    valids.length,
    3
  );

  assertEqual(
    sExtract,
    'Deve conter o IP 200.219.11.15',
    valids.includes('200.219.11.15'),
    true
  );

  assertEqual(
    sExtract,
    'Deve conter a sub-rede CIDR 45.205.1.240/29',
    valids.includes('45.205.1.240/29'),
    true
  );

  const passedCount = results.filter(r => r.passed).length;
  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    results
  };
}
