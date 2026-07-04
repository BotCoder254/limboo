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
  workspaceCreateNew: 'workspace:createNew',
  workspaceOpen: 'workspace:open',
  workspaceSwitch: 'workspace:switch',
  workspaceRemove: 'workspace:remove',
  workspaceToggleFavorite: 'workspace:toggleFavorite',
  workspaceUpdateConfig: 'workspace:updateConfig',
  workspaceGetStats: 'workspace:getStats',
  workspaceRescan: 'workspace:rescan',

  // Session system (Phase 3) — persisted, per-workspace development sessions.
  sessionList: 'session:list',
  sessionCreate: 'session:create',
  sessionUpdate: 'session:update',
  sessionDuplicate: 'session:duplicate',
  sessionDelete: 'session:delete',
  sessionRestore: 'session:restore',
  sessionPurge: 'session:purge',
  sessionSetActive: 'session:setActive',
  sessionGetActive: 'session:getActive',
  sessionCreateInWorktree: 'session:createInWorktree',
  sessionGetDependencies: 'session:getDependencies',
  sessionTimeline: 'session:timeline',

  // Git worktrees — session-owned isolated checkouts (own directory + branch).
  worktreeList: 'worktree:list',
  worktreePrune: 'worktree:prune',
  worktreeRecreate: 'worktree:recreate',
  worktreeDetach: 'worktree:detach',
  worktreeGetRepoConfig: 'worktree:getRepoConfig',
  worktreeAckConfig: 'worktree:ackConfig',
  worktreeRunSetup: 'worktree:runSetup',

  // Scripts & Services — supervised per-session processes from limboo.json.
  serviceList: 'service:list',
  serviceStart: 'service:start',
  serviceStop: 'service:stop',
  serviceRestart: 'service:restart',
  scriptRun: 'script:run',

  // Coding agent (Claude Code orchestration).
  agentGetInstall: 'agent:getInstall',
  agentGetState: 'agent:getState',
  agentSend: 'agent:send',
  agentStop: 'agent:stop',
  agentGetSnapshot: 'agent:getSnapshot',
  agentPermissionRespond: 'agent:permissionRespond',
  agentClarificationRespond: 'agent:clarificationRespond',
  agentClearSession: 'agent:clearSession',
  agentGetDiagnostics: 'agent:getDiagnostics',
  agentClearRateLimit: 'agent:clearRateLimit',
  agentRetryAuth: 'agent:retryAuth',

  // Plan Mode — review-first workflow over the coding agent.
  agentGetPlan: 'agent:getPlan',
  agentApprovePlan: 'agent:approvePlan',
  agentRejectPlan: 'agent:rejectPlan',
  agentRegeneratePlan: 'agent:regeneratePlan',
  agentSetPlanPinned: 'agent:setPlanPinned',
  agentListPlanRevisions: 'agent:listPlanRevisions',
  agentRestorePlanRevision: 'agent:restorePlanRevision',

  // File System Layer (Phase 4) — read + watch + index foundation.
  fsIndex: 'fs:index',
  fsGetTree: 'fs:getTree',
  fsReadFile: 'fs:readFile',
  fsGetHistory: 'fs:getHistory',
  fsReveal: 'fs:reveal',

  // Integrated Terminal — workspace-scoped PTY sessions (node-pty in main).
  terminalCreate: 'terminal:create',
  terminalList: 'terminal:list',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalRename: 'terminal:rename',
  terminalClear: 'terminal:clear',

  // Deep Git integration — read + safe-write git ops, all workspace-scoped.
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitStageAll: 'git:stageAll',
  gitUnstageAll: 'git:unstageAll',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitCommitMessageGenerate: 'git:commitMessage:generate',
  gitCommitMessageCancel: 'git:commitMessage:cancel',
  gitLog: 'git:log',
  gitCommitDetail: 'git:commitDetail',
  gitBranches: 'git:branches',
  gitCheckout: 'git:checkout',
  gitCreateBranch: 'git:createBranch',
  gitTags: 'git:tags',
  gitCreateTag: 'git:createTag',
  gitBlame: 'git:blame',
  gitFetch: 'git:fetch',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitInit: 'git:init',
  gitCheckpointCreate: 'git:checkpointCreate',
  gitCheckpointList: 'git:checkpointList',
  gitCheckpointDiff: 'git:checkpointDiff',
  gitCheckpointRestore: 'git:checkpointRestore',
  gitCheckpointDelete: 'git:checkpointDelete',

  // Auto-update — electron-updater driven, GitHub releases feed (packaged only).
  updateGetState: 'update:getState',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',

  // Local Memory System — provider-independent project knowledge, all local.
  memoryList: 'memory:list',
  memoryGet: 'memory:get',
  memorySearch: 'memory:search',
  memoryCreate: 'memory:create',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryArchive: 'memory:archive',
  memoryPin: 'memory:pin',
  memoryListProposals: 'memory:listProposals',
  memoryAcceptProposal: 'memory:acceptProposal',
  memoryRejectProposal: 'memory:rejectProposal',

  // Search Engine — unified, cross-subsystem retrieval, all local.
  searchGlobal: 'search:global',
  searchFiles: 'search:files',
  searchSymbols: 'search:symbols',
  searchReindex: 'search:reindex',
  searchGetStatus: 'search:getStatus',
  searchHistoryList: 'search:historyList',
  searchHistoryClear: 'search:historyClear',
  searchSavedList: 'search:savedList',
  searchSavedCreate: 'search:savedCreate',
  searchSavedDelete: 'search:savedDelete',

  // Voice subsystem — local STT/TTS as another modality for the agent session.
  voiceGetState: 'voice:getState',
  voiceStart: 'voice:start',
  voiceStop: 'voice:stop',
  voiceCancel: 'voice:cancel',
  voiceStopSpeaking: 'voice:stopSpeaking',
  voiceSpeak: 'voice:speak',
  voiceModelsList: 'voice:models:list',
  voiceModelDownload: 'voice:models:download',
  voiceModelPause: 'voice:models:pause',
  voiceModelResume: 'voice:models:resume',
  voiceModelCancel: 'voice:models:cancel',
  voiceModelRemove: 'voice:models:remove',
  voiceModelVerify: 'voice:models:verify',
  voiceModelsReveal: 'voice:models:reveal',
} as const;

