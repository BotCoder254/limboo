/**
 * Shared primary/secondary action button for the workspace surfaces (launcher,
 * drop zone, switcher). One definition keeps sizing and styling consistent
 * everywhere — larger, comfortable targets, token-only colors (no gradients, no
 * off-palette hex, per the dark-only theme rule).
 */
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/renderer/lib/cn';

interface WorkspaceActionButtonProps {
  icon: ComponentType<{ size?: number }>;
  children: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  /** `lg` gives the roomier, higher-emphasis target used on the launcher hero. */
  size?: 'md' | 'lg';
  /** Stretch to fill its container (used for stacked, narrow-width layouts). */
  fullWidth?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}

export function WorkspaceActionButton({
  icon: Icon,
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  type = 'button',
  disabled = false,
  className,
}: WorkspaceActionButtonProps) {
  const lg = size === 'lg';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center font-medium transition-colors active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50',
        lg ? 'gap-2.5 rounded-xl px-6 py-3 text-[15px]' : 'gap-2 rounded-lg px-4 py-2 text-[13px]',
        fullWidth && 'w-full',
        variant === 'primary'
          ? 'bg-accent text-base font-semibold transition-opacity hover:opacity-90'
          : 'border border-line bg-surface-2 text-fg hover:border-line-strong',
        className,
      )}
    >
      <Icon size={lg ? 18 : 16} />
      {children}
    </button>
  );
}
