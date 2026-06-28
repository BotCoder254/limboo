/**
 * Centered empty-state placeholder shown wherever there is no data yet.
 *
 * Modern, minimal look: a large, *background-less* icon (no border, no surface
 * box, no gradient — per the dark-only theme rule) sitting directly on the
 * canvas, with a clear title, optional description, and one or more actions.
 */
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/renderer/lib/cn';

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  /** Single primary action (kept for backward compatibility). */
  action?: ReactNode;
  /** Multiple actions, rendered in a centered row. Takes precedence layout-wise. */
  actions?: ReactNode;
  className?: string;
  /** Tighter spacing + smaller icon for narrow panels (drawers, sidebars). */
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actions,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-3 py-10' : 'gap-4 py-16',
        className,
      )}
    >
      {Icon && (
        // Background-less: the glyph renders straight onto the canvas, large and
        // legible, in a faint tone so it never competes with the copy.
        <Icon
          size={compact ? 32 : 52}
          className="text-faint"
        />
      )}
      <div className="flex flex-col gap-1.5">
        <span className={cn('font-medium text-fg', compact ? 'text-[13px]' : 'text-sm')}>
          {title}
        </span>
        {description && (
          <span className="max-w-[26rem] text-[12px] leading-relaxed text-muted">
            {description}
          </span>
        )}
      </div>
      {(actions || action) && (
        <div className="mt-1 flex items-center justify-center gap-2">
          {actions ?? action}
        </div>
      )}
    </div>
  );
}
