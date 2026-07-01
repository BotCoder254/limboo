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
import { useEffect, useState } from 'react';

function isInsideDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-dropzone]') !== null;
}

/** True only while a *file* drag is in progress anywhere over the window. */
function dragCarriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.prototype.includes.call(types, 'Files') : false;
}

/**
 * Track whether the user is currently dragging a file over the window. Lets a
 * surface reveal its drop affordance *only* during an active drag (so nothing is
 * shown at rest) rather than keeping a permanent dashed target on screen.
 *
 * Uses a depth counter because `dragenter`/`dragleave` also fire for child
 * elements; the drag is only truly over when depth returns to zero.
 */
export function useFileDragActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!dragCarriesFiles(e)) return;
      depth += 1;
      setActive(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const reset = () => {
      depth = 0;
      setActive(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);
  return active;
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
