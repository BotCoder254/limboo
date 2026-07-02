/**
 * Limboo brand mark. Renders the app's pink signature shape from the single icon
 * asset — `assets/icon.svg`, the exact source the tray and OS/window icons
 * (`tray.png`, `icon.png`) are rasterized from. Using the shared asset (rather than
 * a duplicated inline path) guarantees the in-app logo can never drift from the
 * tray/OS icon.
 *
 * Per the product's visual rules the mark is a solid color on a transparent
 * background (no gradients); the pink fill lives in the asset itself.
 */
import iconUrl from '../../../../assets/icon.svg';
import { cn } from '@/renderer/lib/cn';

export function Logo({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('select-none', className)}
    />
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