/**
 * One-way renderer -> main channels (`ipcRenderer.send`) for high-frequency
 * fire-and-forget payloads that don't want invoke round-trip overhead. Handled
 * through the `on()` wrapper in main/ipc/registry.ts (same sender validation).
 */
export const IpcSends = {
  /** A chunk of 16 kHz mono Int16 PCM from the renderer's mic worklet. */
  voiceAudioChunk: 'voice:audio-chunk',
} as const;

export type IpcSend = (typeof IpcSends)[keyof typeof IpcSends];

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
  /** The set of sessions changed (created / updated / deleted / restored). */
  sessionsUpdated: 'sessions:updated',
  /** The active session changed (switched, created, or deleted). */
  sessionActiveChanged: 'session:active-changed',
  /** The agent runtime state changed (status / install / active session). */
  agentStateChanged: 'agent:state-changed',
  /** A structured agent event (message delta, tool call, file change, …). */
  agentEvent: 'agent:event',
  /** The agent needs the user to approve or deny a tool call. */
  agentPermissionRequest: 'agent:permission-request',
  /** The agent (AskUserQuestion) needs the user to answer clarifying questions. */
  agentClarificationRequest: 'agent:clarification-request',
  /** Progress of an in-flight workspace index pass. */
  fsIndexProgress: 'fs:index-progress',
  /** The active workspace's directory tree changed (watcher or reindex). */
  fsTreeChanged: 'fs:tree-changed',
  /** A chunk of PTY output for a terminal (stdout/stderr, raw VT bytes). */
  terminalData: 'terminal:data',
  /** A terminal's PTY exited (with code / signal). */
  terminalExit: 'terminal:exit',
  /** The set of terminals for a workspace changed (created / renamed / killed). */
  terminalsUpdated: 'terminal:updated',
  /** An agent-run shell command mirrored into the integrated terminal. */
  terminalCommand: 'terminal:command',
  /** The active workspace's git state changed (status/branch/commit/stage). */
  gitChanged: 'git:changed',
  /** Streaming AI commit-message proposal (delta / done / error / canceled). */
  gitCommitMessageStream: 'git:commit-message-stream',
  /** A session's git checkpoints changed (created / restored / pruned). */
  gitCheckpointsChanged: 'git:checkpoints-changed',
  /** The set of session worktrees changed (created / removed / pruned / missing). */
  worktreesUpdated: 'worktrees:updated',
  /** A session's supervised services changed (started / exited / restarted). */
  servicesUpdated: 'services:updated',
  /** The memory store changed (created / updated / proposed / accepted / pruned). */
  memoryChanged: 'memory:changed',
  /** The search index / history / saved searches changed (reindex, save, clear). */
  searchChanged: 'search:changed',
  /** Progress of an in-flight search index pass. */
  searchIndexProgress: 'search:index-progress',
  /** The auto-update lifecycle advanced (checking / available / progress / ready). */
  updateStatus: 'update:status',
  /** The voice runtime state changed (idle / listening / transcribing / speaking). */
  voiceState: 'voice:state',
  /** A finished utterance transcript (about to be sent to the agent). */
  voiceTranscript: 'voice:transcript',
  /** A chunk of synthesized Int16 PCM for Web Audio playback. */
  voiceTtsChunk: 'voice:tts-chunk',
  /** Stop all scheduled speech playback immediately (barge-in / stop). */
  voicePlaybackCancel: 'voice:playback-cancel',
  /** Progress of an in-flight voice model download / verify / extract. */
  voiceModelProgress: 'voice:model-progress',
  /** The set of installed voice models changed (installed / removed). */
  voiceModelsChanged: 'voice:models-changed',
} as const;

export type IpcEvent = (typeof IpcEvents)[keyof typeof IpcEvents];
