/**
 * Left sidebar — Sessions only (per the product's session-first philosophy).
 * Renders rows from the session store; shows an empty state with a primary
 * action when there are none (the Phase 1 default — no mock data).
 */
import { MessagesSquare, Plus } from 'lucide-react';
import { EmptyState, IconButton } from '@/renderer/components/ui';
import { SessionRow } from './SessionRow';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

export function SessionsSidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const createSession = useSessionStore((s) => s.createSession);
  const selectSession = useSessionStore((s) => s.selectSession);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Sessions
        </span>
        <IconButton label="New session" size="sm" onClick={() => createSession()}>
          <Plus size={15} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {sessions.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No sessions yet"
            description="Every task happens inside a session. Create one to get started."
            action={
              <button
                type="button"
                onClick={() => createSession()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
              >
                <Plus size={13} />
                New session
              </button>
            }
          />
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === selectedId}
              onSelect={() => selectSession(session.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
