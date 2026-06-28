import type { AppSettings, WorkspaceConfig } from './types';

/** Bumped whenever the {@link AppSettings} shape changes incompatibly. */
export const SETTINGS_VERSION = 3;

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
  },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Workspace (Phase 2)                                                 */
/* ------------------------------------------------------------------ */

/** Bumped whenever the workspace DB schema changes incompatibly. */
export const WORKSPACE_SCHEMA_VERSION = 3;

/** Input caps the main process enforces on renderer-supplied workspace values. */
export const WORKSPACE_LIMITS = {
  nameMax: 200,
  pathMax: 4096,
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
