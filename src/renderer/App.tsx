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
import { useAgentStore } from '@/renderer/stores/useAgentStore';

export function App() {
  useKeyboardShortcuts();
  useCommandBridge();
  usePreventFileDrop();

  // Load registered workspaces + connect to the coding agent once the shell is up.
  useEffect(() => {
    void useWorkspaceStore.getState().hydrate();
    void useAgentStore.getState().hydrate();
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
