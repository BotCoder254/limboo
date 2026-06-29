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
import { CircleDot, GitBranch, Plus, Sparkles, TerminalSquare } from 'lucide-react';
import { DiffStat, EmptyState, IconButton, Spinner } from '@/renderer/components/ui';
import { useIsSessionRunning } from '@/renderer/features/sessions/useSessionRunning';
import { Logo } from '@/renderer/components/brand/Logo';
import { Composer } from './Composer';
import { ConversationView } from './ConversationView';
import { WorkspaceLauncher } from './WorkspaceLauncher';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useGitStore } from '@/renderer/stores/useGitStore';

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
      {session && <SessionHeader sessionId={session.id} title={session.title} branch={session.branch} adds={session.adds} dels={session.dels} />}

      {/* The scroll region fills the column; the Composer floats over its bottom
          edge (no separator line, no full-width bar) with the conversation
          scrolling cleanly behind it. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-4 pb-32 pt-6">
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

        {/* Fade scrim: messages dissolve into the background as they scroll toward
            the composer, so nothing is ever visible behind the (opaque) card. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-base via-base/85 to-transparent" />

        <div className="absolute inset-x-0 bottom-0">
          <Composer disabled={!session} />
        </div>
      </div>
    </main>
  );
}

/** Center header reflecting the active session; shows the running spinner while
 *  this session's agent run is in flight (else a steady status dot). */
function SessionHeader({
  sessionId,
  title,
  branch,
  adds,
  dels,
}: {
  sessionId: string;
  title: string;
  branch: string;
  adds: number;
  dels: number;
}) {
  const running = useIsSessionRunning(sessionId);
  const planStatus = useAgentStore((s) => s.bySession[sessionId]?.plan?.status);
  const terminalOpen = useLayoutStore((s) => s.activeTab === 'terminal');
  const toggleTerminal = useLayoutStore((s) => s.toggleTerminal);
  const gitOpen = useLayoutStore((s) => s.activeTab === 'git');
  const toggleGit = useLayoutStore((s) => s.toggleTab);
  // Dirty indicator on the git toggle so a glance shows uncommitted work.
  const gitDirty = useGitStore((s) => !!s.status && !s.status.clean);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
      {running ? <Spinner size={12} /> : <CircleDot size={12} className="text-success" />}
      <span className="text-[13px] font-medium">{title}</span>
      <span className="text-[11px] text-faint">{branch}</span>
      <DiffStat adds={adds} dels={dels} className="ml-2" />
      {running && <span className="text-[11px] text-accent">Working…</span>}
      {!running && planStatus === 'ready' && (
        <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          Plan ready
        </span>
      )}
      <IconButton
        label={gitOpen ? 'Hide git' : 'Show git'}
        size="sm"
        className="ml-auto"
        active={gitOpen}
        onClick={() => toggleGit('git')}
      >
        <span className="relative">
          <GitBranch size={14} />
          {gitDirty && (
            <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning" />
          )}
        </span>
      </IconButton>
      <IconButton
        label={terminalOpen ? 'Hide terminal' : 'Show terminal'}
        size="sm"
        active={terminalOpen}
        onClick={toggleTerminal}
      >
        <TerminalSquare size={14} />
      </IconButton>
    </div>
  );
}
