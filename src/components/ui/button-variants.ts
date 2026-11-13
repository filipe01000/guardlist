import { cva } from 'class-variance-authority';

// Botões no padrão do GuardList: cantos de 8 px, sem borda grossa nem sombra deslocada.
// O amarelo (default) é a única cor de ação; as variantes antigas de cor (sky, pink, emerald)
// continuam aceitas e têm o estilo neutro.
const quiet =
  'border border-line-strong bg-transparent text-text-soft hover:not-data-disabled:bg-accent-soft hover:not-data-disabled:text-foreground';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-base text-sm font-bold transition-[background-color,color,border-color] duration-[140ms] ease-out motion-reduce:transition-none gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-main text-main-foreground hover:not-data-disabled:bg-main-hover',
        sky: quiet,
        pink: quiet,
        emerald: quiet,
        outline: quiet,
        neutral: quiet,
        destructive:
          'border border-transparent bg-destructive text-destructive-foreground hover:not-data-disabled:brightness-110',
        ghost:
          'border border-transparent bg-transparent text-text-soft hover:not-data-disabled:bg-accent-soft hover:not-data-disabled:text-foreground',
        noShadow: 'border border-transparent bg-main text-main-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-8 px-2.5 text-xs',
        sm: 'h-9 px-3.5 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
