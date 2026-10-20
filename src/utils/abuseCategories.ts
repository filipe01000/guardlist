// Categorias de denúncia do AbuseIPDB (https://www.abuseipdb.com/categories), em português.
export const ABUSE_CATEGORIES: Record<number, string> = {
  1: 'DNS comprometido',
  2: 'Envenenamento de DNS',
  3: 'Pedidos fraudulentos',
  4: 'Ataque DDoS',
  5: 'Força bruta FTP',
  6: 'Ping of death',
  7: 'Phishing',
  8: 'Fraude VoIP',
  9: 'Proxy aberto',
  10: 'Spam na web',
  11: 'Spam de e-mail',
  12: 'Spam em blog',
  13: 'IP de VPN',
  14: 'Varredura de portas',
  15: 'Invasão',
  16: 'SQL injection',
  17: 'Spoofing',
  18: 'Força bruta',
  19: 'Robô malicioso',
  20: 'Host explorado',
  21: 'Ataque a aplicação web',
  22: 'SSH',
  23: 'Alvo IoT'
};

export const abuseCategory = (id: number) => ABUSE_CATEGORIES[id] ?? `Categoria ${id}`;
