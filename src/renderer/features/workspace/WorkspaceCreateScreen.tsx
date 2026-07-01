/**
 * Full-screen "Create workspace" screen. Shown by `App` whenever the launcher
 * view is set to `create` — from the empty launcher OR from the title-bar
 * workspace switcher while a workspace is already active. It owns the window so
 * the in-app Create flow works in both cases (previously the panel only rendered
 * inside `WorkspaceLauncher`, which is hidden once a workspace is active).
 *
 * Structure mirrors `WorkspaceSelection` (frameless TitleBar + body + the same
 * animated skyline footer) so the Create flow reads as the same product as the
 * selection screen. "Back to workspaces" in the panel resets the view to `list`,
 * returning to the shell (active workspace) or the selection screen (none).
 */
import { TitleBar } from '@/renderer/components/layout/TitleBar';
import { WorkspaceCreatePanel } from './WorkspaceCreatePanel';
import { WorkspaceSkyline } from './WorkspaceSkyline';

export function WorkspaceCreateScreen() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-base text-fg">
      <TitleBar />
      <div className="relative min-h-0 flex-1 px-4">
        <WorkspaceCreatePanel />
        {/* Soft fade so the form dissolves into the skyline instead of colliding. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-base to-transparent" />
      </div>
      {/* Full-window-width skyline footer, matching the selection screen. */}
      <WorkspaceSkyline className="h-[24vh] max-h-[220px] min-h-[130px] shrink-0" />
    </div>
  );
}
