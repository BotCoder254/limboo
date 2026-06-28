/**
 * IPC handlers backing the custom (frameless) title bar window controls.
 * The renderer reaches these through `window.limboo.window.*`.
 */
import { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import { handle } from './registry';

function windowFromEvent(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowHandlers(): void {
  handle(IpcChannels.windowMinimize, (event) => {
    windowFromEvent(event)?.minimize();
  });

  handle(IpcChannels.windowMaximize, (event) => {
    const win = windowFromEvent(event);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  handle(IpcChannels.windowClose, (event) => {
    windowFromEvent(event)?.close();
  });

  handle(IpcChannels.windowIsMaximized, (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false;
  });
}
