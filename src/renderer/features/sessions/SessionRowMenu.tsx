/**
 * Action menu for a single session row — opened by the row's `⋯` button or a
 * right-click on the row. Reuses the elevated dropdown styling from
 * WorkspaceSwitcher (`bg-elevated` / `border-line-strong` / `no-drag`). Pure
 * presentation: every action delegates to the session store.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Pin,
  PinOff,
  Copy,
  Archive,
  ArchiveRestore,
  Folder,
  GitBranch,
  Tags,
  Trash2,
} from 'lucide-react';
import type { Session } from '@shared/types';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

interface SessionRowMenuProps {
  session: Session;
  /** Anchor: 'button' opens below the ⋯, 'context' opens at the cursor point. */
  point?: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
}

export function SessionRowMenu({ session, point, onClose, onRename }: SessionRowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const togglePin = useSessionStore((s) => s.togglePin);
  const setArchived = useSessionStore((s) => s.setArchived);
  const duplicate = useSessionStore((s) => s.duplicate);
  const requestDelete = useSessionStore((s) => s.requestDelete);
  const setFolder = useSessionStore((s) => s.setFolder);
  const setTags = useSessionStore((s) => s.setTags);

  /** Inline editor swapped into the menu for folder / tags input. */
  const [editing, setEditing] = useState<'folder' | 'tags' | null>(null);
  const [draft, setDraft] = useState('');

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

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const positioned = point
    ? ({ position: 'fixed', left: point.x, top: point.y } as const)
    : ({ position: 'absolute', right: 0, top: '100%' } as const);

  // Inline folder / tags editor replaces the menu body while active.
  if (editing) {
    const commit = () => {
      if (editing === 'folder') {
        const folder = draft.trim();
        void setFolder(session.id, folder ? folder.slice(0, 64) : null);
      } else {
        const tags = [
          ...new Set(
            draft
              .split(',')
              .map((t) => t.trim().slice(0, 24))
              .filter(Boolean),
          ),
        ].slice(0, 8);
        void setTags(session.id, tags);
      }
      onClose();
    };
    return (
      <div
        ref={ref}
        style={positioned}
        className="no-drag animate-pop-in z-50 mt-1 w-56 rounded-lg border border-line-strong bg-elevated p-2 shadow-2xl"
      >
        <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
          {editing === 'folder' ? 'Folder (empty clears)' : 'Tags (comma-separated)'}
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
          placeholder={editing === 'folder' ? 'e.g. Release 1.3' : 'e.g. backend, security'}
          className="w-full rounded border border-line-strong bg-surface px-2 py-1 text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent"
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={positioned}
      className="no-drag animate-pop-in z-50 mt-1 w-44 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl"
    >
      <MenuItem icon={Pencil} label="Rename" onClick={run(onRename)} />
      <MenuItem
        icon={session.pinned ? PinOff : Pin}
        label={session.pinned ? 'Unpin' : 'Pin'}
        onClick={run(() => void togglePin(session.id, !session.pinned))}
      />
      <MenuItem icon={Copy} label="Duplicate" onClick={run(() => void duplicate(session.id))} />
      {(session.worktreePath || session.worktreeBranch) && (
        <MenuItem
          icon={GitBranch}
          label="Duplicate in worktree"
          onClick={run(() => void duplicate(session.id, true))}
        />
      )}
      <MenuItem
        icon={session.archived ? ArchiveRestore : Archive}
        label={session.archived ? 'Unarchive' : 'Archive'}
        onClick={run(() => void setArchived(session.id, !session.archived))}
      />
      <div className="my-1 border-t border-line" />
      <MenuItem
        icon={Folder}
        label={session.folder ? `Folder: ${session.folder}` : 'Move to folder…'}
        onClick={() => {
          setDraft(session.folder ?? '');
          setEditing('folder');
        }}
      />
      <MenuItem
        icon={Tags}
        label={session.tags.length > 0 ? `Tags (${session.tags.length})…` : 'Edit tags…'}
        onClick={() => {
          setDraft(session.tags.join(', '));
          setEditing('tags');
        }}
      />
      <div className="my-1 border-t border-line" />
      <MenuItem
        icon={Trash2}
        label="Delete"
        danger
        onClick={run(() => void requestDelete(session.id))}
      />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
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
        (danger
          ? 'text-danger hover:bg-surface-2'
          : 'text-muted hover:bg-surface-2 hover:text-fg')
      }
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  );
}
