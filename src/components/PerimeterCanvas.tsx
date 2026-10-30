import React, { useEffect, useRef } from 'react';

export interface PerimeterEvent {
  address: string;
  blocked: boolean;
  reason: string;
}

interface PerimeterCanvasProps {
  // Muda de valor a cada senha recusada: os anéis piscam em vermelho.
  alarmKey: number;
  // Senha aceita: os anéis se fecham num círculo e o feixe acelera.
  sealing: boolean;
  onEvent?: (event: PerimeterEvent) => void;
}

const BLOCK_REASONS = ['varredura de portas', 'força bruta SSH', 'login no VPN', 'exploração web', 'botnet', 'nó de saída Tor'];
const PASS_REASONS = ['serviço legítimo', 'parceiro na exceção', 'CDN conhecida'];
// Só faixas reservadas para documentação (RFC 5737): nenhum endereço real aparece na tela.
const DOC_NETS = ['203.0.113.', '198.51.100.', '192.0.2.'];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const fakeAddress = () => pick(DOC_NETS) + Math.floor(Math.random() * 250 + 2);

// Anéis segmentados: raio e espessura relativos ao raio base, quantidade de segmentos, lacuna e velocidade.
// As cores vêm da paleta ativa (variáveis CSS).
const RINGS = [
  { r: 1.0, w: 0.17, segs: 5, gap: 0.16, speed: 0.06, c0: '--pal-ring-1a', c1: '--pal-ring-1b' },
  { r: 0.74, w: 0.11, segs: 4, gap: 0.22, speed: -0.1, c0: '--pal-ring-2a', c1: '--pal-ring-2b' },
  { r: 0.56, w: 0.03, segs: 24, gap: 0.45, speed: 0.18, c0: '--pal-hot', c1: '--pal-accent' }
];

interface Particle { a: number; d: number; v: number; blocked: boolean; address: string; trail: [number, number][] }
interface Spark { x: number; y: number; vx: number; vy: number; life: number }
interface Hit { a: number; life: number; blocked: boolean }

