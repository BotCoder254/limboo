/**
 * Workspace switcher in the title bar. Shows the active workspace (icon + name +
 * branch) and, on click, a dropdown to switch to another registered workspace or
 * open/create one. Replaces the old static session context pill.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, FolderPlus, GitBranch, Boxes, Check, RefreshCw } from 'lucide-react';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { WorkspaceIconBadge } from './WorkspaceIconBadge';
import type { Workspace } from '@shared/types';

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const pickDirectory = useWorkspaceStore((s) => s.pickDirectory);
  const open = useWorkspaceStore((s) => s.open);
  const setLauncherView = useWorkspaceStore((s) => s.setLauncherView);
  const rescan = useWorkspaceStore((s) => s.rescan);
  const addToast = useUIStore((s) => s.addToast);

  const active = workspaces.find((w) => w.id === activeId) ?? null;
  const [openMenu, setOpenMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenMenu(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  const pickAnd = async (action: (path: string) => Promise<Workspace | null>) => {
    setOpenMenu(false);
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      await action(dir);
    } catch (err) {
      addToast({
        title: 'Could not open workspace',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  };

  const runRescan = async (ws: Workspace) => {
    setOpenMenu(false);
    try {
      await rescan(ws.id);
      addToast({ title: `Rescanned ${ws.name}`, tone: 'info' });
    } catch (err) {
      addToast({
        title: 'Could not rescan workspace',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className="no-drag ml-1 flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-muted transition-colors hover:text-fg"
      >
        {active ? (
          <>
            <WorkspaceIconBadge icon={active.icon} size={16} />
            <span className="max-w-[12rem] truncate font-medium text-fg">{active.name}</span>
            {active.metadata.branch && (
              <>
                <span className="text-faint">/</span>
                <GitBranch size={11} />
                <span>{active.metadata.branch}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-faint">No workspace</span>
        )}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {openMenu && (
        // `no-drag` is REQUIRED: `-webkit-app-region` is inherited, so without it
        // every item in this menu inherits the title bar's `drag` region and the
        // OS swallows the clicks (the menu opens but nothing inside it responds).
        <div className="no-drag animate-pop-in absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-line-strong bg-elevated p-1.5 shadow-2xl">
          {workspaces.length > 0 ? (
            <ul className="max-h-72 overflow-y-auto">
              {workspaces.map((ws) => (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(false);
                      if (ws.id !== activeId) void switchTo(ws.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <WorkspaceIconBadge icon={ws.icon} size={20} />
                    <span className="min-w-0 flex-1 truncate text-fg">{ws.name}</span>
                    {ws.id === activeId && <Check size={13} className="text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-faint">
              <Boxes size={14} />
              No workspaces yet
            </div>
          )}

          <div className="my-1 border-t border-line" />
          {active && (
            <button
              type="button"
              onClick={() => void runRescan(active)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <RefreshCw size={14} />
              Rescan {active.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => pickAnd(open)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <FolderOpen size={14} />
            Open folder…
          </button>
          <button
            type="button"
            onClick={() => {
              setOpenMenu(false);
              setLauncherView('create');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <FolderPlus size={14} />
            Create workspace…
          </button>
        </div>
      )}
    </div>
  );
}
