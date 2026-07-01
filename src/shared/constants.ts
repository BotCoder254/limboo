import type { AppSettings, WorkspaceConfig } from './types';

/** Bumped whenever the {@link AppSettings} shape changes incompatibly. */
export const SETTINGS_VERSION = 9;

/** The agent providers Limboo can show a glyph for (Claude Code = Anthropic). */
export type AgentProvider = 'anthropic';

/** Selectable Claude models for the agent (id + short label + provider). */
export const AGENT_MODELS = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8', provider: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', provider: 'anthropic' },
] as const;

/** Resolve the provider that serves a given model id. */
export function providerForModel(model: string): AgentProvider {
  return AGENT_MODELS.find((m) => m.value === model)?.provider ?? 'anthropic';
}

/** Bounds the main process clamps agent settings against. */
export const AGENT_LIMITS = {
  maxTurns: { min: 1, max: 100, default: 24 },
  /** Cap on a single prompt the renderer may submit. */
  promptMax: 100_000,
  /** Cap on the plan markdown captured from ExitPlanMode (renderer-displayed). */
  planMarkdownMax: 262_144,
} as const;

/** Caps for the audit-style agent activity feed (label + detail truncation). */
export const ACTIVITY_LIMITS = {
  /** Max chars kept for an activity item's detail line. */
  detailMax: 160,
  /** Max chars kept for an activity item's label / short prompt echo. */
  labelMax: 120,
} as const;

/** Bounds the main process clamps agent connection-monitoring settings against. */
export const AGENT_CONNECTION_LIMITS = {
  heartbeatInterval: { min: 0, max: 600_000, default: 30_000 },
  reconnectDelay: { min: 250, max: 60_000, default: 1_000 },
  maxRecoveryAttempts: { min: 0, max: 10, default: 3 },
  heartbeatFailureThreshold: { min: 1, max: 10, default: 2 },
  idleTimeout: { min: 0, max: 1_800_000, default: 300_000 },
} as const;

/** Hard limits the renderer and main process both clamp against. */
export const LAYOUT_LIMITS = {
  left: { min: 200, max: 420, default: 264 },
  right: { min: 240, max: 560, default: 320 },
  terminal: { min: 320, max: 900, default: 480 },
  /** The Git workspace drawer benefits from a wider default (diffs/history). */
  git: { min: 360, max: 1_000, default: 560 },
} as const;

/** Bounds for the integrated terminal subsystem (main + renderer both clamp). */
export const TERMINAL_LIMITS = {
  /** Max concurrent terminals per workspace. */
  maxPerWorkspace: 12,
  /** In-memory PTY scrollback ring (lines) kept for replay on rehydrate. */
  scrollbackLines: 5_000,
  /** Max bytes accepted in a single `terminal:write` from the renderer. */
  writeBytesMax: 8_192,
  /** Terminal title length cap. */
  titleMax: 80,
  /** PTY grid bounds. */
  cols: { min: 2, max: 1_000, default: 80 },
  rows: { min: 1, max: 1_000, default: 24 },
  /** Font-size bounds for the terminal appearance setting. */
  fontSize: { min: 9, max: 24, default: 13 },
} as const;

/** Bounds + caps for the git subsystem (main + renderer clamp against these). */
export const GIT_LIMITS = {
  /** Checkpoints kept per session before older ones are pruned. */
  maxCheckpoints: { min: 1, max: 200, default: 50 },
  /** Commits fetched in a single history page. */
  logPageSize: 100,
  /** Max bytes of raw diff output parsed for one file (elided past this). */
  diffBytesMax: 1_500_000,
  /** Commit message length cap accepted from the renderer. */
  commitMessageMax: 20_000,
  /** Branch / tag / checkpoint label length cap. */
  refNameMax: 255,
  /** Timeout (ms) for network git ops (push / pull / fetch). */
  networkTimeoutMs: 120_000,
} as const;

/** Bounds + caps for the Local Memory System (main + renderer both clamp). */
export const MEMORY_LIMITS = {
  /** Memory title length cap accepted from the renderer. */
  titleMax: 200,
  /** Memory body length cap accepted from the renderer. */
  bodyMax: 20_000,
  /** Free-text search query length cap. */
  queryMax: 512,
  /** Hard ceiling on rows returned by a list / search call. */
  listMax: 500,
  /** Memories injected into a single prompt (count). */
  maxInjected: { min: 0, max: 24, default: 8 },
  /** Approx character budget for the injected memory context block. */
  injectCharBudget: 6_000,
  /** Confidence threshold (0..1) for proposal auto-accept. */
  autoAcceptConfidence: { min: 0, max: 1, default: 0.92 },
  /** Days of disuse before an unpinned memory is flagged stale. */
  staleDays: { min: 7, max: 3_650, default: 180 },
} as const;