// Perímetro animado da tela de entrada: a logo no centro, anéis de proteção girando e ameaças barradas na borda.
export const PerimeterCanvas: React.FC<PerimeterCanvasProps> = ({ alarmKey, sealing, onEvent }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ sealing, alarm: 0, onEvent });

  live.current.sealing = sealing;
  live.current.onEvent = onEvent;

  useEffect(() => {
    if (alarmKey > 0) live.current.alarm = 1;
  }, [alarmKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const palette = (name: string) => css.getPropertyValue(name).trim();
    const hot = palette('--pal-hot-rgb');
    const accent = palette('--pal-accent-rgb');
    const dot = palette('--pal-dot-rgb');
    const deep = palette('--pal-deep-rgb');
    const glint = palette('--pal-glint');
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const logo = new Image();
    logo.src = '/brand/guardlist-mark.svg';

    let W = 0, H = 0, cx = 0, cy = 0, R = 0;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const dots = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * Math.PI * 2 }));
    const particles: Particle[] = [];
    const sparks: Spark[] = [];
    const hits: Hit[] = [];
    const t0 = performance.now();
    let last = t0;
    let spawnAcc = 0;
    let seal = 0;
    let spin = 1;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Layout empilhado (celular): perímetro centralizado acima do formulário.
      // Lado a lado: o centro fica junto da borda do painel, e os anéis seguem por trás do vidro.
      const narrow = window.matchMedia('(max-width: 900px)').matches;
      cx = W * (narrow ? 0.5 : 0.49);
      cy = H * (narrow ? 0.7 : 0.56);
      R = narrow ? Math.min(H * 0.2, W * 0.34) : Math.min(H * 0.34, W * 0.21);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      mouse.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointer);

    const spawn = () => {
      particles.push({
        a: Math.random() * Math.PI * 2,
        d: Math.hypot(W, H) * 0.7,
        v: 220 + Math.random() * 160,
        blocked: Math.random() < 0.82,
        address: fakeAddress(),
        trail: []
      });
    };

    const frame = (now: number) => {
      const state = live.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduce ? 4 : (now - t0) / 1000;
      const ease = reduce ? 1 : 1 - Math.pow(1 - Math.min(1, t / 1.8), 3);

      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      const ox = cx + (reduce ? 0 : mouse.x * 18);
      const oy = cy + (reduce ? 0 : mouse.y * 14);

      if (state.sealing) seal = reduce ? 1 : Math.min(1, seal + dt * 1.4);
      else seal = 0;
      state.alarm = Math.max(0, state.alarm - dt * 1.6);
      spin += ((state.sealing ? 7 : 1) - spin) * 0.04;

      ctx.clearRect(0, 0, W, H);

      // Rede de pontos: o "lado de fora" do perímetro.
      for (const d of dots) {
        const x = d.x * W, y = d.y * H;
        const near = Math.hypot(x - ox, y - oy) / (R * 2.2);
        const alpha = 0.1 + 0.25 * Math.max(0, Math.sin(t * 0.8 + d.p)) * Math.min(1, near);
        ctx.fillStyle = `rgba(${dot}, ${alpha})`;
        ctx.fillRect(x, y, 1.6, 1.6);
      }

      const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 1.6);
      halo.addColorStop(0, `rgba(${accent}, ${0.2 + seal * 0.35})`);
      halo.addColorStop(0.5, `rgba(${deep}, 0.08)`);
      halo.addColorStop(1, `rgba(${deep}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ox, oy, R * 1.6, 0, Math.PI * 2); ctx.fill();

      // Régua externa com marcações.
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(t * 0.03 * spin);
      ctx.strokeStyle = `rgba(${hot}, 0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.28, 0, Math.PI * 2 * ease); ctx.stroke();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const outer = R * (long ? 1.36 : 1.32);
        ctx.strokeStyle = `rgba(${hot}, ${long ? 0.5 : 0.18})`;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 1.28, Math.sin(a) * R * 1.28);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.stroke();
      }
      ctx.restore();

      // Feixe de radar.
      if (!reduce && 'createConicGradient' in ctx) {
        const sweep = ctx.createConicGradient(t * 1.1 * spin, ox, oy);
        sweep.addColorStop(0, `rgba(${hot}, 0)`);
        sweep.addColorStop(0.86, `rgba(${hot}, 0)`);
        sweep.addColorStop(0.995, `rgba(${hot}, 0.22)`);
        sweep.addColorStop(1, `rgba(${hot}, 0)`);
        ctx.fillStyle = sweep;
        ctx.beginPath(); ctx.arc(ox, oy, R * 1.26, 0, Math.PI * 2); ctx.fill();
      }

      // Anéis: as lacunas somem ao selar.
      RINGS.forEach((ring, i) => {
        const rr = R * ring.r;
        const rot = t * ring.speed * spin + i;
        const gap = ring.gap * (1 - seal);
        const segA = (Math.PI * 2) / ring.segs;
        const g = ctx.createLinearGradient(ox - rr, oy - rr, ox + rr, oy + rr);
        g.addColorStop(0, state.alarm > 0 ? `rgba(251, 113, 133, ${0.6 + state.alarm * 0.4})` : palette(ring.c0));
        g.addColorStop(1, palette(ring.c1));
        ctx.strokeStyle = g;
        ctx.lineWidth = R * ring.w;
        ctx.lineCap = 'butt';
        ctx.shadowColor = seal > 0 ? `rgba(${hot}, 0.9)` : `rgba(${accent}, 0.35)`;
        ctx.shadowBlur = 18 + seal * 30;
        for (let s = 0; s < ring.segs; s++) {
          const start = rot + s * segA + segA * gap * 0.5;
          ctx.beginPath(); ctx.arc(ox, oy, rr, start, start + segA * (1 - gap) * ease); ctx.stroke();
        }
      });
      ctx.shadowBlur = 0;

      // Clarões onde a ameaça bateu.
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i];
        h.life -= dt * 1.4;
        if (h.life <= 0) { hits.splice(i, 1); continue; }
        const spread = 0.12 + (1 - h.life) * 0.1;
        ctx.strokeStyle = h.blocked ? `rgba(251, 113, 133, ${h.life})` : `rgba(${hot}, ${h.life * 0.8})`;
        ctx.lineWidth = R * 0.17 * (0.5 + h.life * 0.5);
        ctx.shadowColor = h.blocked ? 'rgba(244, 63, 94, 0.9)' : `rgba(${accent}, 0.9)`;
        ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(ox, oy, R, h.a - spread, h.a + spread); ctx.stroke();
        ctx.shadowBlur = 0;
      }

      if (!reduce && !state.sealing) {
        spawnAcc += dt;
        if (spawnAcc > 0.55) {
          spawnAcc = 0;
          spawn();
          if (Math.random() < 0.4) spawn();
        }
      }
      if (state.sealing) particles.length = 0;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.d -= p.v * dt;
        const x = ox + Math.cos(p.a) * p.d;
        const y = oy + Math.sin(p.a) * p.d;
        p.trail.push([x, y]);
        if (p.trail.length > 14) p.trail.shift();
        // Bloqueadas param no anel externo; liberadas chegam perto do núcleo.
        if (p.d <= (p.blocked ? R * 1.09 : R * 0.42)) {
          hits.push({ a: p.a, life: p.blocked ? 1 : 0.6, blocked: p.blocked });
          if (p.blocked) {
            for (let k = 0; k < 14; k++) {
              const sa = p.a + Math.PI + (Math.random() - 0.5) * 1.6;
              const sv = 60 + Math.random() * 160;
              sparks.push({ x, y, vx: Math.cos(sa) * sv, vy: Math.sin(sa) * sv, life: 1 });
            }
          }
          state.onEvent?.({ address: p.address, blocked: p.blocked, reason: pick(p.blocked ? BLOCK_REASONS : PASS_REASONS) });
          particles.splice(i, 1);
          continue;
        }
        ctx.lineCap = 'round';
        for (let k = 1; k < p.trail.length; k++) {
          const a = k / p.trail.length;
          ctx.strokeStyle = p.blocked ? `rgba(251, 146, 160, ${a * 0.8})` : `rgba(${hot}, ${a * 0.8})`;
          ctx.lineWidth = 2.2 * a;
          ctx.beginPath(); ctx.moveTo(p.trail[k - 1][0], p.trail[k - 1][1]); ctx.lineTo(p.trail[k][0], p.trail[k][1]); ctx.stroke();
        }
        ctx.fillStyle = p.blocked ? '#fecdd3' : glint;
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt * 2.2;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94;
        ctx.fillStyle = `rgba(254, 205, 211, ${s.life})`;
        ctx.fillRect(s.x, s.y, 2, 2);
      }

      // Núcleo: a logo.
      if (logo.complete && logo.naturalWidth) {
        const lw = R * 0.62 * (0.85 + ease * 0.15) * (1 + seal * 0.08);
        const lh = lw * (740 / 640);
        ctx.save();
        ctx.globalAlpha = ease;
        ctx.shadowColor = `rgba(${accent}, 0.6)`;
        ctx.shadowBlur = 30 + seal * 40;
        ctx.drawImage(logo, ox - lw / 2, oy - lh / 2, lw, lh);
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="gl-perimeter" aria-hidden="true" />;
};
