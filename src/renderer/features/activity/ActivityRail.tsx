/**
 * Fixed far-right icon rail. Each tab toggles its drawer panel open/closed; the
 * active tab shows an accent indicator. Backed by the layout store so the open
 * tab persists across launches.
 */
import { ACTIVITY_TABS } from './tabs';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { cn } from '@/renderer/lib/cn';

export function ActivityRail() {
  const activeTab = useLayoutStore((s) => s.activeTab);
  const toggleTab = useLayoutStore((s) => s.toggleTab);

  return (
    <nav className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-line bg-surface py-2">
      {ACTIVITY_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            title={tab.label}
            onClick={() => toggleTab(tab.id)}
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
              isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {isActive && (
              <span className="absolute -right-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
            )}
            <tab.icon size={17} />
          </button>
        );
      })}
    </nav>
  );
}
