/**
 * Root application component. Composes the shell with the global overlays
 * (command palette, settings modal, toasts) and installs the keyboard-shortcut
 * and native-command bridges. Kept thin: all real UI lives in features/layout.
 */
import { useEffect } from 'react';
import { AppShell } from '@/renderer/app/AppShell';
import { CommandPalette } from '@/renderer/features/command-palette/CommandPalette';
import { SettingsModal } from '@/renderer/features/settings/SettingsModal';
import { ApprovalModal } from '@/renderer/features/agent/ApprovalModal';
import { Toaster } from '@/renderer/components/feedback/Toaster';
import { useKeyboardShortcuts } from '@/renderer/hooks/useKeyboardShortcuts';
import { useCommandBridge } from '@/renderer/hooks/useCommandBridge';
import { usePreventFileDrop } from '@/renderer/hooks/usePreventFileDrop';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';

export function App() {
  useKeyboardShortcuts();
  useCommandBridge();
  usePreventFileDrop();

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
  }, []);

  return (
    <>
      <AppShell />
      <CommandPalette />
      <SettingsModal />
      <ApprovalModal />
      <Toaster />
    </>
  );
}
