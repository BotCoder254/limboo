/**
 * Action menu for a single session row — opened by the row's `⋯` button or a
 * right-click on the row. Reuses the elevated dropdown styling from
 * WorkspaceSwitcher (`bg-elevated` / `border-line-strong` / `no-drag`). Pure
 * presentation: every action delegates to the session store.
 */
import { useEffect, useRef } from 'react';
import { Pencil, Pin, PinOff, Copy, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
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
  const removeSession = useSessionStore((s) => s.removeSession);

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
      <MenuItem
        icon={session.archived ? ArchiveRestore : Archive}
        label={session.archived ? 'Unarchive' : 'Archive'}
        onClick={run(() => void setArchived(session.id, !session.archived))}
      />
      <div className="my-1 border-t border-line" />
      <MenuItem
        icon={Trash2}
        label="Delete"
        danger
        onClick={run(() => void removeSession(session.id))}
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
