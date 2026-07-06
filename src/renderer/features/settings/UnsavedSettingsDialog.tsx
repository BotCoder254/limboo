/**
 * Unsaved-settings confirm — a centered modal shown when the Settings modal is
 * closed (X / backdrop / Escape) while changes differ from the values captured
 * when it opened. Lists the changed settings and offers to keep editing or
 * discard (revert to the opening baseline). Built to the app modal idiom
 * (HooksConfirmDialog / ResumeDeltaDialog): same backdrop, pop-in card, and
 * button classes. Dark-only, no gradients.
 */
import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { humanizeSettingPath } from './diffSettings';

export function UnsavedSettingsDialog({
  changes,
  onKeepEditing,
  onDiscard,
}: {
  changes: string[];
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onKeepEditing();
      }
    };
    // Capture so this nested dialog handles Escape before the Settings modal does.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onKeepEditing]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onMouseDown={onKeepEditing}
    >
      <div
        className="animate-pop-in flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <AlertTriangle size={14} className="text-warning" />
            Discard unsaved changes?
          </span>
          <button
            type="button"
            aria-label="Keep editing"
            onClick={onKeepEditing}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
          <p className="text-[12px] leading-relaxed text-muted">
            You changed {changes.length} setting{changes.length === 1 ? '' : 's'} in this
            session. Discarding reverts {changes.length === 1 ? 'it' : 'them'} to the values
            from when you opened Settings.
          </p>
          <div className="flex flex-col gap-0.5 rounded-md border border-line bg-surface-2 px-3 py-2">
            {changes.map((path) => (
              <div key={path} className="flex items-center gap-2 text-[12px] text-fg">
                <span className="h-1 w-1 shrink-0 rounded-full bg-warning" />
                <span className="min-w-0 flex-1 truncate">{humanizeSettingPath(path)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onKeepEditing}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md bg-danger px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}
