import QRCode from 'qrcode';

// QR code do cadastro com a cara do GuardList: módulos arredondados, olhos com o centro ciano e o escudo
// no meio. A correção de erro no nível H (até 30%) cobre com folga a área que a logo esconde.

const INK = '#0b1a33';
const EYE = '#0e7490';
const MARGIN = 2;

// Quadrado central reservado para a logo: ~22% do lado, com a mesma paridade do código para ficar centrado.
export function logoArea(size: number): { start: number; span: number } {
  let span = Math.round(size * 0.22);
  if (span % 2 !== size % 2) span -= 1;
  return { start: (size - span) / 2, span };
}

// Escudo do public/brand/guardlist-mark.svg, sem o brilho (some nesse tamanho). IDs próprios para não colidir.
const MARK = `<defs><linearGradient id="glqr-l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d90bb"/><stop offset="1" stop-color="#4a6d98"/></linearGradient><linearGradient id="glqr-r" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#58799f"/><stop offset="1" stop-color="#3d5e86"/></linearGradient><linearGradient id="glqr-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eeaff"/><stop offset="1" stop-color="#14c8ec"/></linearGradient></defs><path d="M310 0 L0 140 L0 520 C40 612 150 690 310 740 Z" fill="url(#glqr-l)"/><path d="M330 0 L640 140 L640 520 C600 612 490 690 330 740 Z" fill="url(#glqr-r)"/><rect x="186" y="266" width="268" height="208" rx="14" fill="#08111f"/><g fill="url(#glqr-b)"><rect x="220" y="298" width="200" height="36" rx="5"/><rect x="220" y="352" width="200" height="36" rx="5"/><rect x="220" y="406" width="200" height="36" rx="5"/></g>`;

export function brandedQrSvg(text: string): string {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: 'H' }).modules;
  const { start, span } = logoArea(size);
  const isEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
  const inLogo = (r: number, c: number) => r >= start && r < start + span && c >= start && c < start + span;

  const dots: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c] && !isEye(r, c) && !inLogo(r, c)) dots.push(`<use href="#glqr-m" x="${c + MARGIN}" y="${r + MARGIN}"/>`);
    }
  }
  const eye = (r: number, c: number) => {
    const x = c + MARGIN;
    const y = r + MARGIN;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="${INK}"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${EYE}"/>`;
  };
  const full = size + MARGIN * 2;
  const pad = 0.9;
  const logo = `<svg class="gl-qr-logo" x="${start + MARGIN + pad}" y="${start + MARGIN + pad}" width="${span - pad * 2}" height="${span - pad * 2}" viewBox="0 0 640 740" preserveAspectRatio="xMidYMid meet">${MARK}</svg>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="geometricPrecision"><defs><rect id="glqr-m" width="1" height="1" rx="0.32" fill="${INK}"/></defs><rect width="${full}" height="${full}" fill="#fff"/>${dots.join('')}${eye(0, 0)}${eye(0, size - 7)}${eye(size - 7, 0)}${logo}</svg>`;
}
