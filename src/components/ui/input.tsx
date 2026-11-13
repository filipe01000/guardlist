import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'glass-field flex h-11 w-full rounded-base selection:bg-main selection:text-main-foreground px-3.5 py-2 text-sm font-medium text-foreground placeholder:text-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Input };
