import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaseText, caseKind, validateCaseIndicators } from './caseTemplate.ts';

const at14h = new Date(2026, 9, 14, 14, 0, 0);
const build = (raw: string, ticket = 'TLD-123') => buildCaseText(validateCaseIndicators(raw), { ticket, date: at14h, reason: 'scan' }).body;

test('vários IPs: reproduz o modelo da equipe', () => {
  const body = build('192.42.116.105\n155.254.28.195\n155.254.28.194');
  assert.equal(body, [
    'Prezados, boa tarde!',
    '',
    'Durante as atividades de monitoramento dos eventos de segurança, foram identificadas conexões originadas de endereços IP associados a serviços automatizados de varredura na Internet.',
    '',
    'Essas origens realizam atividades de reconhecimento em ativos expostos, buscando identificar portas abertas e serviços acessíveis. Embora esse comportamento, por si só, não caracterize uma tentativa de comprometimento, ele pode representar uma etapa inicial de reconhecimento utilizada antes de possíveis ataques. Como medida preventiva, foi realizado o bloqueio dos endereços identificados.',
    '',
    'Após a análise dos eventos, os seguintes endereços IP foram adicionados à BlockList:',
    '',
    '155.254.28.194',
    '155.254.28.195',
    '192.42.116.105',
    '',
    'Ticket TLD: TLD-123'
  ].join('\n'));
});

test('um IP: singular', () => {
  const body = build('45.9.20.33');
  assert.match(body, /de um endereço IP associado a serviços/);
  assert.match(body, /Essa origem realiza/);
  assert.match(body, /bloqueio do endereço identificado\./);
  assert.match(body, /o seguinte endereço IP foi adicionado à BlockList:\n\n45\.9\.20\.33\n/);
});

test('um CIDR: faixa no singular e total de endereços', () => {
  const body = build('185.220.100.0/22');
  assert.match(body, /uma faixa de rede \(CIDR\) associada/);
  assert.match(body, /a seguinte faixa de rede \(CIDR\) foi adicionada à BlockList:\n\n185\.220\.100\.0\/22\n/);
  assert.match(body, /contidos nela \(1\.024 endereços no total\)/);
});

test('vários CIDRs: plural e soma dos blocos', () => {
  const body = build('193.42.33.0/24, 185.220.100.0/22');
  assert.match(body, /as seguintes faixas de rede \(CIDR\) foram adicionadas/);
  assert.match(body, /185\.220\.100\.0\/22\n193\.42\.33\.0\/24/);
  assert.match(body, /contidos nelas \(1\.280 endereços no total\)/);
});

test('misto: seções separadas e IP dentro de CIDR retirado', () => {
  const v = validateCaseIndicators('193.42.33.7\n193.42.33.0/24\n8.8.4.4\n8.8.4.4\nlixo');
  assert.deepEqual(v.ips, ['8.8.4.4']);
  assert.deepEqual(v.cidrs, ['193.42.33.0/24']);
  assert.deepEqual(v.covered, [{ indicator: '193.42.33.7', by: '193.42.33.0/24' }]);
  assert.deepEqual(v.duplicates, ['8.8.4.4']);
  assert.deepEqual(v.invalid, ['lixo']);
  assert.equal(caseKind(v), 'mixed');
  const body = buildCaseText(v, { ticket: 'TLD-9', date: at14h, reason: 'scan' }).body;
  assert.match(body, /Endereços IP:\n8\.8\.4\.4\n\nFaixas de rede \(CIDR\):\n193\.42\.33\.0\/24/);
});

test('ticket é obrigatório', () => {
  assert.throws(() => build('1.2.3.4', '  '), /ticket TLD/);
});
