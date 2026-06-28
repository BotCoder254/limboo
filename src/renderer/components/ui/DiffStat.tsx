/**
 * Compact `+adds / -dels` diff summary. Additions use `text-success`, deletions
 * `text-danger` — the shared visual language for change counts across the app.
 */
import { cn } from '@/renderer/lib/cn';

export function DiffStat({
  adds,
  dels,
  className,
}: {
  adds: number;
  dels: number;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-1.5 font-mono text-[11px]', className)}>
      <span className="text-success">+{adds}</span>
      <span className="text-danger">-{dels}</span>
    </span>
  );
}
