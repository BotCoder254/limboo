/**
 * Full-screen Workspace Selection experience, shown by `App` whenever no
 * workspace is active. It replaces the entire shell: every workspace-dependent
 * surface (sessions, conversation, git, files, tasks, memory) is unavailable
 * until a project is opened, reinforcing that the workspace is the single source
 * of truth every subsystem depends on.
 *
 * Structure: the frameless TitleBar on top (window controls + drag preserved),
 * the recent-workspaces launcher in the body, and a themed, full-width animated
 * skyline anchored to the bottom. A drag overlay covers the whole body so a folder
 * can be dropped anywhere on the window (it only appears while dragging). Pure
 * black, dark only — reuses existing primitives so it matches the app exactly.
 */
import { TitleBar } from '@/renderer/components/layout/TitleBar';
import { WorkspaceLauncher } from './WorkspaceLauncher';
import { WorkspaceSkyline } from './WorkspaceSkyline';
import { WorkspaceDragOverlay } from './WorkspaceDropZone';

export function WorkspaceSelection() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-base text-fg">
      <TitleBar />
      {/* Body: the launcher scrolls internally; the drop overlay fills it during a
          drag. `relative` anchors both the overlay and the bottom fade. */}
      <div className="relative min-h-0 flex-1 px-4">
        <WorkspaceLauncher />
        <WorkspaceDragOverlay />
        {/* Soft fade so the list dissolves into the skyline instead of colliding. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-base to-transparent" />
      </div>
      {/* Full-window-width skyline footer, edge to edge, alive on hover. */}
      <WorkspaceSkyline className="h-[24vh] max-h-[220px] min-h-[130px] shrink-0" />
    </div>
  );
}
