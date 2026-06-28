/**
 * Global guard against Electron's default behaviour of navigating the window to
 * a file when one is dropped anywhere on it (which would replace the whole UI
 * with a `file://` page). We `preventDefault` every `dragover`/`drop` on
 * `window` EXCEPT when the event originates inside an opt-in drop target marked
 * with `data-dropzone` — those handle the drop themselves.
 *
 * This is defense-in-depth: `createWindow.ts` already blocks `will-navigate` /
 * `will-redirect`, but stopping the drop at the source avoids the flicker and
 * keeps drag semantics owned by the renderer.
 */
import { useEffect } from 'react';

function isInsideDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-dropzone]') !== null;
}

export function usePreventFileDrop(): void {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (isInsideDropZone(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (isInsideDropZone(e.target)) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
