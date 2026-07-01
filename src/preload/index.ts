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
  ClarificationDecision,
  ClarificationRequest,
  CommandId,
  DeepPartial,
  FileHistoryEntry,
  FileReadResult,
  FileTree,
  GitBlameLine,
  GitBranch,
  GitCheckoutResult,
  GitCheckpoint,
  GitCommit,
  GitCommitDetail,
  GitFileChange,
  GitFileDiff,
  GitPullResult,
  GitPushResult,
  GitStatus,
  GitTag,
  IndexProgress,
  Memory,
  MemoryCreateInput,
  MemoryHit,
  MemoryListFilter,
  MemoryTier,
  MemoryUpdateInput,
  SavedSearch,
  SearchFilter,
  SearchGroup,
  SearchHistoryEntry,
  SearchHit,
  SearchIndexProgress,
  SearchQueryOptions,
  PermissionDecision,
  PermissionRequest,
  PlanRevision,
  Session,
  SessionPermissionMode,
  SessionPlan,
  SessionUpdate,
  TerminalChunk,
  TerminalCommandRecord,
  TerminalCreateOptions,
  TerminalExit,
  TerminalSession,
  UpdateStatus,
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
  createNew: (input: { name: string; parentPath: string; initGit: boolean }): Promise<Workspace> =>
    ipcRenderer.invoke(IpcChannels.workspaceCreateNew, input),
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

const sessionApi = {
  list: (workspaceId: string, trash = false): Promise<Session[]> =>
    ipcRenderer.invoke(IpcChannels.sessionList, workspaceId, trash),
  getActive: (): Promise<Session | null> => ipcRenderer.invoke(IpcChannels.sessionGetActive),
  create: (workspaceId: string, title?: string): Promise<Session> =>
    ipcRenderer.invoke(IpcChannels.sessionCreate, workspaceId, title),
  update: (id: string, patch: SessionUpdate): Promise<Session> =>
    ipcRenderer.invoke(IpcChannels.sessionUpdate, id, patch),
  duplicate: (id: string): Promise<Session> =>
    ipcRenderer.invoke(IpcChannels.sessionDuplicate, id),
  delete: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.sessionDelete, id),
  restore: (id: string): Promise<Session> => ipcRenderer.invoke(IpcChannels.sessionRestore, id),
  purge: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.sessionPurge, id),
  setActive: (id: string): Promise<Session> =>
    ipcRenderer.invoke(IpcChannels.sessionSetActive, id),
  onUpdated: (cb: () => void): (() => void) => subscribe<void>(IpcEvents.sessionsUpdated, cb),
  onActiveChanged: (cb: (session: Session | null) => void): (() => void) =>
    subscribe<Session | null>(IpcEvents.sessionActiveChanged, cb),
};

const agentApi = {
  getInstall: (): Promise<AgentInstall> => ipcRenderer.invoke(IpcChannels.agentGetInstall),
  getState: (): Promise<AgentState> => ipcRenderer.invoke(IpcChannels.agentGetState),
  getSnapshot: (sessionId: string): Promise<AgentSessionSnapshot> =>
    ipcRenderer.invoke(IpcChannels.agentGetSnapshot, sessionId),
  send: (
    sessionId: string,
    prompt: string,
    mode?: SessionPermissionMode,
    clientMessageId?: string,
  ): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentSend, sessionId, prompt, mode, clientMessageId),
  stop: (sessionId: string): Promise<void> => ipcRenderer.invoke(IpcChannels.agentStop, sessionId),
  getPlan: (sessionId: string): Promise<SessionPlan | null> =>
    ipcRenderer.invoke(IpcChannels.agentGetPlan, sessionId),
  approvePlan: (sessionId: string, execMode?: SessionPermissionMode): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentApprovePlan, sessionId, execMode),
  rejectPlan: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentRejectPlan, sessionId),
  regeneratePlan: (sessionId: string, extra?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentRegeneratePlan, sessionId, extra),
  setPlanPinned: (sessionId: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentSetPlanPinned, sessionId, pinned),
  listPlanRevisions: (sessionId: string): Promise<PlanRevision[]> =>
    ipcRenderer.invoke(IpcChannels.agentListPlanRevisions, sessionId),
  restorePlanRevision: (sessionId: string, revisionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentRestorePlanRevision, sessionId, revisionId),
  clearSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentClearSession, sessionId),
  getDiagnostics: (sessionId?: string | null): Promise<AgentDiagnostic[]> =>
    ipcRenderer.invoke(IpcChannels.agentGetDiagnostics, sessionId ?? null),
  clearRateLimit: (): Promise<void> => ipcRenderer.invoke(IpcChannels.agentClearRateLimit),
  retryAuth: (): Promise<AgentInstall> => ipcRenderer.invoke(IpcChannels.agentRetryAuth),
  respondPermission: (decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentPermissionRespond, decision),
  respondClarification: (decision: ClarificationDecision): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.agentClarificationRespond, decision),
  onStateChanged: (cb: (state: AgentState) => void): (() => void) =>
    subscribe<AgentState>(IpcEvents.agentStateChanged, cb),
  onEvent: (cb: (event: AgentEvent) => void): (() => void) =>
    subscribe<AgentEvent>(IpcEvents.agentEvent, cb),
  onPermissionRequest: (cb: (request: PermissionRequest) => void): (() => void) =>
    subscribe<PermissionRequest>(IpcEvents.agentPermissionRequest, cb),
  onClarificationRequest: (cb: (request: ClarificationRequest) => void): (() => void) =>
    subscribe<ClarificationRequest>(IpcEvents.agentClarificationRequest, cb),
};