/** Bounds + caps for the Search Engine (main + renderer both clamp). */
export const SEARCH_LIMITS = {
  /** Free-text query length cap accepted from the renderer. */
  queryMax: 512,
  /** Saved-search name length cap. */
  savedNameMax: 120,
  /** Hard ceiling on total hits returned by a single global search. */
  resultsMax: 500,
  /** Rows returned per source group in the UI. */
  maxResultsPerGroup: { min: 3, max: 50, default: 12 },
  /** Context items injected into a single agent prompt. */
  maxInjected: { min: 0, max: 24, default: 10 },
  /** Approx character budget for the injected `<project-context>` block. */
  injectCharBudget: 4_000,
  /** Files above this size (KiB) index path-only (contents skipped). */
  maxIndexFileKb: { min: 16, max: 4_096, default: 512 },
  /** Chars of file content stored in the FTS index per file (head of file). */
  contentIndexChars: 200_000,
  /** Cap on symbols extracted per file (avoids pathological generated files). */
  maxSymbolsPerFile: 400,
  /** Recent-search history ring length (hard ceiling). */
  historyMax: 50,
  /** User-configurable recent-search ring length (clamped to historyMax). */
  historyLimit: { min: 5, max: 50, default: 25 },
  /** Saved searches per scope. */
  savedMax: 200,
  /** TTL (ms) for the cached git federation snapshot (log/branches/tags). */
  gitCacheTtlMs: 15_000,
} as const;

export const FONT_SCALE_LIMITS = { min: 0.85, max: 1.3, default: 1 } as const;

/** Minimum window size enforced by the main process. */
export const WINDOW_MIN = { width: 1024, height: 640 } as const;

/** Default window size used on first launch (no persisted state yet). */
export const WINDOW_DEFAULT = { width: 1440, height: 900 } as const;

/** The single source of truth for default settings. */
export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  appearance: {
    density: 'comfortable',
    fontScale: FONT_SCALE_LIMITS.default,
    reducedMotion: false,
  },
  layout: {
    leftWidth: LAYOUT_LIMITS.left.default,
    rightWidth: LAYOUT_LIMITS.right.default,
    activeTab: 'files',
    sessionsCollapsed: false,
    terminalOpen: false,
    terminalWidth: LAYOUT_LIMITS.terminal.default,
    gitWidth: LAYOUT_LIMITS.git.default,
  },
  behavior: {
    minimizeToTray: false,
    notifications: true,
  },
  agent: {
    model: 'claude-sonnet-4-6',
    thinking: 'adaptive',
    permissionMode: 'approve-edits',
    webSearch: true,
    autoApproveReads: true,
    maxTurns: AGENT_LIMITS.maxTurns.default,
    logVerbosity: 'normal',
    connection: {
      heartbeatInterval: AGENT_CONNECTION_LIMITS.heartbeatInterval.default,
      reconnectDelay: AGENT_CONNECTION_LIMITS.reconnectDelay.default,
      maxRecoveryAttempts: AGENT_CONNECTION_LIMITS.maxRecoveryAttempts.default,
      heartbeatFailureThreshold: AGENT_CONNECTION_LIMITS.heartbeatFailureThreshold.default,
      idleTimeout: AGENT_CONNECTION_LIMITS.idleTimeout.default,
      autoRestart: true,
      sessionPersistence: true,
      connectivityNotifications: true,
    },
    plan: {
      defaultMode: 'plan',
      streamIncrementally: true,
      autoExpandTasks: true,
      autoCollapseCompleted: false,
      requireSecondaryConfirm: false,
      defaultExportFormat: 'md',
      showEstimates: true,
      showReasoning: true,
      highlightRisk: true,
      archiveCompleted: false,
      showTaskDurations: true,
      showCheckpointsOnTasks: true,
      retainPlanHistory: true,
      historyLimit: 20,
      savePlansToMemory: false,
      allowManualReorder: false,
      notifyOnPhaseComplete: false,
    },
    terminal: {
      shell: '',
      fontFamily: '',
      fontSize: TERMINAL_LIMITS.fontSize.default,
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: TERMINAL_LIMITS.scrollbackLines,
      copyOnSelect: false,
      confirmKill: true,
      mirrorAgentCommands: true,
    },
  },
  git: {
    userName: '',
    userEmail: '',
    commitMessageTemplate: '',
    suggestCommitFromConversation: true,
    autoCheckpoint: true,
    maxCheckpoints: GIT_LIMITS.maxCheckpoints.default,
    confirmBranchSwitchWithChanges: true,
    commandApproval: 'destructive',
    push: {
      autoSetUpstream: true,
      confirmForcePush: true,
    },
    pull: {
      strategy: 'ff-only',
    },
  },
  memory: {
    enabled: true,
    injectIntoPrompt: true,
    maxInjected: MEMORY_LIMITS.maxInjected.default,
    autoCapture: 'propose',
    autoAcceptConfidence: 0,
    expiry: {
      enabled: true,
      staleDays: MEMORY_LIMITS.staleDays.default,
    },
  },
  search: {
    enabled: true,
    indexContents: true,
    includeIgnored: false,
    maxFileSizeKb: SEARCH_LIMITS.maxIndexFileKb.default,
    injectContext: true,
    maxInjected: SEARCH_LIMITS.maxInjected.default,
    maxResultsPerGroup: SEARCH_LIMITS.maxResultsPerGroup.default,
    sources: {
      files: true,
      symbols: true,
      docs: true,
      memory: true,
      commits: true,
      branches: true,
      sessions: true,
    },
    liveDelay: 'fast',
    historyLimit: SEARCH_LIMITS.historyLimit.default,
    fuzzy: true,
    openOnClick: true,
  },
  updates: {
    autoCheck: true,
    autoDownload: true,
  },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Workspace (Phase 2)                                                 */
