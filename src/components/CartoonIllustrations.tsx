import React from 'react';

/**
 * Ilustração de Cofre Cartoon Abrindo com Rosquinha Dourada Brilhante
 */
export function CartoonVaultDoor({
  isOpen = false,
  size = 110,
}: {
  isOpen?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={isOpen ? 'Cofre aberto' : 'Cofre blindado fechado'}
    >
      {/* Corpo externo do cofre */}
      <rect
        x="14"
        y="16"
        width="112"
        height="108"
        rx="22"
        fill="#334155"
        stroke="#1C1917"
        strokeWidth="5"
      />
      <rect
        x="24"
        y="26"
        width="92"
        height="88"
        rx="14"
        fill={isOpen ? '#FEF08A' : '#64748B'}
        stroke="#1C1917"
        strokeWidth="4"
      />

      {isOpen ? (
        /* Interior brilhante com rosquinha protegida */
        <g>
          <circle cx="70" cy="70" r="26" fill="#FF5CA8" stroke="#1C1917" strokeWidth="4" />
          <circle cx="70" cy="70" r="9" fill="#FEF08A" stroke="#1C1917" strokeWidth="3.5" />
          <path d="M70 30V38M70 102V110M30 70H38M102 70H110" stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" />
        </g>
      ) : (
        /* Volante giratório de aço do cofre fechado */
        <g>
          <circle cx="70" cy="70" r="24" fill="#CBD5E1" stroke="#1C1917" strokeWidth="4.5" />
          <path d="M70 46V94M46 70H94" stroke="#1C1917" strokeWidth="5" strokeLinecap="round" />
          <circle cx="70" cy="70" r="9" fill="#FFD90F" stroke="#1C1917" strokeWidth="3.5" />
        </g>
      )}
    </svg>
  );
}
