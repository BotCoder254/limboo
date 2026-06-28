/**
 * Preload script: the ONLY bridge between the privileged main process and the
 * sandboxed renderer. Runs with `contextIsolation` ON and `nodeIntegration` OFF,
 * exposing a tightly-scoped, typed API on `window.limboo` via `contextBridge`.
 *
 * Channel names are imported from the shared module so they can never drift from
 * the main-process handlers.
 *
 * See: https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels, IpcEvents } from '@shared/ipc-channels';
import type {
  AgentDiagnostic,
  AgentEvent,
  AgentInstall,
  AgentSessionSnapshot,
  AgentState,
  AppInfo,
  AppSettings,
  CommandId,
  DeepPartial,
  PermissionDecision,
  PermissionRequest,
  Workspace,
  WorkspaceConfig,
  WorkspaceStats,
} from '@shared/types';

/** Subscribe to a one-way main -> renderer event. Returns an unsubscribe fn. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const windowApi = {
  minimize: (): Promise<void> => ipcRenderer.invoke(IpcChannels.windowMinimize),
  maximize: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.windowMaximize),
  close: (): Promise<void> => ipcRenderer.invoke(IpcChannels.windowClose),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
  onMaximizedChange: (cb: (isMaximized: boolean) => void): (() => void) =>
    subscribe<boolean>(IpcEvents.windowMaximizedChanged, cb),
};

const settingsApi = {
  getAll: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.settingsGetAll),
  set: (patch: DeepPartial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IpcChannels.settingsSet, patch),
  reset: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.settingsReset),
  onChange: (cb: (settings: AppSettings) => void): (() => void) =>
    subscribe<AppSettings>(IpcEvents.settingsChanged, cb),
};

const systemApi = {
  notify: (options: { title: string; body?: string; silent?: boolean }): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.systemNotify, options),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.systemOpenExternal, url),
  clipboardWrite: (text: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.systemClipboardWrite, text),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke(IpcChannels.systemClipboardRead),
  /**
   * Resolve the absolute filesystem path of a dropped/selected `File`. Electron
   * 32+ removed `File.path`; `webUtils.getPathForFile` is the supported way and
   * the only fs detail this exposes. The path is then handed to the validated
   * `workspace:open` IPC — the renderer never touches the filesystem itself.
   */
  getDroppedPath: (file: File): string => webUtils.getPathForFile(file),
};

const appApi = {
  getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appGetInfo),
};

const eventsApi = {
  /** Native menu / tray / shortcut asking the renderer to run a command. */
  onCommand: (cb: (id: CommandId) => void): (() => void) =>
    subscribe<CommandId>(IpcEvents.commandInvoke, cb),
};

const workspaceApi = {
  list: (): Promise<Workspace[]> => ipcRenderer.invoke(IpcChannels.workspaceList),
  getActive: (): Promise<Workspace | null> => ipcRenderer.invoke(IpcChannels.workspaceGet),
  pickDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.workspacePickDirectory),
  create: (path: string): Promise<Workspace> =>
    ipcRenderer.invoke(IpcChannels.workspaceCreate, path),
  open: (path: string): Promise<Workspace> => ipcRenderer.invoke(IpcChannels.workspaceOpen, path),
  switch: (id: string): Promise<Workspace> => ipcRenderer.invoke(IpcChannels.workspaceSwitch, id),
  remove: (id: string, deleteFiles = false): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.workspaceRemove, id, deleteFiles),
  toggleFavorite: (id: string): Promise<Workspace> =>
    ipcRenderer.invoke(IpcChannels.workspaceToggleFavorite, id),
  updateConfig: (id: string, patch: DeepPartial<WorkspaceConfig>): Promise<Workspace> =>
    ipcRenderer.invoke(IpcChannels.workspaceUpdateConfig, id, patch),
  getStats: (id: string): Promise<WorkspaceStats | null> =>
    ipcRenderer.invoke(IpcChannels.workspaceGetStats, id),
  rescan: (id: string): Promise<Workspace> => ipcRenderer.invoke(IpcChannels.workspaceRescan, id),
  onChanged: (cb: (workspace: Workspace | null) => void): (() => void) =>
    subscribe<Workspace | null>(IpcEvents.workspaceChanged, cb),
  onUpdated: (cb: (workspaces: Workspace[]) => void): (() => void) =>
    subscribe<Workspace[]>(IpcEvents.workspacesUpdated, cb),
};

const agentApi = {
  getInstall: (): Promise<AgentInstall> => ipcRenderer.invoke(IpcChannels.agentGetInstall),
  getState: (): Promise<AgentState> => ipcRenderer.invoke(IpcChannels.agentGetState),
  getSnapshot: (sessionId: string): Promise<AgentSessionSnapshot> =>
    ipcRenderer.invoke(IpcChannels.agentGetSnapshot, sessionId),
  send: (sessionId: string, prompt: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentSend, sessionId, prompt),
  stop: (sessionId: string): Promise<void> => ipcRenderer.invoke(IpcChannels.agentStop, sessionId),
  clearSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentClearSession, sessionId),
  getDiagnostics: (sessionId?: string | null): Promise<AgentDiagnostic[]> =>
    ipcRenderer.invoke(IpcChannels.agentGetDiagnostics, sessionId ?? null),
  clearRateLimit: (): Promise<void> => ipcRenderer.invoke(IpcChannels.agentClearRateLimit),
  retryAuth: (): Promise<AgentInstall> => ipcRenderer.invoke(IpcChannels.agentRetryAuth),
  respondPermission: (decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentPermissionRespond, decision),
  onStateChanged: (cb: (state: AgentState) => void): (() => void) =>
    subscribe<AgentState>(IpcEvents.agentStateChanged, cb),
  onEvent: (cb: (event: AgentEvent) => void): (() => void) =>
    subscribe<AgentEvent>(IpcEvents.agentEvent, cb),
  onPermissionRequest: (cb: (request: PermissionRequest) => void): (() => void) =>
    subscribe<PermissionRequest>(IpcEvents.agentPermissionRequest, cb),
};

const limbooApi = {
  window: windowApi,
  settings: settingsApi,
  system: systemApi,
  app: appApi,
  events: eventsApi,
  workspace: workspaceApi,
  agent: agentApi,
};

contextBridge.exposeInMainWorld('limboo', limbooApi);

export type LimbooApi = typeof limbooApi;
