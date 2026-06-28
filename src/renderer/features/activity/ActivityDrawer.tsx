/**
 * The collapsible right drawer. Renders the panel for the currently-open tab
 * (driven by the layout store). When no tab is active the drawer is not
 * rendered at all (the AppShell collapses it), so this component assumes a tab.
 */
import type { ActivityTab } from '@shared/types';
import { ACTIVITY_TABS } from './tabs';
import { ActivityFeedPanel, ChangesPanel, FilesPanel, TasksPanel } from './panels';
import { AgentConsolePanel } from './AgentConsolePanel';

export function ActivityDrawer({ tab }: { tab: ActivityTab }) {
  const meta = ACTIVITY_TABS.find((t) => t.id === tab) ?? ACTIVITY_TABS[0];

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wider text-fg">
        <meta.icon size={13} className="text-muted" />
        <span>{meta.label}</span>
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
