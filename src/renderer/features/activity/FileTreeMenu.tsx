/**
 * Context menu for a Files-tree row (or the tree background = workspace root).
 * Mirrors the SessionRowMenu pattern: fixed-position elevated dropdown, inline
 * input mode for naming, outside-click + Escape close. Pure presentation —
 * every mutation delegates to the file-system store (which calls the guarded
 * main-process File Writer; the tree refreshes via `fs:tree-changed`).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { FileNode } from '@shared/types';
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';

interface FileTreeMenuProps {
  workspaceId: string;
  /** The right-clicked node, or null for the tree background (workspace root). */
  node: FileNode | null;
  point: { x: number; y: number };
  onClose: () => void;
}

type Editing = 'new-file' | 'new-dir' | 'rename';

/** Client-side name check; the main process re-validates everything anyway. */
function isValidName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  return !/[\\/\0]/.test(name);
}

export function FileTreeMenu({ workspaceId, node, point, onClose }: FileTreeMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const createFile = useFileSystemStore((s) => s.createFile);
  const createDir = useFileSystemStore((s) => s.createDir);
  const remove = useFileSystemStore((s) => s.remove);
  const rename = useFileSystemStore((s) => s.rename);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const isDir = node === null || node.type === 'dir';
  /** Directory new entries land in ('' = workspace root). */
  const dirPath = node === null ? '' : node.path;
  /** Parent directory of the node itself (for rename). */
  const parentPath = node ? node.path.slice(0, Math.max(0, node.path.lastIndexOf('/'))) : '';

  const commit = () => {
    const name = draft.trim();
    if (!editing || !isValidName(name)) return;
    if (editing === 'new-file' || editing === 'new-dir') {
      const target = dirPath ? `${dirPath}/${name}` : name;
      void (editing === 'new-file' ? createFile : createDir)(workspaceId, target);
    } else if (node) {
      if (name !== node.name) {
        const to = parentPath ? `${parentPath}/${name}` : name;
        void rename(workspaceId, node.path, to);
      }
    }
    onClose();
  };

  const positioned = { position: 'fixed', left: point.x, top: point.y } as const;

  if (editing) {
    const label =
      editing === 'new-file' ? 'New file name' : editing === 'new-dir' ? 'New folder name' : 'Rename to';
    return (
      <div
        ref={ref}
        style={positioned}
        className="no-drag animate-pop-in z-50 w-56 rounded-lg border border-line-strong bg-elevated p-2 shadow-2xl"
      >
        <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') onClose();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder={editing === 'new-dir' ? 'e.g. components' : 'e.g. index.ts'}
          className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent"
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={positioned}
      className="no-drag animate-pop-in z-50 w-48 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl"
    >
      {isDir && (
        <>
          <MenuItem
            icon={FilePlus2}
            label="New file…"
            onClick={() => {
              setDraft('');
              setEditing('new-file');
            }}
          />
          <MenuItem
            icon={FolderPlus}
            label="New folder…"
            onClick={() => {
              setDraft('');
              setEditing('new-dir');
            }}
          />
        </>
      )}
      {node && (
        <>
          <MenuItem
            icon={Pencil}
            label="Rename…"
            onClick={() => {
              setDraft(node.name);
              setEditing('rename');
            }}
          />
          <MenuItem
            icon={Copy}
            label="Copy path"
            onClick={() => {
              void window.limboo?.system.clipboardWrite(node.path);
              onClose();
            }}
          />
        </>
      )}
      <MenuItem
        icon={FolderOpen}
        label="Reveal in Explorer"
        onClick={() => {
          void window.limboo?.fs.reveal(workspaceId, node?.path);
          onClose();
        }}
      />
      {node && (
        <>
          <div className="my-1 border-t border-line" />
          <MenuItem
            icon={Trash2}
            label={confirmDelete ? 'Confirm delete' : 'Delete'}
            danger
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void remove(workspaceId, node.path, node.type === 'dir');
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ' +
        (danger ? 'text-danger hover:bg-surface-2' : 'text-muted hover:bg-surface-2 hover:text-fg')
      }
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );
}
