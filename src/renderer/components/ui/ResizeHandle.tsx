/**
 * 1px draggable divider between resizable columns. The visible bar is hairline,
 * but an invisible wider hit area makes it easy to grab; it highlights with the
 * accent on hover/drag.
 */
import type { MouseEvent } from 'react';

export function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (event: MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-accent/30" />
    </div>
  );
}
