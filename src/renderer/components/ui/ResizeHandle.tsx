/**
 * Draggable divider between resizable columns. Default: a 1px hairline with an
 * invisible wider hit area. Ghost: an invisible 8px-wide handle that doubles as
 * the gutter between a root-background panel and the floating workspace card —
 * a centered indicator appears on hover so the affordance is discoverable.
 */
import type { MouseEvent } from 'react';
import { cn } from '@/renderer/lib/cn';

export function ResizeHandle({
  onMouseDown,
  ghost = false,
}: {
  onMouseDown: (event: MouseEvent) => void;
  ghost?: boolean;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'group relative z-10 shrink-0 cursor-col-resize',
        ghost ? 'w-2' : 'w-px bg-line',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 transition-colors',
          ghost
            ? 'left-1/2 w-0.5 -translate-x-1/2 rounded-full group-hover:bg-accent/50'
            : '-left-1 -right-1 group-hover:bg-accent/30',
        )}
      />
    </div>
  );
}
