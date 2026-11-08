import React from 'react';

/**
 * Logotipo exclusivo DonutVault combinando:
 * 1. Escudo heráldico amarelo/azul-celeste com contorno cartoon escuro
 * 2. Rosquinha rosa com glacê e confeitos coloridos
 * 3. Cadeado metálico centralizado no furo da rosquinha
 */
export function DonutVaultLogo({
  size = 56,
  spinning = false,
  className = '',
}: {
  size?: number;
  spinning?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Logotipo DonutVault: Escudo, Rosquinha Rosa e Cadeado"
    >
      {/* Escudo de Segurança Externo */}
      <path
        d="M60 6L106 24V58C106 88.5 85.8 107.8 60 115C34.2 107.8 14 88.5 14 58V24L60 6Z"
        fill="#38BDF8"
        stroke="#1C1917"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M60 13L98 28V57C98 82.5 81.2 99.2 60 106C38.8 99.2 22 82.5 22 57V28L60 13Z"
        fill="#FFD90F"
        stroke="#1C1917"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Grupo da Rosquinha (pode girar no loading) */}
      <g className={spinning ? 'animate-spin-donut origin-[60px_60px]' : ''}>
        {/* Massa dourada da rosquinha */}
        <circle
          cx="60"
          cy="60"
          r="33"
          fill="#F59E0B"
          stroke="#1C1917"
          strokeWidth="4.5"
        />
        {/* Glacê Rosa com ondas cartoon */}
        <path
          d="M31 52C31 36 44 29 60 29C76 29 89 37 89 53C89 58 86 62 88 67C89 72 84 78 79 77C74 76 72 84 66 86C60 88 56 82 50 85C44 88 38 82 36 76C34 70 29 67 30 60C31 55 31 54 31 52Z"
          fill="#FF5CA8"
          stroke="#1C1917"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />

        {/* Confeitos Coloridos */}
        <rect x="44" y="38" width="9" height="4" rx="2" transform="rotate(-20 44 38)" fill="#FEF08A" stroke="#1C1917" strokeWidth="1.5" />
        <rect x="66" y="36" width="9" height="4" rx="2" transform="rotate(18 66 36)" fill="#38BDF8" stroke="#1C1917" strokeWidth="1.5" />
        <rect x="76" y="52" width="9" height="4" rx="2" transform="rotate(40 76 52)" fill="#4ADE80" stroke="#1C1917" strokeWidth="1.5" />
        <rect x="36" y="58" width="9" height="4" rx="2" transform="rotate(-35 36 58)" fill="#FFFFFF" stroke="#1C1917" strokeWidth="1.5" />
        <rect x="46" y="75" width="9" height="4" rx="2" transform="rotate(12 46 75)" fill="#FBBF24" stroke="#1C1917" strokeWidth="1.5" />
        <rect x="68" y="73" width="9" height="4" rx="2" transform="rotate(-24 68 73)" fill="#A855F7" stroke="#1C1917" strokeWidth="1.5" />

        {/* Furo central da rosquinha */}
        <circle
          cx="60"
          cy="60"
          r="12"
          fill="#FFD90F"
          stroke="#1C1917"
          strokeWidth="4"
        />
      </g>

      {/* Cadeado Central sobreposto ao centro da rosquinha */}
      <path
        d="M53 56V49C53 45.134 56.134 42 60 42C63.866 42 67 45.134 67 49V56"
        stroke="#1C1917"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M53 56V49C53 45.134 56.134 42 60 42C63.866 42 67 45.134 67 49V56"
        stroke="#E2E8F0"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="48"
        y="55"
        width="24"
        height="20"
        rx="5"
        fill="#1E293B"
        stroke="#1C1917"
        strokeWidth="3.5"
      />
      <circle cx="60" cy="63" r="3" fill="#FFD90F" />
      <path d="M60 65V70" stroke="#FFD90F" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export type MascotMood = 'happy' | 'celebrating' | 'panic' | 'thinking' | 'guard';

/**
 * Mascote Original do DonutVault: "Barnaby Rosquinha", o Pai de Família & Guardião Chefe de Senhas!
 * Design 100% autoral em estilo cartoon anos 90:
 * - Quepe azul-celeste de guarda de cofre com insígnia de rosquinha
 * - Óculos redondos expressivos, bigode simpático arredondado e bochechas coradas
 * - Gravata listrada rosa/azul e crachá "CHEFE DE COFRE"
 */
export function BarnabyMascot({
  mood = 'happy',
  size = 150,
  className = '',
}: {
  mood?: MascotMood;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`Mascote Guardião Barnaby em estado ${mood}`}
    >
      {/* Fundo circular estilo vinheta anos 90 */}
      <circle
        cx="100"
        cy="104"
        r="84"
        fill={
          mood === 'panic'
            ? '#FEE2E2'
            : mood === 'celebrating'
              ? '#DCFCE7'
              : '#E0F2FE'
        }
        stroke="#1C1917"
        strokeWidth="5"
      />

      {/* Confeitos voadores quando comemorando */}
      {mood === 'celebrating' && (
        <g>
          <rect x="28" y="42" width="12" height="6" rx="3" transform="rotate(-25 28 42)" fill="#FF5CA8" stroke="#1C1917" strokeWidth="2" />
          <rect x="160" y="38" width="12" height="6" rx="3" transform="rotate(30 160 38)" fill="#FFD90F" stroke="#1C1917" strokeWidth="2" />
          <circle cx="34" cy="95" r="5" fill="#4ADE80" stroke="#1C1917" strokeWidth="2" />
          <circle cx="168" cy="88" r="5" fill="#38BDF8" stroke="#1C1917" strokeWidth="2" />
        </g>
      )}

      {/* Gotas de suor cartoon quando em pânico (senha fraca) */}
      {mood === 'panic' && (
        <g>
          <path
            d="M36 62C36 62 28 74 32 80C36 86 44 82 42 74C40 68 36 62 36 62Z"
            fill="#38BDF8"
            stroke="#1C1917"
            strokeWidth="2.5"
          />
          <path
            d="M164 58C164 58 172 70 168 76C164 82 156 78 158 70C160 64 164 58 164 58Z"
            fill="#38BDF8"
            stroke="#1C1917"
            strokeWidth="2.5"
          />
        </g>
      )}

      {/* Corpo / Camisa Branca de Guarda com Gravata Rosa */}
      <path
        d="M46 176C50 144 68 134 100 134C132 134 150 144 154 176"
        fill="#FFFFFF"
        stroke="#1C1917"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Gola da camisa */}
      <path
        d="M74 134L92 150L100 138L108 150L126 134"
        fill="#E2E8F0"
        stroke="#1C1917"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Gravata Rosa de Guardião */}
      <path
        d="M95 144H105L109 176L100 183L91 176L95 144Z"
        fill="#FF5CA8"
        stroke="#1C1917"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* Crachá Dourado no peito */}
      <path
        d="M126 152L136 156V165C136 171 131 175 126 177C121 175 116 171 116 165V156L126 152Z"
        fill="#FFD90F"
        stroke="#1C1917"
        strokeWidth="3"
      />

      {/* Cabeça Arredondada Original Amarelo-Ouro */}
      <rect
        x="58"
        y="52"
        width="84"
        height="88"
        rx="40"
        fill="#FFD90F"
        stroke="#1C1917"
        strokeWidth="5"
      />

      {/* Orelhas arredondadas */}
      <circle cx="56" cy="98" r="10" fill="#FFD90F" stroke="#1C1917" strokeWidth="4.5" />
      <circle cx="144" cy="98" r="10" fill="#FFD90F" stroke="#1C1917" strokeWidth="4.5" />

      {/* Bochechas coradas simpáticas */}
      <ellipse cx="72" cy="108" rx="7" ry="4.5" fill="#FB7185" opacity="0.65" />
      <ellipse cx="128" cy="108" rx="7" ry="4.5" fill="#FB7185" opacity="0.65" />

      {/* Óculos Redondos de Inspetor de Cofre */}
      <circle cx="82" cy="88" r="15" fill="#FFFFFF" stroke="#1C1917" strokeWidth="4.5" />
      <circle cx="118" cy="88" r="15" fill="#FFFFFF" stroke="#1C1917" strokeWidth="4.5" />
      <path d="M97 88H103" stroke="#1C1917" strokeWidth="4.5" />

      {/* Pupilas expressivas conforme o humor */}
      {mood === 'panic' ? (
        <>
          <circle cx="82" cy="88" r="3" fill="#1C1917" />
          <circle cx="118" cy="88" r="3" fill="#1C1917" />
          {/* Sobrancelhas arqueadas de susto */}
          <path d="M68 68L92 74" stroke="#1C1917" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M132 68L108 74" stroke="#1C1917" strokeWidth="4.5" strokeLinecap="round" />
        </>
      ) : mood === 'thinking' ? (
        <>
          <circle cx="85" cy="84" r="5" fill="#1C1917" />
          <circle cx="121" cy="84" r="5" fill="#1C1917" />
          <path d="M68 70Q82 64 92 71" stroke="#1C1917" strokeWidth="4" strokeLinecap="round" />
          <path d="M108 73H130" stroke="#1C1917" strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="83" cy="88" r="5.5" fill="#1C1917" />
          <circle cx="85" cy="86" r="2" fill="#FFFFFF" />
          <circle cx="119" cy="88" r="5.5" fill="#1C1917" />
          <circle cx="121" cy="86" r="2" fill="#FFFFFF" />
        </>
      )}

      {/* Nariz arredondado cartoon */}
      <ellipse cx="100" cy="99" rx="7" ry="5.5" fill="#F59E0B" stroke="#1C1917" strokeWidth="3.5" />

      {/* Bigode Farto e Simpático (identidade própria do Guardião Barnaby) */}
      <path
        d="M72 114C74 106 89 105 100 111C111 105 126 106 128 114C130 120 115 122 100 117C85 122 70 120 72 114Z"
        fill="#78350F"
        stroke="#1C1917"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Boca expressiva */}
      {mood === 'panic' ? (
        <ellipse cx="100" cy="127" rx="9" ry="7" fill="#991B1B" stroke="#1C1917" strokeWidth="3.5" />
      ) : mood === 'thinking' ? (
        <path d="M92 126H110" stroke="#1C1917" strokeWidth="4" strokeLinecap="round" />
      ) : (
        <path
          d="M86 121C90 131 110 131 114 121"
          fill="#EF4444"
          stroke="#1C1917"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      )}

      {/* Quepe Azul-Celeste de Guarda de Cofre com Insígnia de Rosquinha */}
      <path
        d="M52 58C52 34 72 22 100 22C128 22 148 34 148 58H52Z"
        fill="#0EA5E9"
        stroke="#1C1917"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      {/* Aba escura do quepe */}
      <path
        d="M46 56H154C154 64 132 68 100 68C68 68 46 64 46 56Z"
        fill="#1E293B"
        stroke="#1C1917"
        strokeWidth="4.5"
      />
      {/* Mini Rosquinha Rosa no Quepe */}
      <circle cx="100" cy="41" r="10" fill="#FF5CA8" stroke="#1C1917" strokeWidth="3" />
      <circle cx="100" cy="41" r="3.5" fill="#FFD90F" stroke="#1C1917" strokeWidth="2" />

      {/* Rosquinha mordida na mão quando feliz ou comemorando */}
      {(mood === 'happy' || mood === 'celebrating') && (
        <g transform="translate(132, 128)">
          <circle cx="24" cy="24" r="20" fill="#F59E0B" stroke="#1C1917" strokeWidth="4" />
          <circle cx="24" cy="24" r="16" fill="#FF5CA8" stroke="#1C1917" strokeWidth="3" />
          <circle cx="24" cy="24" r="6" fill="#E0F2FE" stroke="#1C1917" strokeWidth="3" />
          {/* Mordida cartoon */}
          <circle cx="39" cy="12" r="8" fill={mood === 'celebrating' ? '#DCFCE7' : '#E0F2FE'} />
        </g>
      )}
    </svg>
  );
}

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
