/**
 * The Git workspace — a full-height right-drawer tab (mirrors the integrated
 * terminal). A compact header carries the branch, sub-view tabs, and the
 * top-right controls (refresh / fetch / checkpoint / close); the body renders the
 * active sub-view. Git is presented as the project's living timeline rather than
 * raw commands: Changes (status + staging + commit), History, Checkpoints, and
 * Branches.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  DownloadCloud,
  FolderGit2,
  GitBranch,
  History,
  ListChecks,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import type { GitFileChange } from '@shared/types';
import { EmptyState, IconButton, Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useGitStore, type GitView } from '@/renderer/stores/useGitStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { GitFileRow } from './GitFileRow';
import { GitHistory } from './GitHistory';
import { GitCheckpoints } from './GitCheckpoints';
import { GitBranches } from './GitBranches';

type SubTab = 'changes' | 'history' | 'checkpoints' | 'branches';

const SUB_TABS: { id: SubTab; label: string; icon: typeof GitBranch }[] = [
  { id: 'changes', label: 'Changes', icon: ListChecks },
  { id: 'history', label: 'History', icon: History },
  { id: 'checkpoints', label: 'Checkpoints', icon: Save },
  { id: 'branches', label: 'Branches', icon: GitBranch },
];

/** Map an activity-card focus view onto a sub-tab. */
function tabForView(view: GitView): SubTab {
  if (view === 'history') return 'history';
  if (view === 'checkpoints') return 'checkpoints';
  if (view === 'branches') return 'branches';
  return 'changes';
}

