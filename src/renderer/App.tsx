/**
 * Root application component. Composes the shell with the global overlays
 * (command palette, settings modal, toasts) and installs the keyboard-shortcut
 * and native-command bridges. Kept thin: all real UI lives in features/layout.
 */
import { useEffect } from 'react';
import { AppShell } from '@/renderer/app/AppShell';
import { WorkspaceSelection } from '@/renderer/features/workspace/WorkspaceSelection';
import { CommandPalette } from '@/renderer/features/command-palette/CommandPalette';
import { SettingsModal } from '@/renderer/features/settings/SettingsModal';
import { Toaster } from '@/renderer/components/feedback/Toaster';
import { useKeyboardShortcuts } from '@/renderer/hooks/useKeyboardShortcuts';
import { useCommandBridge } from '@/renderer/hooks/useCommandBridge';
import { usePreventFileDrop } from '@/renderer/hooks/usePreventFileDrop';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';
import { useTerminalStore } from '@/renderer/stores/useTerminalStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useMemoryStore } from '@/renderer/stores/useMemoryStore';

export function App() {
  useKeyboardShortcuts();
  useCommandBridge();
  usePreventFileDrop();

  // Gate the shell on an active workspace: until one is selected, the full-screen
  // Workspace Selection screen owns the window and every workspace-dependent panel
  // stays out of reach. `hydrated` avoids a flash of the selection screen before
  // the persisted active workspace has loaded.
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const hasWorkspace = useWorkspaceStore((s) => s.activeId !== null);

  // Load registered workspaces + sessions + connect to the coding agent once the
  // shell is up. Workspaces hydrate first so the session list can scope to the
  // active workspace; the session store also follows later workspace switches.
  useEffect(() => {
    void useWorkspaceStore
      .getState()
      .hydrate()
      .then(() => useSessionStore.getState().hydrate());
    void useAgentStore.getState().hydrate();
    // Subscribe to live index progress + directory-tree pushes from the File
    // System Layer (main auto-indexes the active workspace on open/switch).
    useFileSystemStore.getState().hydrate();
    // Subscribe to terminal lifecycle + agent-command-mirror pushes.
    useTerminalStore.getState().hydrate();
    // Subscribe to live git status + checkpoint pushes for the Git workspace.
    useGitStore.getState().hydrate();
    // Subscribe to memory changes (proposals drive the rail badge) + follow ws.
    useMemoryStore.getState().hydrate();
  }, []);

  return (
    <>
      {!hydrated ? null : hasWorkspace ? <AppShell /> : <WorkspaceSelection />}
      <CommandPalette />
      <SettingsModal />
      <Toaster />
    </>
  );
}
