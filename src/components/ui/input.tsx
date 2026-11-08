import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full rounded-base border-3 border-input bg-background selection:bg-main selection:text-main-foreground px-3.5 py-2 text-sm font-semibold text-foreground shadow-[2px_2px_0px_0px_var(--border)] placeholder:text-stone-500 dark:placeholder:text-slate-400 focus-visible:border-border focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input };
