/**
 * The collapsible right drawer. Renders the panel for the currently-open tab
 * (driven by the layout store). When no tab is active the drawer is not
 * rendered at all (the AppShell collapses it), so this component assumes a tab.
 *
 * The Files tab adds a header action group on the right: a reindex button and a
 * circular progress ring that fills while the File System Layer rebuilds the
 * workspace's directory tree.
 */
import { FolderOpen, RefreshCw } from 'lucide-react';
import type { ActivityTab } from '@shared/types';
import { CircularProgress, IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';
import { runCommand } from '@/renderer/lib/commands';
import { ACTIVITY_TABS } from './tabs';
import { ActivityFeedPanel, ChangesPanel, FilesPanel, TasksPanel } from './panels';
import { AgentConsolePanel } from './AgentConsolePanel';
import { TerminalPanel } from '@/renderer/features/terminal/TerminalPanel';
import { GitPanel } from '@/renderer/features/git/GitPanel';
import { MemoryPanel } from '@/renderer/features/memory/MemoryPanel';

export function ActivityDrawer({ tab }: { tab: ActivityTab }) {
  const meta = ACTIVITY_TABS.find((t) => t.id === tab) ?? ACTIVITY_TABS[0];

  // The terminal and git workspaces own their own headers (tab strip + controls),
  // so they render full-bleed without the drawer's title bar or content padding.
  if (tab === 'terminal') return <TerminalPanel />;
  if (tab === 'git') return <GitPanel />;
  if (tab === 'memory') return <MemoryPanel />;

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wider text-fg">
        <meta.icon size={13} className="text-muted" />
        <span>{meta.label}</span>
        {tab === 'files' && <FilesHeaderActions />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'files' && <FilesPanel />}
        {tab === 'changes' && <ChangesPanel />}
        {tab === 'tasks' && <TasksPanel />}
        {tab === 'activity' && <ActivityFeedPanel />}
        {tab === 'console' && <AgentConsolePanel />}
      </div>
    </section>
  );
}

/** Reindex button + live circular progress, shown to the right of the Files title. */
function FilesHeaderActions() {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const progress = useFileSystemStore((s) => (activeId ? s.progressByWs[activeId] : undefined));
  const indexing = !!progress && progress.phase !== 'done';

  return (
    <div className="ml-auto flex items-center gap-1.5">
      {indexing && <CircularProgress value={progress?.percent ?? 0} size={14} />}
      <IconButton
        label="Reveal in file explorer"
        size="sm"
        disabled={!activeId}
        onClick={() => activeId && void window.limboo?.fs?.reveal(activeId)}
        className="disabled:pointer-events-none disabled:opacity-50"
      >
        <FolderOpen size={13} />
      </IconButton>
      <IconButton
        label={indexing ? 'Reindexing…' : 'Reindex workspace'}
        size="sm"
        disabled={!activeId || indexing}
        onClick={() => runCommand('workspace.reindex')}
        className="disabled:pointer-events-none disabled:opacity-50"
      >
        <RefreshCw size={13} className={cn(indexing && 'animate-spin')} />
      </IconButton>
    </div>
  );
}
