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
  className?: string;
}

export function WorkspaceActionButton({
  icon: Icon,
  children,
  onClick,
  variant = 'secondary',
  className,
}: WorkspaceActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors active:scale-[0.99]',
        variant === 'primary'
          ? 'bg-accent text-base font-semibold transition-opacity hover:opacity-90'
          : 'border border-line bg-surface-2 text-fg hover:border-line-strong',
        className,
      )}
    >
      <Icon size={16} />
      {children}
    </button>
  );
}
