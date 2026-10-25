// Descrição curta do navegador a partir do user-agent (também usada no servidor para comparar acessos).
export function describeAgent(userAgent: string | null): { label: string; mobile: boolean } {
  const ua = userAgent || '';
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: [browser, os].filter(Boolean).join(' · ') || 'Desconhecido', mobile };
}

// Rede do IP para comparar acessos: /24 no IPv4 e /48 no IPv6 (operadoras trocam o fim do endereço com frequência).
export function networkOf(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const parts = v4.split('.').map(Number);
    return parts.every((n) => n <= 255) ? `${parts.slice(0, 3).join('.')}.0/24` : null;
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => g.length > 4)) return null;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '').toLowerCase()).join(':')}::/48`;
}
