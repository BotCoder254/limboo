/**
 * Center column — the largest region. A thin header reflecting the active
 * session, a scrolling conversation area, and the Composer pinned at the bottom
 * of THIS column (it does not span the whole window).
 *
 * Phase 1 has no agent and no mock conversation, so the conversation area shows
 * a welcome / empty state. The structure is final; later phases stream messages
 * into the scroll region.
 */
import { useEffect } from 'react';
import { CircleDot, Plus, Sparkles } from 'lucide-react';
import { DiffStat, EmptyState } from '@/renderer/components/ui';
import { Logo } from '@/renderer/components/brand/Logo';
import { Composer } from './Composer';
import { ConversationView } from './ConversationView';
import { WorkspaceLauncher } from './WorkspaceLauncher';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

export function CenterWorkspace() {
  const session = useSessionStore((s) =>
    s.sessions.find((item) => item.id === s.selectedId) ?? null,
  );
  const createSession = useSessionStore((s) => s.createSession);
  const hasWorkspace = useWorkspaceStore((s) => s.activeId !== null);
  const loadSession = useAgentStore((s) => s.loadSession);
  const messageCount = useAgentStore((s) =>
    session ? (s.bySession[session.id]?.messages.length ?? 0) : 0,
  );

  // Restore the transcript whenever the selected session changes.
  useEffect(() => {
    if (session) void loadSession(session.id);
  }, [session?.id, loadSession]);

  // No workspace selected yet → the Recent-Workspaces launcher owns the column.
  if (!hasWorkspace) {
    return (
      <main className="flex h-full min-h-0 flex-col bg-base px-4">
        <WorkspaceLauncher />
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-base">
      {session && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
          <CircleDot size={12} className="text-success" />
          <span className="text-[13px] font-medium">{session.title}</span>
          <span className="text-[11px] text-faint">{session.branch}</span>
          <DiffStat adds={session.adds} dels={session.dels} className="ml-2" />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex h-full max-w-3xl flex-col">
          {session ? (
            messageCount > 0 ? (
              <ConversationView sessionId={session.id} />
            ) : (
              <EmptyState
                className="m-auto"
                icon={Sparkles}
                title="Start the conversation"
                description="Describe what you want to build. Limboo coordinates the repository, files, terminal, and tasks while Claude Code does the work."
              />
            )
          ) : (
            <div className="m-auto flex flex-col items-center gap-4 text-center">
              <Logo size={40} />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold tracking-tight text-fg">
                  Welcome to Limboo
                </span>
                <span className="max-w-md text-[13px] leading-relaxed text-muted">
                  The local-first workspace for orchestrating coding agents. Create
                  a session to begin — every task lives inside one.
                </span>
              </div>
              <button
                type="button"
                onClick={() => createSession()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
              >
                <Plus size={13} />
                New session
              </button>
            </div>
          )}
        </div>
      </div>

      <Composer disabled={!session} />
    </main>
  );
}
