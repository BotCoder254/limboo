/**
 * Canonical IPC channel names shared between the main process (handlers) and the
 * preload bridge (invokers). Keeping them in one typed object prevents drift
 * between `ipcMain.handle(...)` and `ipcRenderer.invoke(...)`.
 *
 * Convention: `domain:action`. Two-way request/response uses `invoke`/`handle`;
 * one-way main -> renderer pushes use the channels under `Events`.
 */
export const IpcChannels = {
  // Frameless window controls.
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',

  // Persistent user settings.
  settingsGetAll: 'settings:getAll',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',

  // Native OS integrations.
  systemNotify: 'system:notify',
  systemOpenExternal: 'system:openExternal',
  systemClipboardWrite: 'system:clipboard:write',
  systemClipboardRead: 'system:clipboard:read',

  // App metadata.
  appGetInfo: 'app:getInfo',

  // Workspace management (Phase 2).
  workspaceList: 'workspace:list',
  workspaceGet: 'workspace:get',
  workspacePickDirectory: 'workspace:pickDirectory',
  workspaceCreate: 'workspace:create',
  workspaceOpen: 'workspace:open',
  workspaceSwitch: 'workspace:switch',
  workspaceRemove: 'workspace:remove',
  workspaceToggleFavorite: 'workspace:toggleFavorite',
  workspaceUpdateConfig: 'workspace:updateConfig',
  workspaceGetStats: 'workspace:getStats',
  workspaceRescan: 'workspace:rescan',

  // Coding agent (Claude Code orchestration).
  agentGetInstall: 'agent:getInstall',
  agentGetState: 'agent:getState',
  agentSend: 'agent:send',
  agentStop: 'agent:stop',
  agentGetSnapshot: 'agent:getSnapshot',
  agentPermissionRespond: 'agent:permissionRespond',
  agentClearSession: 'agent:clearSession',
  agentGetDiagnostics: 'agent:getDiagnostics',
  agentClearRateLimit: 'agent:clearRateLimit',
  agentRetryAuth: 'agent:retryAuth',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/**
 * One-way channels the main process pushes to the renderer. The renderer
 * subscribes through `window.limboo.events.on(channel, cb)`.
 */
export const IpcEvents = {
  windowMaximizedChanged: 'window:maximized-changed',
  settingsChanged: 'settings:changed',
  /** A native menu / tray item asks the renderer to run a command by id. */
  commandInvoke: 'command:invoke',
  /** The active workspace changed (switched, opened, or cleared). */
  workspaceChanged: 'workspace:changed',
  /** The set of registered workspaces changed (created / removed / updated). */
  workspacesUpdated: 'workspaces:updated',
  /** The agent runtime state changed (status / install / active session). */
  agentStateChanged: 'agent:state-changed',
  /** A structured agent event (message delta, tool call, file change, …). */
  agentEvent: 'agent:event',
  /** The agent needs the user to approve or deny a tool call. */
  agentPermissionRequest: 'agent:permission-request',
} as const;

export type IpcEvent = (typeof IpcEvents)[keyof typeof IpcEvents];
