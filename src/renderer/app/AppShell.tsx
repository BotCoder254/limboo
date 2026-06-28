/**
 * The application shell: a full-height column with the frameless title bar on
 * top and a horizontal row of resizable regions below it.
 *
 *   TitleBar
 *   [SessionsSidebar][handle][CenterWorkspace][handle][ActivityDrawer] ActivityRail
 *
 * The left sidebar and right drawer run full height; the Composer lives only
 * inside the center column. Panel widths + the open drawer tab come from the
 * layout store (persisted to settings).
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
  const activeTab = useLayoutStore((s) => s.activeTab);
  const sessionsCollapsed = useLayoutStore((s) => s.sessionsCollapsed);
  const setLeftWidth = useLayoutStore((s) => s.setLeftWidth);
  const setRightWidth = useLayoutStore((s) => s.setRightWidth);

  const left = useResizable({
    edge: 'left',
    getWidth: () => useLayoutStore.getState().leftWidth,
    setWidth: setLeftWidth,
  });
  const right = useResizable({
    edge: 'right',
    getWidth: () => useLayoutStore.getState().rightWidth,
    setWidth: setRightWidth,
  });

  return (
    <div className="flex h-full w-full flex-col bg-base text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sessionsCollapsed ? (
          <div className="shrink-0">
            <CollapsedSessionsRail />
          </div>
        ) : (
          <>
            <div style={{ width: leftWidth }} className="shrink-0">
              <SessionsSidebar />
            </div>
            <ResizeHandle onMouseDown={left.startDrag} />
          </>
        )}

        <div className="min-w-0 flex-1">
          <CenterWorkspace />
        </div>

        {activeTab && (
          <>
            <ResizeHandle onMouseDown={right.startDrag} />
            <div style={{ width: rightWidth }} className="shrink-0">
              <ActivityDrawer tab={activeTab} />
            </div>
          </>
        )}
        <ActivityRail />
      </div>
    </div>
  );
}
