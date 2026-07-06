/**
 * SuccessCheck — a modern, self-drawing success checkmark. The ring and tick are
 * revealed with a `stroke-dashoffset` draw (GPU-accelerated, no deps), tinted with
 * the `success` token via `currentColor`. The animation keyframes live in
 * `styles/index.css` and are disabled under reduced motion (the stroke renders
 * fully drawn). Purely presentational.
 */
export function SuccessCheck({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      role="img"
      aria-label="Completed"
      className={`text-success ${className ?? ''}`}
    >
      <circle
        cx="26"
        cy="26"
        r="24"
        stroke="currentColor"
        strokeWidth="2.5"
        className="success-check-circle"
      />
      <path
        d="M15 27.5 L23 35 L38 18"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="success-check-tick"
      />
    </svg>
  );
}
