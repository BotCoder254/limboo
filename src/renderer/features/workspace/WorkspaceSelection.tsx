/**
 * Full-screen Workspace Selection experience, shown by `App` whenever no
 * workspace is active. It replaces the entire shell: every workspace-dependent
 * surface (sessions, conversation, git, files, tasks, memory) is unavailable
 * until a project is opened, reinforcing that the workspace is the single source
 * of truth every subsystem depends on.
 *
 * Structure: the frameless TitleBar on top (window controls + drag preserved),
 * then the recent-workspaces launcher centered in the body. Pure-black, dark
 * only — reuses existing primitives so it matches the rest of the app exactly.
 */
import { TitleBar } from '@/renderer/components/layout/TitleBar';
import { WorkspaceLauncher } from './WorkspaceLauncher';

export function WorkspaceSelection() {
  return (
    <div className="flex h-full w-full flex-col bg-base text-fg">
      <TitleBar />
      {/* The launcher owns its own internal scroll for the workspace list, so
          give it the full remaining height rather than a second scroller. */}
      <div className="min-h-0 flex-1 px-4">
        <WorkspaceLauncher />
      </div>
    </div>
  );
}
