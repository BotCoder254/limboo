/**
 * Main process entry point.
 *
 * Owns the application lifecycle and constructs the long-lived managers that
 * make up the Desktop Foundation: settings, window-state, native menu, tray,
 * and notifications. All OS access lives here or in a manager; the renderer only
 * ever asks through IPC.
 */
import { app, BrowserWindow, nativeTheme, session } from 'electron';
import started from 'electron-squirrel-startup';

import { installGlobalErrorHandlers, logger } from './logger';
import { createMainWindow, getMainWindow } from './window/createWindow';
import { WindowStateManager } from './window/windowState';
import { SettingsManager } from './managers/SettingsManager';
import { NotificationManager } from './managers/NotificationManager';
import { AppMenuManager } from './managers/AppMenuManager';
import { TrayManager } from './managers/TrayManager';
import { WorkspaceManager } from './managers/WorkspaceManager';
import { AgentManager } from './managers/AgentManager';
import { getDb, closeDb } from './db/database';
import { registerAllIpc } from './ipc';

// Injected by Electron Forge's Vite plugin as a compile-time global (NOT an env
// var): the renderer dev-server URL in dev, `undefined` in a packaged build.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

installGlobalErrorHandlers();

// On many Linux GPU/driver combos (notably failing VAAPI init), Electron's GPU
// compositor paints an all-black window even though the renderer loaded fine —
// the app "opens but shows nothing". Disabling hardware acceleration forces
// software compositing, which renders reliably. Must run before `app` is ready.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// Pure-black, dark-mode ONLY. Force the native theme to dark so OS-level chrome
// (window background, native dialogs, menus) matches the renderer.
nativeTheme.themeSource = 'dark';

// Single-instance: focus the existing window instead of launching a second app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  // Long-lived managers. Created lazily inside `whenReady` where `app` paths are
  // guaranteed to resolve.
  let settings: SettingsManager;
  let notifications: NotificationManager;
  let workspace: WorkspaceManager;
  let agent: AgentManager;
  const windowState = new WindowStateManager();
  const appMenu = new AppMenuManager();
  const tray = new TrayManager();

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    settings = new SettingsManager();
    notifications = new NotificationManager(settings);
    // Open the local database before any manager that reads from it.
    getDb();
    workspace = new WorkspaceManager();
    agent = new AgentManager(workspace, settings, notifications);

    hardenSession();
    registerAllIpc({ settings, notifications, workspace, agent });

    appMenu.install();
    const win = createMainWindow(windowState);
    appMenu.attachContextMenu(win);
    tray.init();

    logger.info('Limboo main process ready');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const created = createMainWindow(windowState);
        appMenu.attachContextMenu(created);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    agent?.cleanup();
    tray.destroy();
    closeDb();
  });
}

/**
 * Lock the renderer down with a Content-Security-Policy and deny-by-default
 * permission handlers. In dev the CSP must allow the Vite dev server (inline
 * styles + websocket HMR); production is strict.
 */
function hardenSession(): void {
  // Detect dev via the injected global (the env-var form is never set, so the
  // old check silently fell through to the STRICT policy in dev — which blocks
  // Vite's inline React-Refresh preamble and leaves the window blank). Fall back
  // to `!app.isPackaged` for safety.
  const devUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  const isDev = !!devUrl || !app.isPackaged;
  const policy = isDev
    ? "default-src 'self' 'unsafe-inline' data: blob:; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' ws: http: https:; img-src 'self' data: blob:;"
    : "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self';";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  // Deny every web-platform permission request. This is a local-only app — it
  // needs no camera, microphone, geolocation, USB, notifications-via-web, etc.
  // (OS notifications go through the NotificationManager, not this API.)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}