const fsApi = {
  /** (Re)build the workspace directory tree; progress streams via onIndexProgress. */
  index: (workspaceId: string): Promise<FileTree> =>
    ipcRenderer.invoke(IpcChannels.fsIndex, workspaceId),
  /** Last-built tree for a workspace (no disk access), or null. */
  getTree: (workspaceId: string): Promise<FileTree | null> =>
    ipcRenderer.invoke(IpcChannels.fsGetTree, workspaceId),
  /** Read a workspace-relative file through the centralized, guarded reader. */
  readFile: (workspaceId: string, relPath: string): Promise<FileReadResult> =>
    ipcRenderer.invoke(IpcChannels.fsReadFile, workspaceId, relPath),
  /** Most-recent-first File History for a workspace. */
  getHistory: (workspaceId: string): Promise<FileHistoryEntry[]> =>
    ipcRenderer.invoke(IpcChannels.fsGetHistory, workspaceId),
  /** Reveal the workspace root (no relPath) or a path in the OS file manager. */
  reveal: (workspaceId: string, relPath?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.fsReveal, workspaceId, relPath),
  onIndexProgress: (cb: (progress: IndexProgress) => void): (() => void) =>
    subscribe<IndexProgress>(IpcEvents.fsIndexProgress, cb),
  onTreeChanged: (cb: (tree: FileTree) => void): (() => void) =>
    subscribe<FileTree>(IpcEvents.fsTreeChanged, cb),
};

const terminalApi = {
  /** Spawn a new PTY for a workspace. Returns its metadata. */
  create: (workspaceId: string, opts?: TerminalCreateOptions): Promise<TerminalSession> =>
    ipcRenderer.invoke(IpcChannels.terminalCreate, workspaceId, opts),
  /** Terminals for a workspace plus each one's buffered scrollback for replay. */
  list: (
    workspaceId: string,
  ): Promise<{ terminals: TerminalSession[]; scrollback: Record<string, string> }> =>
    ipcRenderer.invoke(IpcChannels.terminalList, workspaceId),
  /** Feed keystrokes / paste into a terminal. */
  write: (terminalId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.terminalWrite, terminalId, data),
  /** Resize a terminal's PTY grid. */
  resize: (terminalId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.terminalResize, terminalId, cols, rows),
  /** Kill a terminal and drop it. */
  kill: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.terminalKill, terminalId),
  /** Rename a terminal's label. */
  rename: (terminalId: string, title: string): Promise<TerminalSession | null> =>
    ipcRenderer.invoke(IpcChannels.terminalRename, terminalId, title),
  /** Clear a terminal's buffered scrollback. */
  clear: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.terminalClear, terminalId),
  onData: (cb: (chunk: TerminalChunk) => void): (() => void) =>
    subscribe<TerminalChunk>(IpcEvents.terminalData, cb),
  onExit: (cb: (exit: TerminalExit) => void): (() => void) =>
    subscribe<TerminalExit>(IpcEvents.terminalExit, cb),
  onUpdated: (
    cb: (payload: { workspaceId: string; terminals: TerminalSession[] }) => void,
  ): (() => void) =>
    subscribe<{ workspaceId: string; terminals: TerminalSession[] }>(
      IpcEvents.terminalsUpdated,
      cb,
    ),
  onCommand: (cb: (record: TerminalCommandRecord) => void): (() => void) =>
    subscribe<TerminalCommandRecord>(IpcEvents.terminalCommand, cb),
};

