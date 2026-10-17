import { useEffect, useRef } from 'react';

// Fundo do app: grade de cadeados apagados que acendem perto do mouse e, de vez em quando, trancam em ciano.
const GAP = 46;
const RADIUS = 150;

interface Lock {
  x: number;
  y: number;
  glow: number;
  open: number;
  closing: boolean;
  red: boolean;
}

export default function LockGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let locks: Lock[] = [];
    let width = 0;
    let height = 0;
    let mouseX = -999;
    let mouseY = -999;
    let frame = 0;
    let lastOpen = 0;

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      locks = [];
      for (let row = 0, y = GAP / 2; y < height + GAP; row++, y += GAP) {
        for (let x = row % 2 ? GAP : GAP / 2; x < width + GAP; x += GAP) {
          locks.push({ x, y, glow: 0, open: Math.random() < 0.22 ? 1 : 0, closing: false, red: Math.random() < 0.025 });
        }
      }
    };

    const drawLock = (lock: Lock) => {
      const near = Math.max(0, 1 - Math.hypot(lock.x - mouseX, lock.y - mouseY) / RADIUS);
      const glow = Math.max(near, lock.glow);
      const alpha = 0.07 + glow * 0.55;
      const color = lock.red
        ? `rgba(248, 113, 113, ${alpha + 0.05})`
        : glow > 0.05
          ? `rgba(34, 211, 238, ${alpha})`
          : `rgba(91, 120, 150, ${alpha + 0.04})`;
      const lift = lock.open * 4;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lock.x - 5, lock.y);
      ctx.lineTo(lock.x - 5, lock.y - 3 - lift);
      ctx.arc(lock.x, lock.y - 3 - lift, 5, Math.PI, 0);
      ctx.lineTo(lock.x + 5, lock.open ? lock.y - lift - 2 : lock.y);
      ctx.stroke();
      ctx.strokeRect(lock.x - 7, lock.y, 14, 10);
      ctx.fillRect(lock.x - 1, lock.y + 3, 2, 4);
    };

    const render = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      if (document.documentElement.dataset.theme === 'light') return;
      const animate = !reduceMotion.matches;
      if (animate) {
        if (Math.random() < 0.05) {
          const lock = locks[(Math.random() * locks.length) | 0];
          if (lock && lock.open > 0.5) { lock.glow = 1; lock.closing = true; }
        }
        if (time - lastOpen > 700) {
          lastOpen = time;
          const lock = locks[(Math.random() * locks.length) | 0];
          if (lock && !lock.open && !lock.red) lock.open = 1;
        }
      }
      for (const lock of locks) {
        if (lock.closing) {
          lock.open = Math.max(0, lock.open - 0.08);
          if (!lock.open) lock.closing = false;
        }
        lock.glow *= 0.97;
        drawLock(lock);
      }
    };

    const loop = (time: number) => {
      render(time);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      if (reduceMotion.matches) render(0);
      else frame = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (reduceMotion.matches) render(0);
    };
    const onLeave = () => { mouseX = mouseY = -999; };
    const onResize = () => { build(); start(); };

    build();
    start();
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', start);
    reduceMotion.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      reduceMotion.removeEventListener('change', start);
    };
  }, []);

  return <canvas ref={canvasRef} className="lock-grid" aria-hidden="true" />;
}
