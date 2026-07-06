/**
 * Editor-style tab strip for worktree-backed sessions — rendered at the very
 * top of the center column, above the session header. Each worktree session is
 * an isolated engineering environment (own checkout + branch); the tabs make
 * switching between them (and the plain active session) one click, with
 * Ctrl+Tab / Ctrl+Shift+Tab cycling (see `session.nextTab` / `session.prevTab`
 * in lib/commands.ts).
 *
 * Visible only when at least one worktree-backed session exists, so plain
 * workspaces keep today's exact layout. Styling mirrors the h-9 header rows:
 * border-line, text-[12px], bg-surface-2 active state, accent underline.
 */
import { AlertTriangle, GitBranch, X } from 'lucide-react';
import type { Session } from '@shared/types';
import { Badge, SessionSpinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useIsSessionRunning } from './useSessionRunning';

export function WorktreeTabs() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const selectSession = useSessionStore((s) => s.selectSession);

  // The strip lists every live worktree-backed session, plus the active plain
  // session (so the "main checkout" context is always reachable as a tab).
  const worktreeSessions = sessions.filter((s) => s.worktreePath && !s.archived);
  if (worktreeSessions.length === 0) return null;
  const active = sessions.find((s) => s.id === selectedId) ?? null;
  const tabs: Session[] =
    active && !active.worktreePath ? [active, ...worktreeSessions] : worktreeSessions;

  // Closing a tab switches to a neighbour (keeps the session/worktree intact);
  // only offered when there's somewhere else to go.
  const closable = tabs.length > 1;
  const switchToNeighbour = (index: number) => {
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) void selectSession(next.id);
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface">
      {tabs.map((session, index) => (
        <WorktreeTab
          key={session.id}
          session={session}
          active={session.id === selectedId}
          onSelect={() => void selectSession(session.id)}
          onClose={closable ? () => switchToNeighbour(index) : undefined}
        />
      ))}
    </div>
  );
}

function WorktreeTab({
  session,
  active,
  onSelect,
  onClose,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const running = useIsSessionRunning(session.id);
  const missing = session.worktreeStatus === 'missing';
  const label = session.worktreePath
    ? session.worktreeBranch ?? session.branch
    : session.branch;

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      title={
        session.worktreePath
          ? `${session.title} — ${session.worktreePath}${missing ? ' (missing)' : ''}`
          : `${session.title} — workspace checkout`
      }
      className={cn(
        'group relative flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[12px] transition-colors',
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {running ? (
        <SessionSpinner size={11} />
      ) : missing ? (
        <AlertTriangle size={11} className="shrink-0 text-warning" />
      ) : (
        <GitBranch
          size={11}
          className={cn('shrink-0', session.worktreePath ? 'text-accent' : 'text-faint')}
        />
      )}
      <span className="truncate font-medium">{session.title}</span>
      <span className="shrink-0 truncate text-[10px] text-faint">{label}</span>
      {session.unread > 0 && (
        <Badge tone="accent" className="shrink-0">
          {session.unread}
        </Badge>
      )}
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${session.title} tab`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5 shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X size={12} />
        </button>
      )}
      {/* Accent underline marks the active tab (mirrors the row accent bar). */}
      {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
    </div>
  );
}