const gitApi = {
  status: (workspaceId: string): Promise<GitStatus> =>
    ipcRenderer.invoke(IpcChannels.gitStatus, workspaceId),
  diff: (
    workspaceId: string,
    path: string,
    opts?: { staged?: boolean; baseRef?: string },
  ): Promise<GitFileDiff> => ipcRenderer.invoke(IpcChannels.gitDiff, workspaceId, path, opts),
  stage: (workspaceId: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitStage, workspaceId, path),
  unstage: (workspaceId: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitUnstage, workspaceId, path),
  stageAll: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitStageAll, workspaceId),
  unstageAll: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitUnstageAll, workspaceId),
  discard: (workspaceId: string, path: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitDiscard, workspaceId, path),
  commit: (workspaceId: string, message: string): Promise<GitCommit | null> =>
    ipcRenderer.invoke(IpcChannels.gitCommit, workspaceId, message),
  log: (workspaceId: string, opts?: { limit?: number; offset?: number }): Promise<GitCommit[]> =>
    ipcRenderer.invoke(IpcChannels.gitLog, workspaceId, opts),
  commitDetail: (workspaceId: string, hash: string): Promise<GitCommitDetail | null> =>
    ipcRenderer.invoke(IpcChannels.gitCommitDetail, workspaceId, hash),
  branches: (workspaceId: string): Promise<GitBranch[]> =>
    ipcRenderer.invoke(IpcChannels.gitBranches, workspaceId),
  checkout: (
    workspaceId: string,
    branch: string,
    opts?: { force?: boolean },
  ): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke(IpcChannels.gitCheckout, workspaceId, branch, opts),
  createBranch: (
    workspaceId: string,
    name: string,
    checkout?: boolean,
  ): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke(IpcChannels.gitCreateBranch, workspaceId, name, checkout),
  tags: (workspaceId: string): Promise<GitTag[]> =>
    ipcRenderer.invoke(IpcChannels.gitTags, workspaceId),
  createTag: (workspaceId: string, name: string, message?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitCreateTag, workspaceId, name, message),
  blame: (workspaceId: string, path: string): Promise<GitBlameLine[]> =>
    ipcRenderer.invoke(IpcChannels.gitBlame, workspaceId, path),
  fetch: (workspaceId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.gitFetch, workspaceId),
  push: (
    workspaceId: string,
    opts?: { setUpstream?: boolean; force?: boolean },
  ): Promise<GitPushResult> => ipcRenderer.invoke(IpcChannels.gitPush, workspaceId, opts),
  pull: (workspaceId: string, opts?: { rebase?: boolean }): Promise<GitPullResult> =>
    ipcRenderer.invoke(IpcChannels.gitPull, workspaceId, opts),
  init: (workspaceId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.gitInit, workspaceId),
  checkpointCreate: (
    workspaceId: string,
    sessionId: string,
    label: string,
    opts?: { messageId?: string },
  ): Promise<GitCheckpoint | null> =>
    ipcRenderer.invoke(IpcChannels.gitCheckpointCreate, workspaceId, sessionId, label, opts),
  checkpointList: (sessionId: string): Promise<GitCheckpoint[]> =>
    ipcRenderer.invoke(IpcChannels.gitCheckpointList, sessionId),
  checkpointDiff: (workspaceId: string, checkpointId: string): Promise<GitFileChange[]> =>
    ipcRenderer.invoke(IpcChannels.gitCheckpointDiff, workspaceId, checkpointId),
  checkpointRestore: (workspaceId: string, checkpointId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.gitCheckpointRestore, workspaceId, checkpointId),
  checkpointDelete: (workspaceId: string, checkpointId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.gitCheckpointDelete, workspaceId, checkpointId),
  onChanged: (cb: (payload: { workspaceId: string }) => void): (() => void) =>
    subscribe<{ workspaceId: string }>(IpcEvents.gitChanged, cb),
  onCheckpointsChanged: (cb: (payload: { sessionId: string }) => void): (() => void) =>
    subscribe<{ sessionId: string }>(IpcEvents.gitCheckpointsChanged, cb),
};

