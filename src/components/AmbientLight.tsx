import React from 'react';

// Fundo do app: a logo do GuardList grande e translúcida (vetor, nítida em qualquer tela) e as mesmas faixas de luz diagonais do login, mais apagadas, derivando devagar atrás dos painéis de vidro.
// Só CSS (transform), sem canvas; com "reduzir movimento" fica parado.
export const AmbientLight: React.FC = () => (
  <div className="ambient" aria-hidden="true">
    <img className="ambient__mark" src="/brand/guardlist-mark.svg" alt="" draggable={false} />
    <span className="ambient__streak ambient__streak--1" />
    <span className="ambient__streak ambient__streak--2" />
    <span className="ambient__streak ambient__streak--3" />
    <span className="ambient__streak ambient__streak--4" />
    <span className="ambient__streak ambient__streak--line ambient__streak--5" />
    <span className="ambient__streak ambient__streak--line ambient__streak--6" />
  </div>
);
