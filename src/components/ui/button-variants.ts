import { cva } from 'class-variance-authority';

const raisedPress =
  'shadow-shadow hover:not-data-disabled:translate-x-pressX hover:not-data-disabled:translate-y-pressY hover:not-data-disabled:shadow-press active:not-data-disabled:translate-x-boxShadowX active:not-data-disabled:translate-y-boxShadowY active:not-data-disabled:shadow-none';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-base text-sm font-extrabold transition-[translate,box-shadow,background-color,color] duration-[140ms] ease-out motion-reduce:transition-none gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: `text-main-foreground bg-main border-3 border-border ${raisedPress}`,
        sky: `text-sky-foreground bg-sky border-3 border-border ${raisedPress}`,
        pink: `text-pink-foreground bg-pink border-3 border-border ${raisedPress}`,
        emerald: `text-white bg-emerald-500 border-3 border-border ${raisedPress}`,
        outline: `bg-background text-foreground border-3 border-border ${raisedPress}`,
        neutral: `bg-secondary-background text-foreground border-3 border-border ${raisedPress}`,
        destructive: `bg-destructive text-destructive-foreground border-3 border-border ${raisedPress}`,
        ghost:
          'border-3 border-transparent bg-transparent text-foreground hover:border-border hover:bg-main hover:text-main-foreground',
        noShadow: 'text-main-foreground bg-main border-3 border-border',
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
