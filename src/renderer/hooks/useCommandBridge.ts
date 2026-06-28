/**
 * Bridges native (main-process) command dispatches — from the application menu,
 * tray, or global shortcuts — into the renderer's command registry. The main
 * process sends `command:invoke` with a CommandId; we run the matching command.
 */
import { useEffect } from 'react';
import { runCommand } from '@/renderer/lib/commands';

export function useCommandBridge(): void {
  useEffect(() => {
    const events = window.limboo?.events;
    if (!events) return;
    return events.onCommand((id) => runCommand(id));
  }, []);
}
