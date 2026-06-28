/**
 * TrayManager — adds a system tray icon so Limboo can keep running background
 * work while the window is hidden. Tray support varies by Linux desktop, so all
 * operations are guarded and failures are logged rather than thrown.
 */
import { Menu, Tray, app, nativeImage } from 'electron';
import { assetPath } from '../paths';
import { logger } from '../logger';
import { sendCommand } from '../sendCommand';
import { getMainWindow } from '../window/createWindow';

export class TrayManager {
  private tray: Tray | null = null;

  init(): void {
    try {
      const image = nativeImage.createFromPath(assetPath('tray.png'));
      if (image.isEmpty()) {
        logger.warn('Tray icon asset missing or empty; skipping tray.');
        return;
      }
      this.tray = new Tray(image);
      this.tray.setToolTip('Limboo');
      this.tray.setContextMenu(this.buildMenu());
      this.tray.on('click', () => this.showWindow());
    } catch (err) {
      logger.warn('Failed to initialize tray', err);
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private showWindow(): void {
    const win = getMainWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: 'Show Limboo', click: () => this.showWindow() },
      { label: 'New Session', click: () => sendCommand('session.new') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
  }
}
