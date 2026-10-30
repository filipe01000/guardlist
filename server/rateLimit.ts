import type { RequestHandler } from 'express';

// Limite simples em janela fixa, para proteger a cota das APIs de CTI e o login. Depois do login a conta é
// por usuário (a equipe toda pode sair pela mesma internet da empresa); antes, por IP.
// Toda resposta informa o limite nos cabeçalhos RateLimit-*, para clientes e agentes se ajustarem sozinhos.
export function rateLimit(name: string, maxPerWindow: number, windowMs = 60_000): RequestHandler {
  const hits = new Map<string, { windowStart: number; count: number }>();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.windowStart < cutoff) hits.delete(key);
  }, 60_000).unref();

  return (req, res, next) => {
    const key = res.locals.userId ? `user:${res.locals.userId}` : `ip:${req.ip || 'unknown'}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { windowStart: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    const reset = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    res.setHeader('RateLimit-Limit', String(maxPerWindow));
    res.setHeader('RateLimit-Remaining', String(Math.max(maxPerWindow - entry.count, 0)));
    res.setHeader('RateLimit-Reset', String(reset));
    if (entry.count <= maxPerWindow) return next();
    res.setHeader('Retry-After', String(reset));
    return res.status(429).json({ error: `Muitas tentativas (${name}). Tente novamente em ${reset}s.` });
  };
}
