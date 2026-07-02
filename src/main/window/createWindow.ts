/**
 * Creates and configures the main application window.
 *
 * The window is frameless (the renderer draws its own title bar), pure-black to
 * avoid any launch flash, sandboxed for security, and only shown once the
 * renderer has painted (`ready-to-show`). Geometry is restored from / tracked by
 * the {@link WindowStateManager}.
 */
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { IpcEvents } from '@shared/ipc-channels';
import { WINDOW_MIN } from '@shared/constants';
import { assetPath } from '../paths';
import { logger } from '../logger';
import type { WindowStateManager } from './windowState';

// Injected by Electron Forge's Vite plugin.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let webviewBlockInstalled = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/**
 * Block `<webview>` tags entirely, app-wide. Registered once. Limboo never
 * embeds web content, so a webview could only be an injection vector.
 */
function installWebviewBlock(): void {
  if (webviewBlockInstalled) return;
  webviewBlockInstalled = true;
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      logger.warn('Blocked <webview> attachment');
    });
  });
}

export function createMainWindow(windowState: WindowStateManager): BrowserWindow {
  installWebviewBlock();
  const restore = windowState.getRestoreOptions();

  const win = new BrowserWindow({
    ...restore,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    backgroundColor: '#000000',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    // Windows embeds/derives the runtime window + taskbar icon best from a .ico;
    // other platforms use the PNG (macOS uses the app bundle icon anyway).
    icon: assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security: keep the renderer isolated from Node entirely.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow = win;
  windowState.track(win);

  if (windowState.maximized) {
    win.maximize();
  }

  // Reveal only once painted to avoid a white flash on launch.
  win.once('ready-to-show', () => win.show());

  // Keep the renderer's maximize/restore icon in sync with the real state.
  const sendMaximized = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcEvents.windowMaximizedChanged, win.isMaximized());
    }
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // Security: never let the renderer open arbitrary windows or navigate away.
  // External links are handed to the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // Block any in-window navigation/redirect away from the app's own content
  // (the dev server in dev, our bundled file:// page in prod).
  const guardNavigation = (event: Electron.Event, url: string) => {
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    logger.warn('Blocked navigation to', url);
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  loadRenderer(win);

  return win;
}

/**
 * Load the renderer, tolerating a cold-start race with the Vite dev server.
 *
 * In dev, Electron Forge can launch this process a beat before the renderer dev
 * server is accepting connections. The first `loadURL` then fails with
 * `ERR_CONNECTION_REFUSED` and — with no handler — the window stays silently
 * black, which is indistinguishable from "the app renders nothing". We retry a
 * few times with a short backoff and, if it still won't load, paint a themed
 * diagnostic page so the failure is always visible and actionable.
 */
const DEV_LOAD_MAX_RETRIES = 20;
const DEV_LOAD_RETRY_MS = 400;

function loadRenderer(win: BrowserWindow): void {
  const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;

  if (!devUrl) {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
    return;
  }

  let attempts = 0;
  const tryLoad = () => {
    if (win.isDestroyed()) return;
    void win.loadURL(devUrl);
  };

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // -3 (ABORTED) fires for benign in-flight navigations; ignore it.
    if (win.isDestroyed() || errorCode === -3) return;
    if (!validatedURL.startsWith(devUrl)) return;

    attempts += 1;
    if (attempts <= DEV_LOAD_MAX_RETRIES) {
      logger.warn(
        `Renderer load failed (${errorCode} ${errorDescription}); retry ${attempts}/${DEV_LOAD_MAX_RETRIES}`,
      );
      setTimeout(tryLoad, DEV_LOAD_RETRY_MS);
      return;
    }

    logger.error(
      `Renderer dev server unreachable after ${DEV_LOAD_MAX_RETRIES} attempts: ${devUrl}`,
    );
    // The diagnostic page triggers its own `ready-to-show`, which reveals the
    // window; force-show as a belt-and-braces guard in case it already fired.
    if (!win.isVisible()) win.show();
    void win.loadURL(devServerDownPage(devUrl, errorDescription));
  });

  tryLoad();
}

/** Pure-black, on-theme diagnostic page shown when the dev server never answers. */
function devServerDownPage(devUrl: string, detail: string): string {
  const html = `<!doctype html><html class="dark"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  :root{color-scheme:dark}
  html,body{height:100%;margin:0}
  body{background:#000;color:#ededed;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center}
  .card{max-width:30rem;padding:2rem;text-align:center}
  h1{font-size:14px;font-weight:600;margin:0 0 .75rem;color:#ededed}
  p{font-size:13px;line-height:1.6;color:#9a9a9a;margin:.25rem 0}
  code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#6e9bff}
  .url{margin-top:1rem;font-size:11px;color:#6b6b6b}
</style></head><body><div class="card">
  <h1>Renderer dev server unreachable</h1>
  <p>Electron started but the Vite dev server isn't answering, so nothing could be rendered.</p>
  <p>Stop any stale dev servers and relaunch with <code>npm start</code>.</p>
  <p class="url">${devUrl} &mdash; ${detail}</p>
</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
