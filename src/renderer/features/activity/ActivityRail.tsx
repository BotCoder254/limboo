/**
 * Fixed far-right icon rail. Each tab toggles its drawer panel open/closed; the
 * active tab shows an accent indicator. Backed by the layout store so the open
 * tab persists across launches.
 */
import type { ActivityTab } from '@shared/types';
import { ACTIVITY_TABS } from './tabs';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useMemoryStore } from '@/renderer/stores/useMemoryStore';
import { cn } from '@/renderer/lib/cn';

export function ActivityRail() {
  const activeTab = useLayoutStore((s) => s.activeTab);
  const toggleTab = useLayoutStore((s) => s.toggleTab);
  // Unpushed commits drive a badge on the Git tab; pending memory proposals do
  // the same on the Memory tab. Both are subtle accent dots with an optional count.
  const ahead = useGitStore((s) => s.status?.ahead ?? 0);
  const proposals = useMemoryStore((s) => s.proposals.length);

  const badgeFor = (id: ActivityTab): number => {
    if (id === 'git') return ahead;
    if (id === 'memory') return proposals;
    return 0;
  };

  return (
    <nav className="flex h-full w-12 shrink-0 flex-col items-center gap-1 bg-base py-2">
      {ACTIVITY_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const badge = badgeFor(tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            title={badge > 0 ? `${tab.label} (${badge})` : tab.label}
            onClick={() => toggleTab(tab.id)}
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
              isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {isActive && (
              <span className="absolute -right-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
            )}
            <tab.icon size={17} />
            {badge > 0 && (
              <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-bold leading-none text-base">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
