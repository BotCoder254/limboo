/**
 * Hand-rolled column resizing (zero dependencies). On handle mousedown it
 * attaches `mousemove`/`mouseup` to the window, computes a clamped width (delta
 * inverted for right-edge panels), and pushes it into the layout store — which
 * persists the final value to settings.
 */
import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export function useResizable(opts: {
  edge: 'left' | 'right';
  getWidth: () => number;
  setWidth: (width: number) => void;
}) {
  const { edge, getWidth, setWidth } = opts;

  const startDrag = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = getWidth();

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e: globalThis.MouseEvent) => {
        const delta = e.clientX - startX;
        setWidth(edge === 'left' ? startWidth + delta : startWidth - delta);
      };

      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [edge, getWidth, setWidth],
  );

  return { startDrag };
}
