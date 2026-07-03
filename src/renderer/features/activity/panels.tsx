/**
 * Activity drawer panels. Each panel is driven by the active session's agent
 * snapshot (from `useAgentStore`) and falls back to a real empty state when there
 * is nothing to show yet. The structured event stream from the main process keeps
 * these live as Claude Code works.
 */
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronsDownUp,
  FileDiff,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type {
  AgentActivityItem,
  FileChange,
  GitFileChange,
  SessionTimelineEntry,
} from '@shared/types';
import { DiffStat, EmptyState, IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';
import { runCommand } from '@/renderer/lib/commands';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore, EMPTY_SNAPSHOT } from '@/renderer/stores/useAgentStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { FileTree } from './FileTree';
import { GitFileRow } from '@/renderer/features/git/GitFileRow';

export { PlanPanel as TasksPanel } from './PlanPanel';

function useSnapshot() {
  const sessionId = useSessionStore((s) => s.selectedId);
  return useAgentStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_SNAPSHOT;
}

export function FilesPanel() {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const tree = useFileSystemStore((s) => (activeId ? s.treeByWs[activeId] : undefined));
  const progress = useFileSystemStore((s) => (activeId ? s.progressByWs[activeId] : undefined));
  const indexing = !!progress && progress.phase !== 'done';

  if (!activeId) {
    return (
      <EmptyState
        compact
        icon={FolderOpen}
        title="No workspace open"
        description="Open or create a workspace to browse and track its files here."
      />
    );
  }

  const children = tree?.root.children ?? [];

  if (children.length === 0) {
    return (
      <EmptyState
        compact
        icon={FolderOpen}
        title={indexing ? 'Indexing workspace…' : 'No files indexed'}
        description={
          indexing
            ? 'Building the directory tree — this populates automatically.'
            : 'Reindex the workspace to browse and track its files here.'
        }
        action={
          indexing ? undefined : (
            <button
              type="button"
              onClick={() => runCommand('workspace.reindex')}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-fg"
            >
              <RefreshCw size={12} /> Reindex workspace
            </button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col">
      <FileTree nodes={children} />
      {tree?.truncated && (
        <p className="px-2 py-2 text-[11px] italic text-faint">
          Large repository — only the first {tree.nodeCount.toLocaleString()} entries are shown.
        </p>
      )}
    </div>
  );
}

/**
 * Changes — the working tree as an expandable, reviewable list. Backed by the
 * authoritative git status (each file expands to its inline diff) when the
 * workspace is a repo; otherwise it falls back to the agent run's in-flight
 * change list. A toolbar offers expand/collapse-all, refresh, stage-all, and a
 * jump into the full Git workspace.
 */
export function ChangesPanel() {
  const snapshot = useSnapshot();
  const status = useGitStore((s) => s.status);
  const refresh = useGitStore((s) => s.refresh);
  const stageAll = useGitStore((s) => s.stageAll);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isRepo = !!status?.isRepo;
  const files = status?.files ?? [];

  // Outside a git repo, fall back to the agent snapshot's change list (no diffs).
  if (!isRepo) {
    if (snapshot.changes.length === 0) {
      return (
        <EmptyState
          compact
          icon={FileDiff}
          title="No changes yet"
          description="File additions, edits, and deletions made during a session appear here with diff counts."
        />
      );
    }
    return (
      <ul className="flex flex-col gap-0.5">
        {snapshot.changes.map((change) => (
          <SnapshotChangeRow key={change.path} change={change} />
        ))}
      </ul>
    );
  }

  if (files.length === 0) {
    return (
      <EmptyState
        compact
        icon={FileDiff}
        title="Working tree clean"
        description="No uncommitted changes. Edits made by you or the agent will appear here to review and stage."
      />
    );
  }

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const expandAll = () => setExpanded(new Set(files.map((f) => rowKey(f))));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 px-1 pb-1">
        <span className="mr-auto text-[11px] text-faint">
          {files.length} change{files.length === 1 ? '' : 's'}
        </span>
        <IconButton label="Expand all" size="sm" onClick={expandAll}>
          <ChevronsDownUp size={13} className="rotate-180" />
        </IconButton>
        <IconButton label="Collapse all" size="sm" onClick={collapseAll}>
          <ChevronsDownUp size={13} />
        </IconButton>
        <IconButton label="Stage all" size="sm" onClick={() => void stageAll()}>
          <Plus size={13} />
        </IconButton>
        <IconButton label="Refresh" size="sm" onClick={() => void refresh()}>
          <RefreshCw size={13} />
        </IconButton>
        <IconButton label="Open Git workspace" size="sm" onClick={() => setActiveTab('git')}>
          <GitBranch size={13} />
        </IconButton>
      </div>
      <ul className="flex flex-col gap-0.5">
        {files.map((f) => {
          const staged = !f.unstaged && f.staged;
          const key = rowKey(f);
          return (
            <GitFileRow
              key={key}
              change={f}
              staged={staged}
              expanded={expanded.has(key)}
              onToggle={() => toggle(key)}
            />
          );
        })}
      </ul>
    </div>
  );
}

/** Stable expand key for a change row (matches the diff side used for display). */
function rowKey(f: GitFileChange): string {
  const staged = !f.unstaged && f.staged;
  return `${staged ? 's' : 'w'}:${f.path}`;
}

/** Read-only row for the non-repo fallback (agent snapshot changes, no diff). */
function SnapshotChangeRow({ change }: { change: FileChange }) {
  const segments = change.path.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? change.path;
  const dir = segments.slice(0, -1).join('/');
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          change.status === 'added' && 'bg-success',
          change.status === 'modified' && 'bg-warning',
          change.status === 'deleted' && 'bg-danger',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={change.path}>
        {name}
        {dir && <span className="ml-1 text-faint">{dir}</span>}
      </span>
      <DiffStat adds={change.adds} dels={change.dels} />
    </li>
  );
}

const ACTIVITY_ICONS: Record<AgentActivityItem['type'], LucideIcon> = {
  prompt: MessageSquare,
  tool: Terminal,
  'file-change': FileDiff,
  permission: ShieldCheck,
  result: CheckCircle2,
  error: AlertTriangle,
  status: Activity,
};

export function ActivityFeedPanel() {
  const [view, setView] = useState<'activity' | 'timeline'>('activity');
  return (
    <div className="flex flex-col gap-2">
      {/* Activity = the live agent audit feed; Timeline = the unified session
          narrative merged from activity + diagnostics + checkpoints + lifecycle. */}
      <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
        {(['activity', 'timeline'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              'flex-1 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors',
              view === id ? 'bg-elevated text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {id}
          </button>
        ))}
      </div>
      {view === 'activity' ? <ActivityFeedList /> : <TimelineList />}
    </div>
  );
}

function ActivityFeedList() {
  const snapshot = useSnapshot();
  if (snapshot.activity.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No recent activity"
        description="Prompts, tool calls, edits, approvals, and results stream into this audit feed."
      />
    );
  }
  const items = [...snapshot.activity].reverse();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ACTIVITY_ICONS[item.type] ?? Activity;
        return (
          <li key={item.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
            <Icon
              size={13}
              className={cn(
                'mt-0.5 shrink-0',
                item.tone === 'success' && 'text-success',
                item.tone === 'warning' && 'text-warning',
                item.tone === 'danger' && 'text-danger',
                (!item.tone || item.tone === 'info') && 'text-muted',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{item.label}</span>
                <span className="shrink-0 text-[10px] text-faint">{relativeTime(item.at)}</span>
              </div>
              {item.detail && <p className="truncate text-[11px] text-faint">{item.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const TIMELINE_ICONS: Record<SessionTimelineEntry['kind'], LucideIcon> = {
  activity: Activity,
  diagnostic: ShieldCheck,
  checkpoint: GitBranch,
  lifecycle: CheckCircle2,
};

/**
 * The unified engineering timeline: everything that happened in this session —
 * agent activity, diagnostics (hooks, recovery, worktree events), git
 * checkpoints, and lifecycle milestones — merged chronologically by the main
 * process (no duplicate storage; derived by query).
 */
function TimelineList() {
  const sessionId = useSessionStore((s) => s.selectedId);
  const [entries, setEntries] = useState<SessionTimelineEntry[] | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setEntries(null);
    void window.limboo?.session
      .timeline(sessionId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (entries === null) return null;
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No timeline yet"
        description="Every meaningful event — prompts, tools, checkpoints, hooks, diagnostics — becomes a timeline entry."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => {
        const Icon = TIMELINE_ICONS[entry.kind] ?? Activity;
        return (
          <li key={`${entry.kind}:${entry.id}`} className="flex items-start gap-2 rounded-md px-2 py-1.5">
            <Icon size={13} className="mt-0.5 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{entry.label}</span>
                <span className="shrink-0 text-[10px] text-faint">{relativeTime(entry.at)}</span>
              </div>
              {entry.detail && <p className="truncate text-[11px] text-faint">{entry.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
