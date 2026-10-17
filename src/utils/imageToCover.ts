// Reduz uma imagem (arquivo ou data URL) para a capa do cliente: no máximo 640×360, em WebP.
// Fundo branco por baixo, para logos com transparência ficarem iguais nos dois temas.
export async function imageToCover(source: Blob | string, max = { w: 640, h: 360 }): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      el.src = url;
    });
    const w0 = img.naturalWidth || 256;
    const h0 = img.naturalHeight || 256;
    const scale = Math.min(1, max.w / w0, max.h / h0);
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador sem suporte a imagens.');
    // Mantém a transparência da logo: a capa do card é translúcida e combina com os dois temas.
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of [0.86, 0.74, 0.6]) {
      const data = canvas.toDataURL('image/webp', quality);
      if (data.startsWith('data:image/webp') && data.length < 380_000) return data;
    }
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}
