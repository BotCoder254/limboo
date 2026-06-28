/**
 * AppMenuManager — builds the native application menu and per-window context
 * menu. Custom items dispatch into the renderer's command system via
 * {@link sendCommand}; the rest use built-in Electron roles.
 */
import { Menu, app } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { sendCommand } from '../sendCommand';

const isMac = process.platform === 'darwin';

export class AppMenuManager {
  install(): void {
    Menu.setApplicationMenu(this.buildMenu());
  }

  /** Attach a minimal right-click context menu to a window's web contents. */
  attachContextMenu(win: BrowserWindow): void {
    win.webContents.on('context-menu', () => {
      const menu = Menu.buildFromTemplate([
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ]);
      menu.popup({ window: win });
    });
  }

  private buildMenu(): Menu {
    const template: MenuItemConstructorOptions[] = [];

    if (isMac) {
      template.push({
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendCommand('settings.open') },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      });
    }

    template.push({
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('session.new') },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const }]
          : [
              { label: 'Settings', accelerator: 'Ctrl+,', click: () => sendCommand('settings.open') },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ]),
      ],
    });

    template.push({
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    });

    template.push({
      label: 'View',
      submenu: [
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendCommand('palette.open'),
        },
        { type: 'separator' },
        { label: 'Files', click: () => sendCommand('drawer.toggleFiles') },
        { label: 'Changes', click: () => sendCommand('drawer.toggleChanges') },
        { label: 'Tasks', click: () => sendCommand('drawer.toggleTasks') },
        { label: 'Activity', click: () => sendCommand('drawer.toggleActivity') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('sidebar.toggle') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    });

    template.push({
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ],
    });

    return Menu.buildFromTemplate(template);
  }
}
