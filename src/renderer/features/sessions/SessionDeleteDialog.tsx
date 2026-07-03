/**
 * Delete confirmation for a session that owns resources — shows a dependency
 * summary (worktree directory + dirtiness, branch, terminals, checkpoints,
 * memory links, plan) fetched from the main process, and lets the user keep the
 * branch / worktree while trashing the session. Plain sessions without owned
 * resources never see this dialog (the sidebar keeps the one-click fast path).
 *
 * Matches the app modal idiom (centered overlay, `bg-elevated`, pop-in) — the
 * same shell as WorkspaceRemoveDialog. Dark only, token colors only.
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  FileClock,
  FolderGit2,
  GitBranch,
  ListTodo,
  TerminalSquare,
  X,
} from 'lucide-react';
import type { Session, SessionDependencies } from '@shared/types';
import { Spinner } from '@/renderer/components/ui';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

export function SessionDeleteDialog({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const removeSession = useSessionStore((s) => s.removeSession);
  const [deps, setDeps] = useState<SessionDependencies | null>(null);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.limboo?.session
      .getDependencies(session.id)
      .then((d) => {
        if (!cancelled) setDeps(d);
      })
      .catch(() => {
        if (!cancelled) {
          setDeps({
            worktree: null,
            branch: null,
            terminals: 0,
            checkpoints: 0,
            memoryLinks: 0,
            hasPlan: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = deps?.worktree?.dirty ?? false;

  const confirm = async () => {
    setBusy(true);
    try {
      await removeSession(session.id, {
        removeWorktree: removeWorktree && !!deps?.worktree,
        deleteBranch: deleteBranch && !!deps?.branch?.exists,
        // The dialog spells out that uncommitted changes are discarded — the
        // user's explicit confirm here is the force acknowledgment.
        force: dirty && removeWorktree,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={onClose}
    >
      <div
        className="animate-pop-in flex w-full max-w-md flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <AlertTriangle size={14} className="text-warning" />
            Delete session
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-[12px] leading-relaxed text-muted">
            <span className="font-medium text-fg">{session.title}</span> moves to the recoverable
            trash. It owns the resources below — choose what to keep.
          </p>

          {!deps ? (
            <div className="flex items-center justify-center py-4">
              <Spinner size={16} />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-2.5">
              {deps.worktree && (
                <DepRow
                  icon={FolderGit2}
                  label="Worktree"
                  value={deps.worktree.exists ? deps.worktree.path : 'directory missing'}
                  warn={dirty ? 'has uncommitted changes' : undefined}
                />
              )}
              {deps.branch && (
                <DepRow
                  icon={GitBranch}
                  label="Branch"
                  value={deps.branch.exists ? deps.branch.name : `${deps.branch.name} (gone)`}
                />
              )}
              {deps.terminals > 0 && (
                <DepRow
                  icon={TerminalSquare}
                  label="Terminals"
                  value={`${deps.terminals} running`}
                />
              )}
              {deps.checkpoints > 0 && (
                <DepRow icon={FileClock} label="Checkpoints" value={String(deps.checkpoints)} />
              )}
              {deps.memoryLinks > 0 && (
                <DepRow icon={Brain} label="Memory links" value={String(deps.memoryLinks)} />
              )}
              {deps.hasPlan && <DepRow icon={ListTodo} label="Plan" value="1 saved plan" />}
            </div>
          )}

          {deps?.worktree && (
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={removeWorktree}
                onChange={(e) => setRemoveWorktree(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                Remove the worktree directory
                {dirty && (
                  <span className="block text-[11px] text-warning">
                    Uncommitted changes in the worktree will be discarded.
                  </span>
                )}
              </span>
            </label>
          )}
          {deps?.branch?.exists && (
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                Delete branch <span className="font-medium text-fg">{deps.branch.name}</span>
                <span className="block text-[11px] text-faint">
                  Kept by default so committed work stays recoverable.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!deps || busy}
            onClick={() => void confirm()}
            className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Spinner size={12} />}
            {dirty && removeWorktree ? 'Discard changes & delete' : 'Delete session'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DepRow({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: typeof GitBranch;
  label: string;
  value: string;
  warn?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <Icon size={13} className="mt-0.5 shrink-0 text-faint" />
      <span className="w-24 shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fg" title={value}>
          {value}
        </span>
        {warn && <span className="text-[11px] text-warning">{warn}</span>}
      </span>
    </div>
  );
}
