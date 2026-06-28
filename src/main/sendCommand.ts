/**
 * Bridges native (main-process) entry points — application menu items, tray
 * items, global shortcuts — to the renderer's command system. The renderer
 * listens on {@link IpcEvents.commandInvoke} and runs the matching command.
 */
import { IpcEvents } from '@shared/ipc-channels';
import type { CommandId } from '@shared/types';
import { getMainWindow } from './window/createWindow';

export function sendCommand(id: CommandId): void {
  const win = getMainWindow();
  if (!win) return;
  if (!win.isVisible()) win.show();
  win.focus();
  win.webContents.send(IpcEvents.commandInvoke, id);
}
