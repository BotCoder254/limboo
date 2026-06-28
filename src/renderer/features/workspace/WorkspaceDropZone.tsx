/**
 * Drag-and-drop target for adding a workspace by dropping a project folder.
 * Doubles as the modern empty state on the launcher. Resolves the dropped
 * folder's real path through `window.limboo.system.getDroppedPath` (the
 * Electron-32+ supported replacement for `File.path`) and hands it to the
 * validated `workspace:open` IPC — the renderer never touches the filesystem.
 *
 * Marked `data-dropzone` so the global drop-navigation guard
 * (`usePreventFileDrop`) lets these events through to be handled here.
 */
import { useRef, useState } from 'react';
import { FolderInput, FolderOpen, FolderPlus } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { WorkspaceActionButton } from './WorkspaceActionButton';
import type { Workspace } from '@shared/types';

interface WorkspaceDropZoneProps {
  /** Compact variant for the always-visible affordance above a populated list. */
  compact?: boolean;
}

export function WorkspaceDropZone({ compact = false }: WorkspaceDropZoneProps) {
  const pickDirectory = useWorkspaceStore((s) => s.pickDirectory);
  const open = useWorkspaceStore((s) => s.open);
  const create = useWorkspaceStore((s) => s.create);
  const openPath = useWorkspaceStore((s) => s.openPath);
  const addToast = useUIStore((s) => s.addToast);

  const [isDragging, setIsDragging] = useState(false);
  // Drag enter/leave fire for child elements too; count depth to know when the
  // cursor has truly left the zone.
  const depth = useRef(0);

  const toastError = (err: unknown) =>
    addToast({
      title: 'Could not open workspace',
      description: err instanceof Error ? err.message : String(err),
      tone: 'danger',
    });

  const pickAnd = async (action: (path: string) => Promise<Workspace | null>) => {
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      await action(dir);
    } catch (err) {
      toastError(err);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setIsDragging(false);

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
      toastError(err);
    }
  };

  return (
    <div
      data-dropzone
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setIsDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'gap-2 px-4 py-5' : 'gap-4 px-6 py-12',
        isDragging
          ? 'border-accent bg-surface-2'
          : 'border-line-strong bg-surface/40 hover:border-line-strong',
      )}
    >
      <FolderInput
        size={compact ? 22 : 40}
        className={cn('transition-colors', isDragging ? 'text-accent' : 'text-faint')}
      />
      <div className="flex flex-col gap-1">
        <span className={cn('font-medium text-fg', compact ? 'text-[12px]' : 'text-sm')}>
          {isDragging ? 'Drop to open as a workspace' : 'Drop a folder here'}
        </span>
        {!compact && (
          <span className="max-w-[28rem] text-[12px] leading-relaxed text-muted">
            Drag a project folder in, or browse below. Limboo profiles its languages,
            package managers, and git branch automatically.
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <WorkspaceActionButton icon={FolderOpen} variant="secondary" onClick={() => pickAnd(open)}>
          Open folder
        </WorkspaceActionButton>
        <WorkspaceActionButton icon={FolderPlus} variant="primary" onClick={() => pickAnd(create)}>
          Create workspace
        </WorkspaceActionButton>
      </div>
    </div>
  );
}
