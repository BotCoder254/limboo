/**
 * Drag-and-drop support for adding a workspace by dropping a project folder, split
 * into two pieces:
 *
 *  - `WorkspaceDragOverlay` — a full-area drop target that appears ONLY while a file
 *    is being dragged over the window (no permanent dashed box at rest). It resolves
 *    the dropped folder's real path through `window.limboo.system.getDroppedPath`
 *    (the Electron-32+ replacement for `File.path`) and hands it to the validated
 *    `workspace:open` IPC — the renderer never touches the filesystem.
 *  - `WorkspaceActions` — the always-visible Open / Create buttons (no dashed
 *    border), used by both the empty state and the populated launcher.
 *
 * The overlay is marked `data-dropzone` so the global drop-navigation guard
 * (`usePreventFileDrop`) lets its events through to be handled here.
 */
import { FolderOpen, FolderPlus, FolderInput } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useFileDragActive } from '@/renderer/hooks/usePreventFileDrop';
import { WorkspaceActionButton } from './WorkspaceActionButton';

/** Open / Create actions. `size='lg'` is the roomier hero variant on the empty state. */
export function WorkspaceActions({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const pickDirectory = useWorkspaceStore((s) => s.pickDirectory);
  const open = useWorkspaceStore((s) => s.open);
  const setLauncherView = useWorkspaceStore((s) => s.setLauncherView);
  const addToast = useUIStore((s) => s.addToast);

  const openFolder = async () => {
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      await open(dir);
    } catch (err) {
      addToast({
        title: 'Could not open workspace',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center justify-center gap-2',
        size === 'lg' && 'gap-3',
      )}
    >
      <WorkspaceActionButton icon={FolderOpen} variant="secondary" size={size} onClick={openFolder}>
        Open folder
      </WorkspaceActionButton>
      {/* In-app create flow — opens the Create panel, never the OS folder dialog. */}
      <WorkspaceActionButton
        icon={FolderPlus}
        variant="primary"
        size={size}
        onClick={() => setLauncherView('create')}
      >
        Create workspace
      </WorkspaceActionButton>
    </div>
  );
}

/**
 * Full-area drop target, rendered only during an active file drag. Absolute-fills
 * its positioned parent (the launcher body), so the parent must be `relative`.
 */
export function WorkspaceDragOverlay() {
  const openPath = useWorkspaceStore((s) => s.openPath);
  const addToast = useUIStore((s) => s.addToast);
  const dragging = useFileDragActive();

  if (!dragging) return null;

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) {
      addToast({
        title: 'Multiple items dropped',
        description: 'Only the first folder was opened as a workspace.',
        tone: 'info',
      });
    }

    const resolve = window.limboo?.system?.getDroppedPath;
    if (!resolve) return;
    try {
      const path = resolve(files[0]);
      if (!path) return;
      // Validation (directory check, forbidden roots, permissions, duplicates)
      // happens in the main process via the workspace:open IPC.
      await openPath(path);
    } catch (err) {
      addToast({
        title: 'Could not open workspace',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  };

  return (
    <div
      data-dropzone
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
      className={cn(
        'animate-fade-in absolute inset-2 z-40 flex flex-col items-center justify-center gap-4',
        'rounded-2xl border-2 border-dashed border-accent bg-base/80 text-center backdrop-blur-sm',
      )}
    >
      <FolderInput size={44} className="text-accent" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">Drop to open as a workspace</span>
        <span className="text-[12px] text-muted">
          Limboo profiles its languages, package managers, and git branch automatically.
        </span>
      </div>
    </div>
  );
}
