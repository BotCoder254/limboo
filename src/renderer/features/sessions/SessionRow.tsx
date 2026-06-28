/**
 * A single session rendered as a flat message-style row (status dot + title +
 * meta), not a card. The active row gets a left accent bar + raised surface.
 */
import { CircleDot, GitBranch, Pin } from 'lucide-react';
import type { Session, SessionStatus } from '@shared/types';
import { Badge, DiffStat } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';

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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 border-l-2 px-3 py-2 text-left transition-colors',
        active ? 'border-accent bg-surface-2' : 'border-transparent hover:bg-surface-2',
      )}
    >
      <CircleDot size={13} className={cn('mt-0.5 shrink-0', STATUS_COLOR[session.status])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="flex-1 truncate text-[13px] font-medium text-fg">{session.title}</span>
          {session.pinned && <Pin size={11} className="shrink-0 text-faint" />}
          <span className="shrink-0 text-[11px] text-faint">{relativeTime(session.updatedAt)}</span>
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
    </button>
  );
}