export function GitPanel() {
  const status = useGitStore((s) => s.status);
  const loading = useGitStore((s) => s.loading);
  const refresh = useGitStore((s) => s.refresh);
  const fetch = useGitStore((s) => s.fetch);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const focus = useGitStore((s) => s.focus);
  const setFocus = useGitStore((s) => s.setFocus);
  const init = useGitStore((s) => s.init);
  const createCheckpoint = useGitStore((s) => s.createCheckpoint);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const confirmForcePush = useSettingsStore((s) => s.settings.git.push.confirmForcePush);
  const addToast = useUIStore((s) => s.addToast);
  const [tab, setTab] = useState<SubTab>('changes');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Activity-card jump: when a focus target is published, switch sub-tab.
  useEffect(() => {
    if (focus) {
      setTab(tabForView(focus.view));
      setFocus(null);
    }
  }, [focus, setFocus]);

  const doFetch = async () => {
    const ok = await fetch();
    addToast({ title: ok ? 'Fetched from remotes' : 'Fetch failed', tone: ok ? 'info' : 'danger' });
  };

  const hasUpstream = !!status?.upstream;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  const doPush = async (force = false) => {
    if (busy) return;
    if (force && confirmForcePush) {
      const ok = window.confirm(
        'Force push with lease? This overwrites the remote branch with your local history. ' +
          'It is rejected if someone else has pushed in the meantime.',
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await push({ force: force || undefined, setUpstream: !hasUpstream || undefined });
    } finally {
      setBusy(false);
    }
  };

  const doPull = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pull();
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.isRepo) {
    return (
      <Shell branch={undefined} tab={tab} onTab={setTab} status={status} onClose={() => setActiveTab(null)}>
        <EmptyState
          icon={FolderGit2}
          title="Not a git repository"
          description="This workspace isn't version-controlled yet. Initialize a repository to track changes, create checkpoints, and review the agent's work."
          action={
            <button
              type="button"
              onClick={() => void init()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base hover:opacity-90"
            >
              <GitBranch size={13} /> Initialize git
            </button>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell
      branch={status?.branch}
      tab={tab}
      onTab={setTab}
      status={status}
      loading={loading || busy}
      onRefresh={() => void refresh()}
      onFetch={status?.hasRemote ? () => void doFetch() : undefined}
      onPush={status?.hasRemote ? (force) => void doPush(force) : undefined}
      onPull={status?.hasRemote && hasUpstream ? () => void doPull() : undefined}
      ahead={ahead}
      behind={behind}
      hasUpstream={hasUpstream}
      busy={busy}
      onCheckpoint={() => void createCheckpoint('Manual checkpoint')}
      onClose={() => setActiveTab(null)}
    >
      {tab === 'changes' && <ChangesView />}
      {tab === 'history' && <GitHistory />}
      {tab === 'checkpoints' && <GitCheckpoints />}
      {tab === 'branches' && <GitBranches />}
    </Shell>
  );
}

function Shell({
  branch,
  tab,
  onTab,
  status,
  loading,
  onRefresh,
  onFetch,
  onPush,
  onPull,
  ahead = 0,
  behind = 0,
  hasUpstream = false,
  busy = false,
  onCheckpoint,
  onClose,
  children,
}: {
  branch?: string;
  tab: SubTab;
  onTab: (t: SubTab) => void;
  status: ReturnType<typeof useGitStore.getState>['status'];
  loading?: boolean;
  onRefresh?: () => void;
  onFetch?: () => void;
  onPush?: (force: boolean) => void;
  onPull?: () => void;
  ahead?: number;
  behind?: number;
  hasUpstream?: boolean;
  busy?: boolean;
  onCheckpoint?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isRepo = status?.isRepo ?? true;
  const canPush = ahead > 0 || !hasUpstream;
  const diverged = ahead > 0 && behind > 0;
  return (
    <section className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1.5">
        <GitBranch size={13} className="shrink-0 text-muted" />
        <span className="max-w-[120px] truncate text-[12px] font-medium text-fg" title={branch}>
          {branch ?? 'git'}
        </span>
        {(ahead > 0 || behind > 0) && (
          <span
            className={cn(
              'rounded-full px-1.5 font-mono text-[10px]',
              ahead > 0 ? 'bg-accent/15 text-accent' : 'text-faint',
            )}
            title={`${ahead} ahead, ${behind} behind`}
          >
            {ahead > 0 && `↑${ahead}`}
            {ahead > 0 && behind > 0 && ' '}
            {behind > 0 && `↓${behind}`}
          </span>
        )}
        {loading && <Spinner size={11} />}
        <div className="ml-auto flex items-center">
          {onPull && (
            <IconButton label={behind > 0 ? `Pull ${behind} commit${behind === 1 ? '' : 's'}` : 'Pull'} size="sm" disabled={busy} onClick={onPull}>
              <ArrowDownToLine size={14} className={cn(behind > 0 && 'text-accent')} />
            </IconButton>
          )}
          {onPush && (
            <IconButton
              label={
                !hasUpstream
                  ? 'Publish branch'
                  : diverged
                    ? 'Diverged — pull before pushing (Shift-click to force)'
                    : ahead > 0
                      ? `Push ${ahead} commit${ahead === 1 ? '' : 's'} (Shift-click to force)`
                      : 'Nothing to push'
              }
              size="sm"
              disabled={busy || !canPush}
              onClick={(e) => onPush((e as React.MouseEvent).shiftKey)}
            >
              {!hasUpstream ? (
                <UploadCloud size={14} className="text-accent" />
              ) : (
                <ArrowUpFromLine size={14} className={cn(ahead > 0 && 'text-accent')} />
              )}
            </IconButton>
          )}
          {onCheckpoint && (
            <IconButton label="Create checkpoint" size="sm" onClick={onCheckpoint}>
              <Save size={14} />
            </IconButton>
          )}
          {onFetch && (
            <IconButton label="Fetch" size="sm" onClick={onFetch}>
              <DownloadCloud size={14} />
            </IconButton>
          )}
          {onRefresh && (
            <IconButton label="Refresh" size="sm" onClick={onRefresh}>
              <RefreshCw size={14} />
            </IconButton>
          )}
          <IconButton label="Close git" size="sm" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {isRepo && (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1.5 py-1">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
                tab === t.id ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
              )}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------- Changes view */

function ChangesView() {
  const status = useGitStore((s) => s.status);
  const stageAll = useGitStore((s) => s.stageAll);
  const unstageAll = useGitStore((s) => s.unstageAll);
  const commit = useGitStore((s) => s.commit);
  const message = useGitStore((s) => s.commitMessage);
  const setMessage = useGitStore((s) => s.setCommitMessage);
  const generating = useGitStore((s) => s.generatingMessage);
  const generateMessage = useGitStore((s) => s.generateCommitMessage);
  const cancelGenerate = useGitStore((s) => s.cancelCommitMessage);
  const agentReady = useAgentStore((s) => s.install.installed);
  const template = useSettingsStore((s) => s.settings.git.commitMessageTemplate);
  const addToast = useUIStore((s) => s.addToast);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    const { commitMessage, setCommitMessage } = useGitStore.getState();
    if (commitMessage === '' && template) setCommitMessage(template);
  }, [template]);

  const { staged, unstaged } = useMemo(() => splitFiles(status?.files ?? []), [status?.files]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const doCommit = async () => {
    const trimmed = message.trim();
    if (!trimmed || generating) return;
    setCommitting(true);
    try {
      const ok = await commit(trimmed);
      if (ok) {
        setMessage('');
        addToast({ title: 'Committed', tone: 'success' });
      } else {
        addToast({ title: 'Nothing committed', description: 'Stage changes first.', tone: 'warning' });
      }
    } catch (err) {
      addToast({
        title: 'Commit failed',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setCommitting(false);
    }
  };

  if (status?.clean) {
    return (
      <EmptyState
        compact
        icon={Check}
        title="Working tree clean"
        description="No uncommitted changes. Edits made by you or the agent will show up here to review, stage, and commit."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {staged.length > 0 && (
        <Section
          title={`Staged (${staged.length})`}
          action={
            <button
              type="button"
              onClick={() => void unstageAll()}
              className="text-[11px] text-muted hover:text-fg"
            >
              Unstage all
            </button>
          }
        >
          <ul className="flex flex-col gap-0.5">
            {staged.map((f) => (
              <GitFileRow
                key={`s:${f.path}`}
                change={f}
                staged
                expanded={expanded.has(`s:${f.path}`)}
                onToggle={() => toggle(`s:${f.path}`)}
              />
            ))}
          </ul>
        </Section>
      )}

      {unstaged.length > 0 && (
        <Section
          title={`Changes (${unstaged.length})`}
          action={
            <button
              type="button"
              onClick={() => void stageAll()}
              className="text-[11px] text-muted hover:text-fg"
            >
              Stage all
            </button>
          }
        >
          <ul className="flex flex-col gap-0.5">
            {unstaged.map((f) => (
              <GitFileRow
                key={`w:${f.path}`}
                change={f}
                staged={false}
                expanded={expanded.has(`w:${f.path}`)}
                onToggle={() => toggle(`w:${f.path}`)}
              />
            ))}
          </ul>
        </Section>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          readOnly={generating}
          placeholder={generating ? 'Generating commit message…' : 'Commit message'}
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void doCommit();
          }}
          className="w-full resize-y rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={staged.length === 0 || !message.trim() || committing || generating}
            onClick={() => void doCommit()}
            title={`Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}`}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Check size={13} />
            {committing ? 'Committing…' : `Commit ${staged.length}`}
          </button>
          <button
            type="button"
            disabled={unstaged.length === 0}
            onClick={() => void stageAll()}
            title="Stage all changes"
            className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-fg disabled:opacity-40"
          >
            <Plus size={12} />
            Stage all
          </button>
          <button
            type="button"
            disabled={staged.length === 0}
            onClick={() => void unstageAll()}
            title="Unstage all changes"
            className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-fg disabled:opacity-40"
          >
            <Minus size={12} />
            Unstage all
          </button>
          <div className="flex-1" />
          {generating ? (
            <button
              type="button"
              onClick={cancelGenerate}
              title="Cancel generation"
              className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-fg"
            >
              <X size={12} />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={staged.length === 0 || !agentReady || committing}
              onClick={() => void generateMessage()}
              title={
                agentReady
                  ? 'Generate a commit message with the agent'
                  : 'Claude Code is not available — sign in to generate commit messages'
              }
              className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-accent transition-colors hover:border-line-strong disabled:opacity-40"
            >
              <Sparkles size={12} />
              Generate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Split the status list into staged-side and unstaged-side rows (a partially
 *  staged file appears in both). */
function splitFiles(files: GitFileChange[]): { staged: GitFileChange[]; unstaged: GitFileChange[] } {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  for (const f of files) {
    if (f.staged) staged.push(f);
    if (f.unstaged) unstaged.push(f);
  }
  return { staged, unstaged };
}