/* ------------------------------------------------------------------ */

/** Bumped whenever the workspace DB schema changes incompatibly. */
export const WORKSPACE_SCHEMA_VERSION = 7;

/** Input caps the main process enforces on renderer-supplied session values. */
export const SESSION_LIMITS = {
  titleMax: 200,
  idMax: 128,
} as const;

/** Default values for a freshly created session. */
export const SESSION_DEFAULTS = {
  title: 'New session',
  branch: 'main',
  status: 'active',
} as const;

/** Input caps the main process enforces on renderer-supplied workspace values. */
export const WORKSPACE_LIMITS = {
  nameMax: 200,
  pathMax: 4096,
} as const;

/* ------------------------------------------------------------------ */
/* File System Layer (Phase 4)                                         */
/* ------------------------------------------------------------------ */

/**
 * Bounds the File System Layer enforces so a hostile or simply enormous tree can
 * never stall the main process or exfiltrate large/binary blobs through a read.
 */
export const FS_LIMITS = {
  /** Hard ceiling on tree nodes per index pass (mirrors the stats walk cap). */
  maxTreeEntries: 50_000,
  /** Max directory depth the walker/watcher will descend. */
  maxDepth: 24,
  /** Max bytes a single `fs:readFile` may return as text (2 MiB). */
  maxReadBytes: 2 * 1024 * 1024,
  /** Bytes sniffed from the head of a file for binary (NUL) detection. */
  binarySniffBytes: 8_000,
  /** Min interval (ms) between progress pushes to the renderer. */
  progressThrottleMs: 80,
  /** Debounce (ms) coalescing watcher bursts into one tree push. */
  watchDebounceMs: 250,
  /** Bounded length of the per-workspace in-memory File History ring. */
  historyMax: 200,
  /** Per-relative-path length cap for `fs:readFile` requests. */
  relPathMax: 4096,
} as const;

/** Directories never walked for stats and excluded by default from indexing. */
export const DEFAULT_IGNORED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'target',
  'vendor',
  '.venv',
  '__pycache__',
] as const;

/** Default per-workspace configuration applied on create/open. */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  ignoredDirs: [...DEFAULT_IGNORED_DIRS],
  approveTerminalCommands: true,
  preferredShell: '',
  // Undefined = inherit the global agent.plan.defaultMode.
  planDefaultMode: undefined,
};

/**
 * System roots a workspace may never point at. The user's home directory itself
 * is also rejected (checked dynamically in the validator).
 */
export const FORBIDDEN_WORKSPACE_PATHS = [
  '/',
  '/etc',
  '/sys',
  '/proc',
  '/dev',
  '/bin',
  '/boot',
  '/usr',
  '/var',
  '/root',
] as const;
