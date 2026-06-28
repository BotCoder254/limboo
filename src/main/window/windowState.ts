/**
 * WindowStateManager — persists and restores the main window's geometry so the
 * workspace reopens exactly where the user left it (size, position, maximized).
 *
 * Restored bounds are validated against the currently-connected displays so the
 * window can never be restored off-screen (e.g. after unplugging a monitor).
 */
import { BrowserWindow, screen } from 'electron';
import type { WindowStateData } from '@shared/types';
import { WINDOW_DEFAULT } from '@shared/constants';
import { readJson, writeJson } from '../storage';

const FILE = 'window-state.json';
const SAVE_DEBOUNCE_MS = 400;

export class WindowStateManager {
  private state: WindowStateData;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.state = readJson<WindowStateData>(FILE, {
      width: WINDOW_DEFAULT.width,
      height: WINDOW_DEFAULT.height,
      maximized: false,
    });
  }

  /** Bounds to pass to `new BrowserWindow(...)`, clamped to a visible display. */
  getRestoreOptions(): { x?: number; y?: number; width: number; height: number } {
    const { x, y, width, height } = this.state;
    if (x === undefined || y === undefined || !this.isVisibleOnSomeDisplay(x, y, width, height)) {
      return { width, height };
    }
    return { x, y, width, height };
  }

  get maximized(): boolean {
    return this.state.maximized;
  }

  /** Begin tracking a window: persist geometry on move/resize/close. */
  track(win: BrowserWindow): void {
    const onChange = () => this.capture(win);
    win.on('resize', onChange);
    win.on('move', onChange);
    win.on('maximize', onChange);
    win.on('unmaximize', onChange);
    win.on('close', () => {
      this.capture(win);
      this.flush();
    });
  }

  private capture(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    // Only overwrite the normal bounds when the window isn't maximized, so the
    // restore size remains the user's chosen size, not the full-screen one.
    if (!maximized && !win.isMinimized()) {
      const b = win.getBounds();
      this.state = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    } else {
      this.state = { ...this.state, maximized };
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    writeJson(FILE, this.state);
  }

  private isVisibleOnSomeDisplay(x: number, y: number, w: number, h: number): boolean {
    return screen.getAllDisplays().some((display) => {
      const a = display.workArea;
      // Require the window's top-left to fall within a display's work area.
      return x >= a.x && y >= a.y && x + w <= a.x + a.width && y + h <= a.y + a.height;
    });
  }
}
