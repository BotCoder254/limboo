/**
 * A single session rendered as a flat message-style row (status dot + title +
 * meta), not a card. The active row gets a left accent bar + raised surface.
 *
 * While the session's agent run is in flight the status dot is replaced by the
 * modern `Spinner`. Hovering reveals a `⋯` actions button; right-clicking the
 * row opens the same menu at the cursor. The title becomes an inline input
 * during rename (commit on Enter/blur, cancel on Escape).
 */
import { useEffect, useRef, useState } from 'react';
import { CircleDot, GitBranch, Pin, Archive, MoreHorizontal } from 'lucide-react';
import type { Session, SessionStatus } from '@shared/types';
import { Badge, DiffStat, IconButton, Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useIsSessionRunning } from './useSessionRunning';
import { SessionRowMenu } from './SessionRowMenu';

const STATUS_COLOR: Record<SessionStatus, string> = {
  active: 'text-success',
  idle: 'text-warning',
  done: 'text-faint',
};

export function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
}) {
  const running = useIsSessionRunning(session.id);
  const rename = useSessionStore((s) => s.rename);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startRename = () => {
    setDraft(session.title);
    setEditing(true);
  };

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.title) void rename(session.id, draft);
  };

  const closeMenu = () => {
    setMenu(null);
    setMenuOpen(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onSelect()}
      onDoubleClick={startRename}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      className={cn(
        'group relative flex w-full cursor-default items-start gap-2.5 border-l-2 px-3 py-2 text-left transition-colors',
        active ? 'border-accent bg-surface-2' : 'border-transparent hover:bg-surface-2',
      )}
    >
      <span className="mt-0.5 shrink-0">
        {running ? (
          <Spinner size={13} />
        ) : (
          <CircleDot size={13} className={STATUS_COLOR[session.status]} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditing(false);
                e.stopPropagation();
              }}
              className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-1 py-0.5 text-[13px] font-medium text-fg outline-none focus:border-accent"
            />
          ) : (
            <span className="flex-1 truncate text-[13px] font-medium text-fg">{session.title}</span>
          )}
          {session.archived && <Archive size={11} className="shrink-0 text-faint" />}
          {session.pinned && <Pin size={11} className="shrink-0 text-faint" />}
          <span className="shrink-0 text-[11px] text-faint group-hover:hidden">
            {relativeTime(session.updatedAt)}
          </span>
          {/* The actions button replaces the timestamp on hover so the row width
              stays stable. */}
          <IconButton
            label="Session actions"
            size="sm"
            className="hidden group-hover:flex"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreHorizontal size={14} />
          </IconButton>
        </div>

        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span className="flex min-w-0 items-center gap-1">
            <GitBranch size={10} className="shrink-0" />
            <span className="truncate">{session.branch}</span>
          </span>
          <DiffStat adds={session.adds} dels={session.dels} className="shrink-0" />
          {session.unread > 0 && (
            <Badge tone="accent" className="ml-auto">
              {session.unread}
            </Badge>
          )}
        </div>
      </div>

      {/* Button-anchored menu (top-right of the row). */}
      {menuOpen && (
        <SessionRowMenu session={session} onClose={closeMenu} onRename={startRename} />
      )}
      {/* Right-click context menu, positioned at the cursor. */}
      {menu && (
        <SessionRowMenu session={session} point={menu} onClose={closeMenu} onRename={startRename} />
      )}
    </div>
  );
}
