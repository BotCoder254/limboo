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
import { SessionManager } from './managers/SessionManager';
import { AgentManager } from './managers/AgentManager';
import { FileSystemManager } from './managers/FileSystemManager';
import { TerminalManager } from './managers/TerminalManager';
import { GitManager } from './managers/GitManager';
import { WorktreeManager } from './managers/worktree/WorktreeManager';
import { ServiceManager } from './managers/services/ServiceManager';
import { ProxyServer } from './managers/services/ProxyServer';
import { MemoryManager } from './managers/memory/MemoryManager';
import { SearchManager } from './managers/search/SearchManager';
import { AutoUpdateManager } from './managers/AutoUpdateManager';
import { VoiceManager } from './managers/voice/VoiceManager';
import { VoiceModelManager } from './managers/voice/VoiceModelManager';
import { AttachmentManager } from './managers/attachments/AttachmentManager';
import { getDb, closeDb } from './db/database';
import { registerAllIpc } from './ipc';

// Injected by Electron Forge's Vite plugin as a compile-time global (NOT an env
// var): the renderer dev-server URL in dev, `undefined` in a packaged build.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// One stable Windows identity for the taskbar, notifications, and the installer
// (must match electron-builder.yml `appId`). Harmless on other platforms.
app.setAppUserModelId('dev.limboo.app');

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
  let sessions: SessionManager;
  let agent: AgentManager;
  let fileSystem: FileSystemManager;
  let terminal: TerminalManager;
  let git: GitManager;
  let worktrees: WorktreeManager;
  let services: ServiceManager;
  let proxy: ProxyServer;
  let memory: MemoryManager;
  let attachments: AttachmentManager;
  let search: SearchManager;
  let updates: AutoUpdateManager;
  let voiceModels: VoiceModelManager;
  let voice: VoiceManager;
  let memorySweepTimer: ReturnType<typeof setInterval> | undefined;
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
    sessions = new SessionManager();
    agent = new AgentManager(workspace, settings, notifications);
    fileSystem = new FileSystemManager(workspace);
    terminal = new TerminalManager(workspace, settings);
    git = new GitManager(workspace, settings);
    // Git worktrees — first-class session isolation. The WorktreeManager is the
    // single resolver of a session's effective execution root; agent / terminal /
    // git / file-watcher / search all consult it instead of deriving paths.
    worktrees = new WorktreeManager(workspace, sessions, settings);
    worktrees.setTerminalManager(terminal);
    // Scripts & Services — supervised per-session processes from limboo.json.
    // Stopped before any worktree removal (open handles = EBUSY on Windows).
    services = new ServiceManager(sessions, settings);
    services.setTerminalManager(terminal);
    services.setConfigSource(worktrees);
    worktrees.setServiceManager(services);
    // Loopback-only *.localhost reverse proxy (off by default; Settings › Git).
    proxy = new ProxyServer(services, settings);
    proxy.sync();
    settings.onChange(() => proxy.sync());
    // The Local Memory System — a platform service owned by the app, not the
    // agent. Seeds default memories on first run and injects relevant knowledge
    // into prompts before they reach the harness.
    memory = new MemoryManager(settings);
    memory.seedDefaults(null); // global / user-scope starters
    // The Attachment Manager — session-owned files staged for the agent's tool
    // loop. Sweeps orphaned staging dirs shortly after boot (off the hot path).
    attachments = new AttachmentManager(sessions, settings);
    void attachments.sweepOrphans().catch((err) => logger.warn('attachment sweep failed', err));
    // The Search Engine — a platform service owned by the app. Maintains the local
    // file/symbol index and federates every other subsystem behind one query
    // interface; also the primary context provider for the coding agent.
    search = new SearchManager(settings, workspace);
    // In-app updater (electron-updater + GitHub releases). No-op in dev / non-AppImage.
    updates = new AutoUpdateManager(settings, notifications);
    // The agent mirrors its shell commands into the integrated terminal.
    agent.setTerminalManager(terminal);
    // The agent auto-titles untitled sessions from their first prompt.
    agent.setSessionManager(sessions);
    // The agent drives checkpoints + live git refresh through the Git Manager.
    agent.setGitManager(git);
    // The agent retrieves + injects relevant memories; the git engine proposes
    // new memories from commits. Both treat memory as an optional collaborator.
    agent.setMemoryManager(memory);
    git.setMemoryManager(memory);
    // The agent consumes attachments: manifest + staging-dir read access per
    // prompt, vision blocks for images, and read-status tracking on tool use.
    agent.setAttachmentManager(attachments);
    // The Search Engine federates memory / git / sessions at query time, powers the
    // Global Search UI, and feeds ranked context into the agent prompt.
    search.setMemoryManager(memory);
    search.setGitManager(git);
    search.setSessionManager(sessions);
    agent.setSearchManager(search);
    // The File System Layer pushes live git status (branch + diff) into sessions
    // and notifies the Git workspace whenever the working tree changes.
    fileSystem.setSessionManager(sessions);
    fileSystem.setGitManager(git);
    // The File System Layer drives incremental search reindexing on tree changes.
    fileSystem.setSearchManager(search);
    // Worktree-backed sessions: every subsystem resolves the session's isolated
    // checkout through the WorktreeManager (agent cwd, terminal cwd, git root,
    // search scope). The resolvers are cheap, synchronous DB lookups.
    agent.setSessionRootResolver((sessionId) => worktrees.resolveSessionRoot(sessionId));
    terminal.setSessionRootResolver((sessionId) => worktrees.resolveSessionRoot(sessionId));
    git.setActiveRootResolver((workspaceId) => worktrees.resolveActiveRoot(workspaceId));
    search.setActiveRootResolver((workspaceId) => worktrees.resolveActiveRoot(workspaceId));
    // The Voice subsystem — local speech (sherpa-onnx) as another input/output
    // modality of the SAME agent session. The model store owns downloads; the
    // manager orchestrates capture/TTS and taps the agent event stream.
    voiceModels = new VoiceModelManager();
    voice = new VoiceManager(settings, agent, voiceModels);
    // Spoken desktop notifications (gated by voice.playbackEvents.notifications).
    notifications.setSpeaker((text) => voice.speakNotification(text));

    hardenSession();
    registerAllIpc({
      settings,
      notifications,
      workspace,
      session: sessions,
      agent,
      fs: fileSystem,
      terminal,
      git,
      worktree: worktrees,
      services,
      memory,
      attachments,
      search,
      updates,
      voice,
      voiceModels,
    });
    // Begin capability supervision (probe + heartbeat) once IPC is wired.
    agent.start();
    // Wire the voice agent-event tap + honor the auto-download preference.
    voice.start();
    // Begin the auto-update check + hourly poll (packaged builds only).
    updates.start();

    // File System Layer: watch + index the *effective root* — the workspace
    // path, or the active session's worktree checkout when it owns one — and
    // follow every active-workspace AND active-session change. The retarget is
    // guarded by the last effective root so unrelated session broadcasts (and
    // switches between plain sessions) never churn the watcher or the index.
    let lastEffectiveRoot: string | null = null;
    const retargetEffectiveRoot = (): void => {
      const ws = workspace.getActive();
      if (!ws) {
        lastEffectiveRoot = null;
        void fileSystem.stopWatching();
        return;
      }
      const active = sessions.getActive();
      const root = worktrees.resolveActiveRoot(ws.id) ?? ws.path;
      const owner =
        active && active.workspaceId === ws.id && active.worktreePath && root !== ws.path
          ? active.id
          : null;
      fileSystem.setActiveTarget(ws, root, owner);
      if (root !== lastEffectiveRoot) {
        lastEffectiveRoot = root;
        git.invalidate(ws.id);
        void search.indexWorkspace(ws.id).catch((err) => logger.warn('search index failed', err));
        // Recovery/activation: start the session's autoStart services (only
        // when the workspace already acknowledged the repo's limboo.json).
        if (owner) services.autoStartForSession(owner);
      }
    };
    workspace.onActiveChanged((ws) => {
      retargetEffectiveRoot();
      if (ws) memory.seedDefaults(ws.id);
    });
    // Session switches (and worktree create/remove/missing on the active
    // session) retarget the same way — the SessionManager only emits when the
    // active session's execution root could actually differ.
    sessions.onActiveChanged(() => retargetEffectiveRoot());
    // Before a worktree directory is removed, fully release the watcher handles
    // inside it (Windows EBUSY) — the post-removal broadcast retargets afresh.
    worktrees.setReleaseRootHook(async () => {
      lastEffectiveRoot = null;
      await fileSystem.stopWatching();
    });

    const initialWs = workspace.getActive();
    // Boot-time worktree recovery (repair/prune + flag missing directories)
    // runs before the first retarget so a vanished worktree never gets watched.
    void worktrees
      .recover()
      .catch((err) => logger.warn('worktree recovery failed', err))
      .finally(() => retargetEffectiveRoot());
    if (initialWs) memory.seedDefaults(initialWs.id);

    // Low-frequency memory maintenance (decay/flag stale entries). Off the hot
    // path; runs hourly and once shortly after boot.
    memory.sweep();
    memorySweepTimer = setInterval(() => memory.sweep(), 60 * 60 * 1000);

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
    void fileSystem?.dispose();
    proxy?.stop();
    services?.dispose();
    terminal?.dispose();
    updates?.dispose();
    voice?.dispose();
    voiceModels?.dispose();
    if (memorySweepTimer) clearInterval(memorySweepTimer);
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
  // Google Fonts is the ONE remote origin the renderer may load from — the
  // stylesheet from fonts.googleapis.com (style-src) and the woff2 files from
  // fonts.gstatic.com (font-src) power the user-selectable chat font. Nothing
  // else is opened: connect/script/img stay locked down.
  const policy = isDev
    ? "default-src 'self' 'unsafe-inline' data: blob:; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "worker-src 'self' blob:; " +
      "connect-src 'self' ws: http: https:; img-src 'self' data: blob:;"
    : "default-src 'self'; " +
      // blob: on script-src is what actually permits the voice capture
      // AudioWorklet: Chromium checks worklet module loads against
      // script-src-elem, which falls back to script-src. The worklet source is
      // inlined (see capture.ts) and loaded from a same-origin Blob URL; page/
      // script loading otherwise stays locked to 'self'. worker-src is kept as
      // defensive, spec-compliant coverage.
      "script-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "worker-src 'self' blob:; " +
      // media-src is defensive: voice playback uses Web Audio AudioBuffers (no
      // <audio> element), but a blob-backed fallback must never be CSP-broken.
      "img-src 'self' data:; media-src 'self' blob:; connect-src 'self';";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  // Deny every web-platform permission with ONE narrow exception: the Voice
  // subsystem needs the microphone, so `media` is granted only when ALL hold —
  //   1. the request comes from our own renderer origin (dev server / file://),
  //   2. it comes from the main window's webContents (never a webview/popup;
  //      those are already blocked in createWindow.ts, this is defense in depth),
  //   3. it asks for AUDIO only — any request including video is refused.
  // Camera, geolocation, USB, notifications-via-web, etc. all stay denied.
  // (OS notifications go through the NotificationManager, not this API.)
  const isOwnOrigin = (origin: string | undefined): boolean => {
    // Dev: the renderer is served from the Vite dev-server origin. Normalize
    // BOTH sides through `URL` before comparing — Electron 42 hands the check
    // handler the origin as `http://localhost:5173/` (with a trailing slash),
    // while `new URL(devUrl).origin` yields `http://localhost:5173` (no slash),
    // so a strict `===` silently denied the mic in dev. Parsing both to their
    // canonical `.origin` makes the trailing-slash (and any other serialization)
    // form match, and keeps this consistent with the request handler below.
    if (devUrl) {
      if (!origin) return false;
      if (origin.startsWith('file:')) return true;
      try {
        return new URL(origin).origin === new URL(devUrl).origin;
      } catch {
        return false;
      }
    }
    // Packaged: the renderer is the ONLY content that can ever load — every
    // navigation, redirect, window.open and <webview> is blocked in
    // createWindow.ts — and it loads over file://. Chromium serializes a
    // sandboxed file:// page's origin inconsistently across platforms/versions:
    // it can arrive as 'file://', 'file:///…', a full 'file:///C:/…' URL, the
    // opaque 'null', an empty string, or undefined. In dev these all matched a
    // real origin; in a packaged build none of them matched, so the permission
    // CHECK handler silently denied the mic (this was the "works in dev, not in
    // the built app" bug). Accept every file-protocol / opaque form here; the
    // request handler still gates on audio-only + the main-window webContents
    // identity, which is what keeps this safe.
    if (origin === undefined || origin === '' || origin === 'null') return true;
    return origin.startsWith('file:');
  };

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media') {
      const requestOrigin = (() => {
        try {
          const raw = details.requestingUrl ?? wc.getURL();
          return raw.startsWith('file:') ? 'file://' : new URL(raw).origin;
        } catch {
          return undefined;
        }
      })();
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      const audioOnly = mediaTypes.length > 0 && mediaTypes.every((t) => t === 'audio');
      if (audioOnly && isOwnOrigin(requestOrigin) && wc === getMainWindow()?.webContents) {
        callback(true);
        return;
      }
      logger.warn('Denied media permission request', { requestOrigin, mediaTypes });
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (permission !== 'media') return false;
    const mediaType = (details as { mediaType?: string }).mediaType;
    if (mediaType === 'video') return false;
    const ok = isOwnOrigin(requestingOrigin);
    // This handler is consulted synchronously before getUserMedia's request
    // handler; returning false rejects the mic outright. It used to be silent —
    // log denials so a future permission mismatch is diagnosable from the main log.
    if (!ok) logger.warn('Denied media permission check', { requestingOrigin, mediaType });
    return ok;
  });
}
