/**
 * The pre-first-token placeholder for an assistant turn. Instead of an
 * indefinite spinner, it reserves the approximate shape of the forthcoming
 * reply — a few shimmer text lines of varying width plus one anticipated
 * code-region block — so the layout stays stable and the interface feels
 * responsive the instant a prompt is sent. It dissolves (fades out) the moment
 * the first streamed token arrives and the real Markdown takes over.
 *
 * On-theme: the shimmer sweeps the surface-2 → elevated ramp (see
 * `animate-shimmer` in styles/index.css) and is neutralized automatically under
 * reduced-motion via the global `html[data-reduced-motion]` rule.
 */
import { cn } from '@/renderer/lib/cn';

/** A single shimmer bar; width drives the ragged, text-like silhouette. */
function Line({ className }: { className?: string }) {
  return <div className={cn('h-3 rounded animate-shimmer', className)} />;
}

export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 py-1 animate-fade-in" aria-label="Assistant is responding" aria-busy>
      <Line className="w-[92%]" />
      <Line className="w-[78%]" />
      <Line className="w-[85%]" />

      {/* Anticipated code region — matches the rounded surface a fenced block
          will occupy, so the dissolve into real content doesn't shift layout. */}
      <div className="mt-1.5 overflow-hidden rounded-md border border-line bg-surface-2/60">
        <div className="flex h-7 items-center gap-2 border-b border-line px-3">
          <div className="h-2.5 w-12 rounded animate-shimmer" />
        </div>
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <Line className="h-2.5 w-[60%]" />
          <Line className="h-2.5 w-[72%]" />
          <Line className="h-2.5 w-[48%]" />
        </div>
      </div>

      <Line className="mt-1 w-[66%]" />
    </div>
  );
}

/**
 * Compact single-line shimmer for mid-turn gaps — the run is active but no text
 * is streaming and no tool is running (between a tool ending and the next
 * token). Deliberately quieter than the full skeleton so it reads as "still
 * working", not "new reply". The fade-in is delayed slightly so a sub-150ms gap
 * between consecutive events never flashes it.
 */
export function ThinkingPulse() {
  return (
    <div
      className="py-0.5 animate-fade-in"
      style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}
      aria-label="Working"
      aria-busy
    >
      <Line className="w-[34%]" />
    </div>
  );
}
