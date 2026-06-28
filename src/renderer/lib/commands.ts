/**
 * The command registry — the single source of truth for invokable actions used
 * by the command palette, keyboard shortcuts, and native menu/tray items.
 *
 * Commands operate on Zustand stores via `getState()` so they can run from
 * anywhere (inside or outside React) without prop drilling.
 */
import type { CommandId } from '@shared/types';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

/** Reindex the active workspace, surfacing the outcome as a toast. */
async function reindexActiveWorkspace(): Promise<void> {
  const store = useWorkspaceStore.getState();
  const id = store.activeId;
  if (!id) {
    useUIStore.getState().addToast({ title: 'No active workspace to reindex', tone: 'warning' });
    return;
  }
  try {
    await store.rescan(id);
    useUIStore.getState().addToast({ title: 'Workspace reindexed', tone: 'success' });
  } catch (err) {
    useUIStore.getState().addToast({
      title: 'Reindex failed',
      description: err instanceof Error ? err.message : String(err),
      tone: 'danger',
    });
  }
}

/** Pick a directory and run a workspace action, surfacing errors as a toast. */
async function pickWorkspace(action: 'open' | 'create'): Promise<void> {
  const store = useWorkspaceStore.getState();
  try {
    const dir = await store.pickDirectory();
    if (!dir) return;
    if (action === 'open') await store.open(dir);
    else await store.create(dir);
  } catch (err) {
    useUIStore.getState().addToast({
      title: 'Could not open workspace',
      description: err instanceof Error ? err.message : String(err),
      tone: 'danger',
    });
  }
}

export interface Command {
  id: CommandId;
  title: string;
  /** Section heading in the palette. */
  section: 'Sessions' | 'View' | 'General' | 'Workspace' | 'Agent';
  /** Default keybinding, expressed with `Mod` for Cmd/Ctrl. */
  keys?: string[];
  /** Whether this command should be listed in the palette UI. */
  inPalette?: boolean;
  run: () => void;
}

export const COMMANDS: Command[] = [
  {
    id: 'workspace.open',
    title: 'Open folder as workspace',
    section: 'Workspace',
    keys: ['Mod', 'O'],
    inPalette: true,
    run: () => void pickWorkspace('open'),
  },
  {
    id: 'workspace.new',
    title: 'Create workspace',
    section: 'Workspace',
    inPalette: true,
    run: () => void pickWorkspace('create'),
  },
  {
    id: 'session.new',
    title: 'New session',
    section: 'Sessions',
    keys: ['Mod', 'N'],
    inPalette: true,
    run: () => {
      useSessionStore.getState().createSession();
    },
  },
  {
    id: 'agent.newSession',
    title: 'New agent session',
    section: 'Agent',
    inPalette: true,
    run: () => {
      useSessionStore.getState().createSession();
    },
  },
  {
    id: 'agent.stop',
    title: 'Stop the agent',
    section: 'Agent',
    inPalette: true,
    run: () => {
      const id = useAgentStore.getState().activeSessionId ?? useSessionStore.getState().selectedId;
      if (id) useAgentStore.getState().stop(id);
    },
  },
  {
    id: 'workspace.reindex',
    title: 'Reindex workspace',
    section: 'Workspace',
    inPalette: true,
    run: () => void reindexActiveWorkspace(),
  },
  {
    id: 'sidebar.toggle',
    title: 'Toggle activity drawer',
    section: 'View',
    keys: ['Mod', 'B'],
    inPalette: true,
    run: () => useLayoutStore.getState().toggleDrawer(),
  },
  {
    id: 'drawer.toggleFiles',
    title: 'Show Files',
    section: 'View',
    inPalette: true,
    run: () => useLayoutStore.getState().toggleTab('files'),
  },
  {
    id: 'drawer.toggleChanges',
    title: 'Show Changes',
    section: 'View',
    inPalette: true,
    run: () => useLayoutStore.getState().toggleTab('changes'),
  },
  {
    id: 'drawer.toggleTasks',
    title: 'Show Tasks',
    section: 'View',
    inPalette: true,
    run: () => useLayoutStore.getState().toggleTab('tasks'),
  },
  {
    id: 'drawer.toggleActivity',
    title: 'Show Activity',
    section: 'View',
    inPalette: true,
    run: () => useLayoutStore.getState().toggleTab('activity'),
  },
  {
    id: 'settings.open',
    title: 'Open settings',
    section: 'General',
    keys: ['Mod', ','],
    inPalette: true,
    run: () => useUIStore.getState().openModal('settings'),
  },
  {
    id: 'view.reload',
    title: 'Reload window',
    section: 'General',
    inPalette: true,
    run: () => window.location.reload(),
  },
  {
    id: 'palette.open',
    title: 'Open command palette',
    section: 'General',
    keys: ['Mod', 'K'],
    inPalette: false,
    run: () => useUIStore.getState().openPalette(),
  },
];

const BY_ID = new Map<CommandId, Command>(COMMANDS.map((c) => [c.id, c]));

export function runCommand(id: CommandId): void {
  BY_ID.get(id)?.run();
}

export function paletteCommands(): Command[] {
  return COMMANDS.filter((c) => c.inPalette !== false);
}
