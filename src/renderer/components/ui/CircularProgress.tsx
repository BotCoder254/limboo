/**
 * Determinate circular progress ring — the visual counterpart to {@link Spinner}.
 * Shares the same palette (faint `--color-line-strong` track + bright
 * `--color-accent` arc) and SVG approach so it stays crisp at any size. Driven by
 * a 0–100 `value`; the arc length is `value`% of the circumference. Honors
 * reduced-motion automatically (the transition is purely cosmetic).
 *
 * Optionally renders a centered `%` label (used in the Workspace settings view).
 */
import { cn } from '@/renderer/lib/cn';

export function CircularProgress({
  value,
  size = 16,
  showLabel = false,
  className,
  children,
}: {
  /** Progress 0–100. Values are clamped. */
  value: number;
  size?: number;
  /** Render the rounded percentage in the center (best at size ≥ 32). */
  showLabel?: boolean;
  className?: string;
  /** Custom centered content (e.g. a phase icon) — overrides `showLabel`. */
  children?: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const stroke = Math.max(2, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        {/* Faint track */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-line-strong)" strokeWidth={stroke} />
        {/* Accent progress arc — starts at 12 o'clock, sweeps clockwise */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 120ms ease-out' }}
        />
      </svg>
      {children != null ? (
        <span className="absolute inline-flex items-center justify-center">{children}</span>
      ) : (
        showLabel && (
          <span className="absolute font-mono text-[9px] font-semibold text-muted">
            {Math.round(pct)}
          </span>
        )
      )}
    </span>
  );
}
