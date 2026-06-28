/**
 * Modern indeterminate spinner: a faint full ring with a brighter accent arc
 * sweeping around it. SVG-based so the arc stays crisp at any size. Honors
 * reduced-motion automatically — the global stylesheet neutralizes `animate-spin`
 * when `data-reduced-motion="true"` is set on <html>.
 */
import { cn } from '@/renderer/lib/cn';

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(2, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block animate-spin', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        {/* Faint track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-line-strong)"
          strokeWidth={stroke}
        />
        {/* Accent arc — a quarter sweep */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.25} ${c}`}
        />
      </svg>
    </span>
  );
}
