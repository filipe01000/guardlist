// Prepara a imagem de capa do cliente: corta as sobras de fundo em volta da logo (para todas
// ficarem do mesmo tamanho visual), reduz para no máximo 640×360 e grava em WebP.
// Mantém a transparência e a cor de fundo original da logo.

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    el.src = url;
  });
}

/** Caixa do conteúdo: pixels que diferem da cor do canto (fundo), com uma pequena margem. */
function contentBox(data: Uint8ClampedArray, w: number, h: number) {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corner = at(1, 1);
  const bg = [data[corner], data[corner + 1], data[corner + 2], data[corner + 3]];
  const differs = (i: number) =>
    Math.abs(data[i + 3] - bg[3]) > 40 ||
    (data[i + 3] > 40 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!differs(at(x, y))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, w: Math.min(w, x1 + pad + 1) - x, h: Math.min(h, y1 + pad + 1) - y };
}

export async function imageToCover(source: Blob | string, max = { w: 640, h: 360 }): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    // 1. Desenha num tamanho de trabalho e encontra onde está a logo.
    const work = Math.min(1, 1200 / Math.max(img.naturalWidth || 256, img.naturalHeight || 256));
    const ww = Math.max(1, Math.round((img.naturalWidth || 256) * work));
    const wh = Math.max(1, Math.round((img.naturalHeight || 256) * work));
    const scratch = document.createElement('canvas');
    scratch.width = ww;
    scratch.height = wh;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('Navegador sem suporte a imagens.');
    sctx.drawImage(img, 0, 0, ww, wh);
    const box = ww > 4 && wh > 4 ? contentBox(sctx.getImageData(0, 0, ww, wh).data, ww, wh) : { x: 0, y: 0, w: ww, h: wh };

    // 2. Recorta a caixa e reduz para o tamanho final.
    const scale = Math.min(1, max.w / box.w, max.h / box.h);
    const w = Math.max(1, Math.round(box.w * scale));
    const h = Math.max(1, Math.round(box.h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador sem suporte a imagens.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scratch, box.x, box.y, box.w, box.h, 0, 0, w, h);
    for (const quality of [0.9, 0.8, 0.65]) {
      const data = canvas.toDataURL('image/webp', quality);
      if (data.startsWith('data:image/webp') && data.length < 380_000) return data;
    }
    return canvas.toDataURL('image/png');
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

/**
 * Cor de fundo para a capa: a do canto da logo; se a logo for transparente, branco quando ela é
 * escura (para aparecer) e null (azul-marinho do card) quando ela é clara.
 */
export function coverBackground(img: HTMLImageElement): string | null {
  try {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const [r, g, b, a] = data;
    if (a >= 200) return `rgb(${r} ${g} ${b})`;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      count++;
    }
    return count && sum / count < 0.6 ? 'rgb(255 255 255)' : null;
  } catch {
    return null;
  }
}
