/**
 * Five-bar radial spinner for session "agent run in flight" indicators. Uses
 * staggered `animate-spin` layers; honors reduced-motion via the global
 * stylesheet when `data-reduced-motion="true"` is set on <html>.
 */
import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/cn';

interface SessionSpinnerProps extends ComponentProps<'div'> {
  size?: number;
  invert?: boolean;
  disabled?: boolean;
}

export function SessionSpinner({
  size = 16,
  invert,
  disabled,
  className,
  ...props
}: SessionSpinnerProps) {
  if (disabled) return null;

  const sizePx = `${size}px`;
  const barWidth = `${(size * 0.2).toFixed(2)}px`;
  const barHeight = `${(size * 0.075).toFixed(2)}px`;

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('relative inline-block', className)}
      style={{ width: sizePx, height: sizePx }}
      {...props}
    >
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute inset-0 flex animate-spin justify-center"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div
            style={{
              backgroundColor: invert ? 'var(--color-base)' : 'var(--color-accent)',
              width: barWidth,
              height: barHeight,
              borderRadius: '9999px',
            }}
          />
        </div>
      ))}
    </div>
  );
}
