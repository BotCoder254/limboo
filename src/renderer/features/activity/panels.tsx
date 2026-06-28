/**
 * Activity drawer panels. Each panel is driven by the active session's agent
 * snapshot (from `useAgentStore`) and falls back to a real empty state when there
 * is nothing to show yet. The structured event stream from the main process keeps
 * these live as Claude Code works.
 */
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  FolderOpen,
  ListTodo,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { AgentActivityItem, FileChange } from '@shared/types';
import { DiffStat, EmptyState } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';
import { runCommand } from '@/renderer/lib/commands';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore, EMPTY_SNAPSHOT } from '@/renderer/stores/useAgentStore';

function useSnapshot() {
  const sessionId = useSessionStore((s) => s.selectedId);
  return useAgentStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_SNAPSHOT;
}

export function FilesPanel() {
  const sessionId = useSessionStore((s) => s.selectedId);
  return (
    <EmptyState
      compact
      icon={FolderOpen}
      title="No files indexed"
      description="Reindex the workspace to browse and track its files here."
      action={
        <button
          type="button"
          disabled={!sessionId}
          onClick={() => runCommand('workspace.reindex')}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={12} /> Reindex workspace
        </button>
      }
    />
  );
}

export function ChangesPanel() {
  const snapshot = useSnapshot();
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
        <ChangeRow key={change.path} change={change} />
      ))}
    </ul>
  );
}

function ChangeRow({ change }: { change: FileChange }) {
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

export function TasksPanel() {
  const snapshot = useSnapshot();
  if (snapshot.tasks.length === 0) {
    return (
      <EmptyState
        compact
        icon={ListTodo}
        title="No tasks"
        description="The agent's plan and task checklist for the active session shows up here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {snapshot.tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <span
            className={cn(
              'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
              task.done ? 'border-success bg-success/20 text-success' : 'border-line-strong text-transparent',
            )}
          >
            <CheckCircle2 size={10} />
          </span>
          <span className={cn('text-[12px]', task.done ? 'text-faint line-through' : 'text-fg')}>
            {task.label}
          </span>
        </li>
      ))}
    </ul>
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
