/**
 * Center column — the largest region. A thin header reflecting the active
 * session, a scrolling conversation area, and the Composer docked at the bottom
 * of THIS column (it does not span the whole window).
 *
 * Layout is a plain 3-row flex column: header (shrink-0), scroll region
 * (flex-1, min-h-0, the ONLY scroller), and the Composer footer (shrink-0, in
 * normal flow). Because the composer occupies real layout space, the scroll
 * area's height always excludes it — streamed messages can never be hidden
 * behind the composer. This is the standard chat-UI pattern (ChatGPT/Claude);
 * it replaces the previous floating-absolute composer + `--composer-h` reserve
 * hack that raced the real height and overlapped tall replies.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CircleDot, GitBranch, Plus, TerminalSquare } from 'lucide-react';
import { DiffStat, IconButton, Spinner } from '@/renderer/components/ui';
import { useIsSessionRunning } from '@/renderer/features/sessions/useSessionRunning';
import { WorktreeTabs } from '@/renderer/features/sessions/WorktreeTabs';
import { ServicesStrip } from '@/renderer/features/sessions/ServicesStrip';
import { Logo } from '@/renderer/components/brand/Logo';
import { Composer } from './Composer';
import { ClarificationCard } from './ClarificationCard';
import { ConversationView } from './ConversationView';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useAttachmentStore } from '@/renderer/stores/useAttachmentStore';
import { useResumeStore } from '@/renderer/stores/useResumeStore';
import { ResumeBanner } from '@/renderer/features/resume/ResumeBanner';

export function CenterWorkspace() {
  const session = useSessionStore((s) =>
    s.sessions.find((item) => item.id === s.selectedId) ?? null,
  );
  const createSession = useSessionStore((s) => s.createSession);
  const loadSession = useAgentStore((s) => s.loadSession);
  const messageCount = useAgentStore((s) =>
    session ? (s.bySession[session.id]?.messages.length ?? 0) : 0,
  );
  // A paused AskUserQuestion for THIS session — the run resumes only once answered.
  const clarification = useAgentStore((s) =>
    session ? (s.pendingClarificationBySession[session.id] ?? null) : null,
  );

  // Restore the transcript whenever the selected session changes.
  useEffect(() => {
    if (session) {
      void loadSession(session.id);
      // Restore the session's attachment set (composer drafts + sent chips).
      void useAttachmentStore.getState().loadSession(session.id);
      // Hydrate the session's revalidation state (banner + header chip).
      void useResumeStore.getState().loadSession(session.id);
    }
  }, [session?.id, loadSession]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-surface">
      {/* Editor-style tabs for worktree-backed sessions (hidden when none exist). */}
      <WorktreeTabs />
      {session && <SessionHeader sessionId={session.id} title={session.title} branch={session.branch} adds={session.adds} dels={session.dels} />}
      {/* Supervised services for this session (hidden when none are declared). */}
      {session && <ServicesStrip sessionId={session.id} />}
      {/* Recovery affordance when the session's worktree directory vanished. */}
      {session?.worktreeStatus === 'missing' && <MissingWorktreeBanner sessionId={session.id} />}
      {/* Repository drift since this session's last snapshot (resume pipeline). */}
      {session && <ResumeBanner sessionId={session.id} />}

      {/* Scroll region — the single scroller. Messages live entirely above the
          docked composer below, so they are never overlapped or clipped. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col chat-font">
          {session ? (
            messageCount > 0 ? (
              <ConversationView sessionId={session.id} />
            ) : (
              <div className="m-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
                <Logo size={60} />
                <div className="flex flex-col gap-1.5">
                  <span className="text-[16px] font-semibold tracking-tight text-fg">
                    Start the conversation
                  </span>
                  <span className="text-[13px] leading-relaxed text-muted">
                    Describe what you want to build. Limboo coordinates the repository,
                    files, terminal, and tasks while Claude Code does the work.
                  </span>
                </div>
              </div>
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

      {/* Composer docked in normal flow — a soft top fade gives a clean scroll
          edge without floating over (and hiding) the conversation. When the agent
          is waiting on an AskUserQuestion, the clarification card takes the focus
          directly above the composer (which is disabled until it's answered). */}
      <div className="shrink-0">
        <div className="pointer-events-none h-3 bg-gradient-to-t from-surface to-transparent" />
        {clarification && <ClarificationCard key={clarification.id} request={clarification} />}
        <Composer disabled={!session || !!clarification} />
      </div>
    </main>
  );
}

/**
 * Recovery banner for a worktree session whose checkout directory vanished
 * (moved/deleted outside Limboo). Recreate re-provisions from the recorded
 * branch (or base ref); Detach reverts to a plain workspace-checkout session.
 */
function MissingWorktreeBanner({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const act = (fn: (id: string) => Promise<unknown> | undefined) => async () => {
    setBusy(true);
    try {
      await fn(sessionId);
    } catch (err) {
      useUIStore.getState().addToast({
        title: 'Worktree recovery failed',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
      <AlertTriangle size={13} className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
        This session&apos;s worktree directory is missing.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act((id) => window.limboo?.worktree.recreate(id))()}
        className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Recreate
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act((id) => window.limboo?.worktree.detach(id))()}
        className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg transition-colors hover:border-line-strong disabled:opacity-50"
      >
        Detach
      </button>
    </div>
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
  // Non-blocking revalidation indicator while the resume pipeline checks git.
  const revalidating = useResumeStore((s) => s.bySession[sessionId]?.phase === 'checking');
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4">
      {running ? <Spinner size={12} /> : <CircleDot size={12} className="text-success" />}
      <span className="text-[13px] font-medium">{title}</span>
      <span className="text-[11px] text-faint">{branch}</span>
      <DiffStat adds={adds} dels={dels} className="ml-2" />
      {running && <span className="text-[11px] text-accent">Working…</span>}
      {!running && revalidating && (
        <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          <Spinner size={10} />
          Revalidating…
        </span>
      )}
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
