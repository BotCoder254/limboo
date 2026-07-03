/**
 * Square, icon-only button used throughout the chrome (title bar, panel
 * headers, rail). Accessible by default via the required `label`.
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/renderer/lib/cn';

type Size = 'sm' | 'md';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  children: ReactNode;
  size?: Size;
  active?: boolean;
}

const SIZE: Record<Size, string> = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, children, size = 'md', active = false, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40',
        SIZE[size],
        active
          ? 'bg-surface-2 text-fg'
          : 'text-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = 'IconButton';