const memoryApi = {
  list: (filter: MemoryListFilter): Promise<Memory[]> =>
    ipcRenderer.invoke(IpcChannels.memoryList, filter),
  get: (id: string): Promise<Memory | null> => ipcRenderer.invoke(IpcChannels.memoryGet, id),
  search: (
    query: string,
    opts: { workspaceId: string | null; tiers?: MemoryTier[]; limit?: number },
  ): Promise<MemoryHit[]> => ipcRenderer.invoke(IpcChannels.memorySearch, query, opts),
  create: (input: MemoryCreateInput): Promise<Memory> =>
    ipcRenderer.invoke(IpcChannels.memoryCreate, input),
  update: (id: string, patch: MemoryUpdateInput): Promise<Memory | null> =>
    ipcRenderer.invoke(IpcChannels.memoryUpdate, id, patch),
  remove: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.memoryDelete, id),
  archive: (id: string, archived: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.memoryArchive, id, archived),
  pin: (id: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.memoryPin, id, pinned),
  listProposals: (workspaceId: string | null): Promise<Memory[]> =>
    ipcRenderer.invoke(IpcChannels.memoryListProposals, workspaceId),
  acceptProposal: (id: string): Promise<Memory | null> =>
    ipcRenderer.invoke(IpcChannels.memoryAcceptProposal, id),
  rejectProposal: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.memoryRejectProposal, id),
  onChanged: (cb: () => void): (() => void) => subscribe<void>(IpcEvents.memoryChanged, cb),
};

const searchApi = {
  /** Unified, cross-subsystem search — ranked hits grouped by originating source. */
  global: (query: string, opts: SearchQueryOptions): Promise<SearchGroup[]> =>
    ipcRenderer.invoke(IpcChannels.searchGlobal, query, opts),
  /** File-only search (name / path / content). */
  files: (query: string, opts: SearchQueryOptions): Promise<SearchHit[]> =>
    ipcRenderer.invoke(IpcChannels.searchFiles, query, opts),
  /** Symbol-only search (functions / classes / interfaces / …). */
  symbols: (query: string, opts: SearchQueryOptions): Promise<SearchHit[]> =>
    ipcRenderer.invoke(IpcChannels.searchSymbols, query, opts),
  /** Rebuild the workspace's file + symbol index. */
  reindex: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.searchReindex, workspaceId),
  /** Whether a workspace is indexed + its indexed file count. */
  getStatus: (workspaceId: string | null): Promise<{ indexed: boolean; files: number }> =>
    ipcRenderer.invoke(IpcChannels.searchGetStatus, workspaceId),
  /** Recent searches for a scope (most-recent-first). */
  historyList: (workspaceId: string | null): Promise<SearchHistoryEntry[]> =>
    ipcRenderer.invoke(IpcChannels.searchHistoryList, workspaceId),
  historyClear: (workspaceId: string | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.searchHistoryClear, workspaceId),
  /** Named, re-runnable saved searches. */
  savedList: (workspaceId: string | null): Promise<SavedSearch[]> =>
    ipcRenderer.invoke(IpcChannels.searchSavedList, workspaceId),
  savedCreate: (input: {
    workspaceId: string | null;
    name: string;
    query: string;
    filter?: SearchFilter;
  }): Promise<SavedSearch> => ipcRenderer.invoke(IpcChannels.searchSavedCreate, input),
  savedDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.searchSavedDelete, id),
  onChanged: (cb: () => void): (() => void) => subscribe<void>(IpcEvents.searchChanged, cb),
  onIndexProgress: (cb: (progress: SearchIndexProgress) => void): (() => void) =>
    subscribe<SearchIndexProgress>(IpcEvents.searchIndexProgress, cb),
};

const updatesApi = {
  /** The current updater status (for hydration on mount). */
  getState: (): Promise<UpdateStatus> => ipcRenderer.invoke(IpcChannels.updateGetState),
  /** Ask the updater to check GitHub for a newer release now. */
  check: (): Promise<UpdateStatus> => ipcRenderer.invoke(IpcChannels.updateCheck),
  /** Start downloading an available update (when autoDownload is off). */
  download: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateDownload),
  /** Quit and install a downloaded update. */
  install: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateInstall),
  onStatus: (cb: (status: UpdateStatus) => void): (() => void) =>
    subscribe<UpdateStatus>(IpcEvents.updateStatus, cb),
};

const limbooApi = {
  window: windowApi,
  settings: settingsApi,
  system: systemApi,
  app: appApi,
  events: eventsApi,
  workspace: workspaceApi,
  session: sessionApi,
  agent: agentApi,
  fs: fsApi,
  terminal: terminalApi,
  git: gitApi,
  memory: memoryApi,
  search: searchApi,
  updates: updatesApi,
};

contextBridge.exposeInMainWorld('limboo', limbooApi);

export type LimbooApi = typeof limbooApi;
