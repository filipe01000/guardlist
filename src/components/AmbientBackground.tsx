import type { ReactNode } from 'react';

// Fundo do app: pontinhos de gibi, a marca grande e translúcida e as faixas de luz diagonais que
// derivam devagar atrás dos painéis de vidro. Só CSS; com "reduzir movimento" fica parado.
export function AmbientBackground({ mark }: { mark?: ReactNode }) {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="ambient__halftone" />
      {mark ? <span className="ambient__mark">{mark}</span> : null}
      <span className="ambient__streak ambient__streak--1" />
      <span className="ambient__streak ambient__streak--2" />
      <span className="ambient__streak ambient__streak--3" />
      <span className="ambient__streak ambient__streak--4" />
      <span className="ambient__streak ambient__streak--line ambient__streak--5" />
      <span className="ambient__streak ambient__streak--line ambient__streak--6" />
    </div>
  );
}
