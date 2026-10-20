import assert from 'node:assert/strict';
import test from 'node:test';
import { countAddresses } from './addressCount.ts';

test('total de endereços: CIDR vale pelo tamanho, IP solto vale 1', () => {
  assert.deepEqual(countAddresses(['10.0.0.1', '192.0.2.0/24', '198.51.100.0/30']), { ipv4: 1 + 256 + 4, ipv6Networks: 0, singleIps: 1, cidrs: 2 });
});

test('total de endereços: IP dentro de CIDR e faixas sobrepostas não contam duas vezes', () => {
  const list = ['185.220.100.0/22', '185.220.101.5', '185.220.101.0/24', '185.220.100.0/22', '185.220.104.0/24'];
  assert.equal(countAddresses(list).ipv4, 1024 + 256);
});

test('total de endereços: faixas encostadas somam e repetidos contam uma vez', () => {
  assert.equal(countAddresses(['203.0.113.0/25', '203.0.113.128/25', '203.0.113.7', '203.0.113.7']).ipv4, 256);
});

test('total de endereços: IPv6 fica à parte e domínios e lixo são ignorados', () => {
  const result = countAddresses(['2001:db8::/64', '2001:db8::1', 'c2-beacon-scan.net', 'lixo', '8.8.8.8']);
  assert.deepEqual(result, { ipv4: 1, ipv6Networks: 1, singleIps: 2, cidrs: 1 });
});

test('total de endereços: o espaço IPv4 inteiro cabe no número', () => {
  assert.equal(countAddresses(['0.0.0.0/0', '1.2.3.4']).ipv4, 2 ** 32);
});

test('total de endereços: separa IPs soltos e CIDRs, contando cada um uma vez', () => {
  const result = countAddresses(['10.0.0.1', '10.0.0.1', '10.0.0.0/24', '10.0.0.0/24', '10.0.1.0/24', 'exemplo.com']);
  assert.equal(result.singleIps, 1);
  assert.equal(result.cidrs, 2);
  assert.equal(result.ipv4, 512);
});
