/**
 * Small pill badge (e.g. unread counts). Solid, on-palette tones only.
 */
import type { ReactNode } from 'react';
import { cn } from '@/renderer/lib/cn';

type Tone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  accent: 'bg-accent text-base',
  neutral: 'bg-surface-2 text-muted',
  success: 'bg-success text-base',
  warning: 'bg-warning text-base',
  danger: 'bg-danger text-base',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
