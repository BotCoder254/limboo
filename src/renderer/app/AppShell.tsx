/**
 * The application shell — a floating app shell in two visual layers:
 *
 *   TitleBar                                          ← root background
 *   [SessionsSidebar]│┌──────────────────────────┐ [ActivityRail]
 *      (root bg)     ││ CenterWorkspace │ Drawer │    (root bg)
 *                    │└──────────────────────────┘
 *                     ghost      floating card (bg-surface, 6px radius)
 *
 * The title bar, sessions sidebar, and activity icon rail sit directly on the
 * pure-black root background (persistent/architectural UI). The center
 * workspace and the right drawer float together as one detached card —
 * bg-surface, border-line, rounded 6px — framed by an 8px side gutter and a
 * 16px bottom gutter so it never touches the window edges. The Composer lives only inside the center column;
 * the integrated terminal is one of the drawer tabs (own remembered width).
 * Panel widths + the open drawer tab come from the layout store (persisted).
 */
import { TitleBar } from '@/renderer/components/layout/TitleBar';
import { ResizeHandle } from '@/renderer/components/ui';
import { SessionsSidebar, CollapsedSessionsRail } from '@/renderer/features/sessions/SessionsSidebar';
import { CenterWorkspace } from '@/renderer/features/workspace/CenterWorkspace';
import { ActivityRail } from '@/renderer/features/activity/ActivityRail';
import { ActivityDrawer } from '@/renderer/features/activity/ActivityDrawer';
import { useResizable } from '@/renderer/hooks/useResizable';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';

export function AppShell() {
  const leftWidth = useLayoutStore((s) => s.leftWidth);
  const rightWidth = useLayoutStore((s) => s.rightWidth);
  const terminalWidth = useLayoutStore((s) => s.terminalWidth);
  const gitWidth = useLayoutStore((s) => s.gitWidth);
  const activeTab = useLayoutStore((s) => s.activeTab);
  const sessionsCollapsed = useLayoutStore((s) => s.sessionsCollapsed);
  const setLeftWidth = useLayoutStore((s) => s.setLeftWidth);

  // The terminal and git tabs each use their own (wider) remembered width; every
  // other tab uses the shared right-drawer width.
  const drawerWidth =
    activeTab === 'terminal' ? terminalWidth : activeTab === 'git' ? gitWidth : rightWidth;

  const left = useResizable({
    edge: 'left',
    getWidth: () => useLayoutStore.getState().leftWidth,
    setWidth: setLeftWidth,
  });
  const right = useResizable({
    edge: 'right',
    getWidth: () => {
      const s = useLayoutStore.getState();
      if (s.activeTab === 'terminal') return s.terminalWidth;
      if (s.activeTab === 'git') return s.gitWidth;
      return s.rightWidth;
    },
    setWidth: (w) => {
      const s = useLayoutStore.getState();
      if (s.activeTab === 'terminal') s.setTerminalWidth(w);
      else if (s.activeTab === 'git') s.setGitWidth(w);
      else s.setRightWidth(w);
    },
  });

  return (
    <div className="flex h-full w-full flex-col bg-base text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1 px-2 pb-4 pt-1">
        {sessionsCollapsed ? (
          <div className="mr-2 shrink-0">
            <CollapsedSessionsRail />
          </div>
        ) : (
          <>
            <div style={{ width: leftWidth }} className="shrink-0">
              <SessionsSidebar />
            </div>
            {/* The 8px gutter between sidebar and card IS the grab area. */}
            <ResizeHandle ghost onMouseDown={left.startDrag} />
          </>
        )}

        {/* Floating workspace card — center column + drawer share one surface. */}
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <div className="min-w-0 flex-1">
            <CenterWorkspace />
          </div>

          {activeTab && (
            <>
              <ResizeHandle onMouseDown={right.startDrag} />
              <div style={{ width: drawerWidth }} className="shrink-0">
                <ActivityDrawer tab={activeTab} />
              </div>
            </>
          )}
        </div>

        <div className="ml-2 shrink-0">
          <ActivityRail />
        </div>
      </div>
    </div>
  );
}
