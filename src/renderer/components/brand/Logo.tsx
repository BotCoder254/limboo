/**
 * Limboo brand mark. A single, solid-color organic "blob" glyph rendered as an
 * inline SVG — the app's pink signature shape.
 *
 * Per the product's visual rules: no background, no gradients, solid color only.
 * The path fills with `currentColor`, and `tone` maps to a theme token so the mark
 * stays on-palette everywhere. `brand` (the default) is the signature pink
 * (`--color-brand`); the other tones exist for contexts that need the mark to blend
 * into surrounding text.
 */
import { cn } from '@/renderer/lib/cn';

type Tone = 'brand' | 'accent' | 'fg' | 'muted';

const TONE: Record<Tone, string> = {
  brand: 'text-brand',
  accent: 'text-accent',
  fg: 'text-fg',
  muted: 'text-muted',
};

/** The user-supplied blob path (viewBox 0 0 200 200, centered via translate). */
const BLOB_PATH =
  'M19.6,-33.8C29.7,-28.1,45.2,-31.6,47.2,-27.5C49.2,-23.4,37.7,-11.7,35.1,-1.5C32.6,8.7,39,17.5,41.7,29.8C44.5,42.1,43.5,57.9,36,56.6C28.4,55.3,14.2,36.8,1.9,33.6C-10.5,30.4,-21,42.4,-33,46.3C-45.1,50.2,-58.7,46,-60,36.9C-61.2,27.8,-50.2,13.9,-42.2,4.6C-34.3,-4.7,-29.5,-9.5,-27.9,-18.1C-26.4,-26.8,-28.2,-39.3,-24.1,-48.6C-20,-57.8,-10,-63.8,-2.6,-59.3C4.7,-54.7,9.5,-39.6,19.6,-33.8Z';

export function Logo({
  size = 18,
  tone = 'brand',
  className,
}: {
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn(TONE[tone], className)}
    >
      <path fill="currentColor" d={BLOB_PATH} transform="translate(100 100)" />
    </svg>
  );
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
