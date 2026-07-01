/**
 * Decorative "skyline" that anchors the bottom of the Workspace Selection screen.
 * On-palette (a `--color-surface-2` silhouette on pure black, plus a fainter
 * back layer for depth) — no gradients, dark-only, per the theme rules.
 *
 * It comes alive on hover with a liquid wave-morph: an SVG `feTurbulence` +
 * `feDisplacementMap` filter whose displacement ramps up while the pointer is over
 * the graphic, so the bar tops ripple like poured liquid, then settle when the
 * pointer leaves. SMIL `<animate>` gated on `mouseover` / `mouseout` (DOM event
 * names SMIL understands, well-supported in Chromium/Electron) drives it, and a
 * subtle CSS "breathe" makes the bars rise slightly on hover. Both are skipped
 * when the user prefers reduced motion.
 */
import { cn } from '@/renderer/lib/cn';

/** The user-supplied skyline path (viewBox 0 0 1440 320). */
const SKYLINE_PATH =
  'M0,256L0,288L36.9,288L36.9,32L73.8,32L73.8,32L110.8,32L110.8,256L147.7,256L147.7,96L184.6,96L184.6,32L221.5,32L221.5,0L258.5,0L258.5,96L295.4,96L295.4,0L332.3,0L332.3,64L369.2,64L369.2,288L406.2,288L406.2,192L443.1,192L443.1,160L480,160L480,192L516.9,192L516.9,256L553.8,256L553.8,224L590.8,224L590.8,256L627.7,256L627.7,256L664.6,256L664.6,96L701.5,96L701.5,128L738.5,128L738.5,288L775.4,288L775.4,160L812.3,160L812.3,192L849.2,192L849.2,320L886.2,320L886.2,224L923.1,224L923.1,64L960,64L960,128L996.9,128L996.9,256L1033.8,256L1033.8,0L1070.8,0L1070.8,256L1107.7,256L1107.7,192L1144.6,192L1144.6,192L1181.5,192L1181.5,0L1218.5,0L1218.5,224L1255.4,224L1255.4,128L1292.3,128L1292.3,256L1329.2,256L1329.2,160L1366.2,160L1366.2,224L1403.1,224L1403.1,192L1440,192L1440,0L1403.1,0L1403.1,0L1366.2,0L1366.2,0L1329.2,0L1329.2,0L1292.3,0L1292.3,0L1255.4,0L1255.4,0L1218.5,0L1218.5,0L1181.5,0L1181.5,0L1144.6,0L1144.6,0L1107.7,0L1107.7,0L1070.8,0L1070.8,0L1033.8,0L1033.8,0L996.9,0L996.9,0L960,0L960,0L923.1,0L923.1,0L886.2,0L886.2,0L849.2,0L849.2,0L812.3,0L812.3,0L775.4,0L775.4,0L738.5,0L738.5,0L701.5,0L701.5,0L664.6,0L664.6,0L627.7,0L627.7,0L590.8,0L590.8,0L553.8,0L553.8,0L516.9,0L516.9,0L480,0L480,0L443.1,0L443.1,0L406.2,0L406.2,0L369.2,0L369.2,0L332.3,0L332.3,0L295.4,0L295.4,0L258.5,0L258.5,0L221.5,0L221.5,0L184.6,0L184.6,0L147.7,0L147.7,0L110.8,0L110.8,0L73.8,0L73.8,0L36.9,0L36.9,0L0,0L0,0Z';

function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.reducedMotion === 'true';
}

export function WorkspaceSkyline({ className }: { className?: string }) {
  const reduced = prefersReducedMotion();

  return (
    <div className={cn('limboo-skyline group w-full select-none', className)} aria-hidden>
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        className="block h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="limboo-skyline-liquid" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.005 0.012"
              numOctaves={2}
              seed={7}
              result="noise"
            >
              {!reduced && (
                <animate
                  attributeName="baseFrequency"
                  begin="limboo-skyline-root.mouseover"
                  end="limboo-skyline-root.mouseout"
                  dur="7s"
                  values="0.005 0.008;0.008 0.02;0.005 0.008"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0">
              {!reduced && (
                <animate
                  attributeName="scale"
                  begin="limboo-skyline-root.mouseover"
                  end="limboo-skyline-root.mouseout"
                  dur="2.4s"
                  values="0;16;9;16;0"
                  repeatCount="indefinite"
                />
              )}
            </feDisplacementMap>
          </filter>
        </defs>

        {/* Hover target spans the whole graphic so the ripple triggers anywhere. */}
        <g id="limboo-skyline-root">
          {/* Transparent hit area (the path itself has gaps between bars). */}
          <rect x="0" y="0" width="1440" height="320" fill="transparent" />
          {/* Back layer: fainter + offset for a sense of depth. */}
          <path
            d={SKYLINE_PATH}
            transform="translate(0 26)"
            style={{ fill: 'var(--color-surface)' }}
            opacity={0.7}
          />
          {/* Front layer: the silhouette that ripples on hover. */}
          <g className="limboo-skyline-bars" filter="url(#limboo-skyline-liquid)">
            <path d={SKYLINE_PATH} style={{ fill: 'var(--color-surface-2)' }} />
          </g>
        </g>
      </svg>
    </div>
  );
}
