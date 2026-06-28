/**
 * Limboo brand mark. A single, solid-color lucide `Orbit` glyph — a core with
 * orbiting bodies, evoking one workspace orchestrating many agents/sessions.
 *
 * Per the product's visual rules: no background, no gradients, solid color only.
 * `tone` maps to a theme token so the mark stays on-palette everywhere.
 */
import { Orbit } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';

type Tone = 'accent' | 'fg' | 'muted';

const TONE: Record<Tone, string> = {
  accent: 'text-accent',
  fg: 'text-fg',
  muted: 'text-muted',
};

export function Logo({
  size = 18,
  tone = 'accent',
  className,
}: {
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return <Orbit size={size} strokeWidth={1.75} className={cn(TONE[tone], className)} />;
}

/** Logo + wordmark lockup used in the title bar. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="text-[13px] font-semibold tracking-tight text-fg">Limboo</span>
    </span>
  );
}
