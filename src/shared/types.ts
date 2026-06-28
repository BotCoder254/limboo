/**
 * Types shared across the main, preload, and renderer processes. These describe
 * the data that crosses the IPC boundary plus the core domain models the UI is
 * shaped around. Phase 1 ships no agent/git/terminal logic, but the models are
 * intentionally shaped so later phases can feed real data in without redesign.
 */

/** Recursive partial — used for settings patches that cross the IPC boundary. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/* ------------------------------------------------------------------ */
/* Window state                                                        */
/* ------------------------------------------------------------------ */

/** Persisted window geometry, restored on the next launch. */
export interface WindowStateData {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Visual density of UI rows/controls. */
export type UiDensity = 'comfortable' | 'compact';

/**
 * The right activity drawer tabs. Mirrors the rail in the UI.
 */
export type ActivityTab = 'files' | 'changes' | 'tasks' | 'activity' | 'console';

/**
 * Persistent, user-facing preferences. NOTE: there is intentionally NO light
 * theme — Limboo is pure-black, dark-only by product rule. "Appearance" here is
 * limited to density / font scaling / motion, never a color scheme.
 */
export interface AppSettings {
  /** Schema version so future migrations can upgrade older settings files. */
  version: number;
  appearance: {
    density: UiDensity;
    /** UI font scale multiplier, clamped on read (e.g. 0.85–1.3). */
    fontScale: number;
    /** Honor reduced-motion / disable non-essential animations. */
    reducedMotion: boolean;
  };
  layout: {
    /** Left sessions sidebar width in px. */
    leftWidth: number;
    /** Right activity drawer width in px. */
    rightWidth: number;
    /** Currently open drawer tab, or null when the drawer is collapsed. */
    activeTab: ActivityTab | null;
  };
  behavior: {
    /** Keep running in the tray when the last window closes. */
    minimizeToTray: boolean;
    /** Show desktop notifications for long-running / completed work. */
    notifications: boolean;
  };
  /**
   * Coding-agent (Claude Code) orchestration preferences. Limboo never stores
   * Anthropic credentials — Claude Code owns authentication. These knobs only
   * shape how the local agent process is driven.
   */
  agent: {
    /** Anthropic model id passed to the Claude Code runtime. */
    model: string;
    /** Extended-thinking budget. */
    thinking: 'off' | 'on' | 'adaptive';
    /**
     * How tool calls are gated:
     * - `approve-edits`: writes/commands prompt; reads run freely.
     * - `approve-all`:   every gated tool prompts.
     * - `auto`:          nothing prompts (still path-guarded to the workspace).
     */
    permissionMode: 'approve-edits' | 'approve-all' | 'auto';
    /** Offer the built-in WebSearch tool to the agent. */
    webSearch: boolean;
    /** Auto-approve read-only tools (read/glob/grep/websearch) inside the workspace. */
    autoApproveReads: boolean;
    /** Maximum internal agent turns before the run yields. */
    maxTurns: number;
    /** How chatty the agent diagnostics console + main log are. */
    logVerbosity: 'quiet' | 'normal' | 'verbose';
    /**
     * Connection-monitoring / reliability knobs. These shape how the manager
     * supervises the Claude Code capability — heartbeat cadence, automatic
     * recovery, and connectivity notifications. None of them touch credentials.
     */
    connection: {
      /** Heartbeat re-verification interval (ms). 0 disables the heartbeat. */
      heartbeatInterval: number;
      /** Base delay before a recovery retry (ms); grows with exponential backoff. */
      reconnectDelay: number;
      /** Max transparent recovery attempts before surfacing a `failed` state. */
      maxRecoveryAttempts: number;
      /** Consecutive heartbeat failures before entering `reconnecting`. */
      heartbeatFailureThreshold: number;
      /** Idle window (ms) after which an idle run baseline is refreshed. 0 disables. */
      idleTimeout: number;
      /** Re-probe + reset to ready automatically after a recoverable capability error. */
      autoRestart: boolean;
      /** Persist sdk session ids + diagnostics across app restarts. */
      sessionPersistence: boolean;
      /** Desktop notifications for connectivity transitions (reconnect / rate-limit). */
      connectivityNotifications: boolean;
    };
  };
}

/** A dotted-path key into {@link AppSettings} (kept loose for ergonomics). */
export type SettingsKey = string;

/* ------------------------------------------------------------------ */
/* App info                                                            */
/* ------------------------------------------------------------------ */

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
}

/* ------------------------------------------------------------------ */
/* Domain models (UI-facing)                                           */
/* ------------------------------------------------------------------ */

export type SessionStatus = 'active' | 'idle' | 'done';

/**
 * A development workspace. Phase 1 only tracks identity/metadata; later phases
 * attach repository, branch, agent, terminal, checkpoints, etc.
 */
export interface Session {
  id: string;
  title: string;
  branch: string;
  status: SessionStatus;
  /** Epoch ms of last activity; the UI formats this relatively. */
  updatedAt: number;
  adds: number;
  dels: number;
  unread: number;
  pinned: boolean;
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  adds: number;
  dels: number;
}

export interface TaskItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ActivityItem {
  id: string;
  label: string;
  /** Epoch ms; formatted relatively in the UI. */
  at: number;
}

/* ------------------------------------------------------------------ */
/* Workspace (Phase 2)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lifecycle of a workspace, modeled as a state machine so every subsystem knows
 * which operations are legal at each stage. The coding agent, for example, may
 * only receive prompts once a workspace is `ready`.
 */
export type WorkspaceLifecycle =
  | 'created'
  | 'validated'
  | 'opening'
  | 'loading'
  | 'ready'
  | 'busy'
  | 'closing'
  | 'error';

/** Overall health surfaced on workspace cards. */
export type WorkspaceHealth = 'ok' | 'warning' | 'error' | 'unknown';

/** A detected package manager. */
export type PackageManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'cargo'
  | 'go'
  | 'maven'
  | 'gradle'
  | 'pip'
  | 'unknown';

/**
 * Structured identity of a project, computed once by the detection pipeline and
 * cached so subsystems never re-inspect the filesystem just to read it.
 */
export interface WorkspaceMetadata {
  /** Detected programming languages, most-prevalent first. */
  languages: string[];
  /** Detected package managers. */
  packageManagers: PackageManager[];
  /** Detected frameworks / notable config (e.g. "Vite", "Docker", "ESLint"). */
  frameworks: string[];
  /** Whether a `.git` repository was found at the root. */
  hasGit: boolean;
  /** Active git branch, if any. */
  branch?: string;
  /** Whether a Dockerfile / compose file was found. */
  hasDocker: boolean;
}

/**
 * Per-workspace configuration — independent from every other workspace and from
 * global {@link AppSettings}. Describes how the app should behave inside this
 * project. Extended in later phases (agent params, indexing schedules, …).
 */
export interface WorkspaceConfig {
  /** Directories excluded from walking / indexing / search. */
  ignoredDirs: string[];
  /** Require explicit approval before the agent runs terminal commands. */
  approveTerminalCommands: boolean;
  /** Preferred shell for terminal sessions (empty = OS default). */
  preferredShell: string;
}

/** Groundable repository statistics (no indexing/search engine required yet). */
export interface WorkspaceStats {
  fileCount: number;
  /** Total size on disk in bytes (bounded walk; excludes ignored dirs). */
  sizeBytes: number;
  /** Language → file count. */
  languageBreakdown: Record<string, number>;
  /** Declared dependency count from the primary manifest, if any. */
  dependencyCount: number;
  /** Git commit count on the active branch, if a repo. */
  commitCount?: number;
}

/**
 * A development workspace: the app's complete representation of a project. The
 * central source of truth every other subsystem references.
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  /** Deterministic icon descriptor (initial + accent hue), rendered on-palette. */
  icon: WorkspaceIcon;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  favorite: boolean;
  lifecycle: WorkspaceLifecycle;
  health: WorkspaceHealth;
  metadata: WorkspaceMetadata;
  config: WorkspaceConfig;
}

/** A background-less, on-palette project glyph. */
export interface WorkspaceIcon {
  /** 1–2 character label (derived from the project name). */
  initials: string;
  /** Hue (0–360) for the accent ring/text; never a filled background. */
  hue: number;
}

/** Result of the create/open validation pipeline. */
export interface WorkspaceValidationResult {
  ok: boolean;
  /** Human-readable diagnostics when `ok` is false. */
  errors: string[];
  /** Non-fatal warnings (still openable). */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Coding agent (Claude Code orchestration)                            */
/* ------------------------------------------------------------------ */

/**
 * Axis A — the lifecycle of the local Claude Code *capability* (process-
 * spawnable, auth valid, SDK loadable, reachable). This is independent of any
 * single request's outcome: a failed prompt must NOT push this to a fatal state
 * while the capability is still healthy.
 */
export type AgentLifecycleStatus =
  | 'starting' // first install/auth/SDK probe in flight
  | 'initializing' // probe passed, wiring heartbeat
  | 'ready' // healthy & idle — the steady state
  | 'busy' // a run is mid-flight (pre-stream: connecting/handshake)
  | 'streaming' // a run is actively emitting tokens / tool calls
  | 'awaiting-permission' // a run is blocked on a renderer approval
  | 'reconnecting' // transient failure(s); recovery loop retrying
  | 'rate-limited' // provider rate/session limit hit; capability intact
  | 'auth-required' // auth invalid/expired; needs the user to sign in again
  | 'offline' // host network unreachable (heartbeat connectivity probe)
  | 'not-installed' // Claude Code is not authenticated / available
  | 'failed'; // recovery exhausted / unrecoverable capability error

/**
 * @deprecated Transitional alias kept so existing imports compile during the
 * dual-state migration. New code should use {@link AgentLifecycleStatus}.
 */
export type AgentRuntimeStatus = AgentLifecycleStatus;

/** Axis B — terminal classification of the most recent (or active) run. */
export type RequestOutcome =
  | 'success'
  | 'failed' // generic transport/process error after recovery
  | 'cancelled' // user stopped the run
  | 'rate-limited' // hit a provider session/rate limit
  | 'tool-rejected' // a gated tool was denied and the run could not continue
  | 'auth-required' // auth failure surfaced mid-run
  | 'context-overflow'; // context window exceeded

/** Phase of the active run (drives progress UI, distinct from outcome). */
export type RequestPhase =
  | 'idle' // no active run
  | 'submitting' // user turn recorded, query() not yet streaming
  | 'connecting' // query() spawned, awaiting first SDK message
  | 'streaming' // tokens / tool calls flowing
  | 'awaiting-permission'
  | 'recovering' // recovery loop re-attempting this run
  | 'done'; // completed (see outcome)

/** Live state of the active run, mirrored to the renderer. */
export interface RequestState {
  /** Session whose run this describes, or null when idle. */
  sessionId: string | null;
  phase: RequestPhase;
  /** Terminal outcome once `phase === 'done'`; null while in flight. */
  outcome: RequestOutcome | null;
  /** Current recovery attempt (0 when not recovering). */
  attempt: number;
  maxAttempts: number;
  /** Short human reason for failed / rate-limited / auth-required outcomes. */
  detail?: string;
}

/** Parsed provider rate-limit, surfaced while lifecycle === 'rate-limited'. */
export interface RateLimitInfo {
  /** Raw message as detected from the SDK (already redacted). */
  message: string;
  /** Epoch ms when the limit is expected to reset, if parseable. */
  resetsAt?: number;
  /** IANA tz string if the provider message named one (e.g. Africa/Nairobi). */
  timezone?: string;
}

/** Result of detecting the locally-installed Claude Code CLI. */
export interface AgentInstall {
  installed: boolean;
  version?: string;
  /** Human-readable diagnostic when detection failed. */
  error?: string;
}

/** The agent's global state, broadcast to every window on change. */
export interface AgentState {
  /** Axis A — capability health. */
  lifecycle: AgentLifecycleStatus;
  install: AgentInstall;
  /** Axis B — the active / last run. */
  request: RequestState;
  /** Session id whose run is currently active, if any. */
  activeSessionId: string | null;
  /** Present while lifecycle === 'rate-limited'. */
  rateLimit?: RateLimitInfo;
  /** Last capability-level error (NOT a request-level failure). */
  error?: string;
  /** Heartbeat bookkeeping for the UI ("last checked 3s ago"). */
  heartbeat: {
    lastOkAt: number | null;
    consecutiveFailures: number;
  };
}

/** Severity for a diagnostics console line. */
export type DiagnosticSeverity = 'debug' | 'info' | 'warning' | 'error';

/** Category groups diagnostics in the Agent Console rail / filter. */
export type DiagnosticCategory =
  | 'lifecycle' // init, handshake, attach, termination
  | 'request' // prompt submit, completion, cancel
  | 'tool' // tool exec / approval
  | 'stream' // streaming start/stop
  | 'recovery' // reconnect attempt / outcome
  | 'auth' // auth change
  | 'rate-limit' // limit hit / cleared
  | 'heartbeat'; // periodic health probe

/**
 * One structured line in the Agent Console. Append-only, optionally persisted.
 * `detail` is the expandable technical payload (already redacted) shown when the
 * user opens the row — never raw secrets.
 */
export interface AgentDiagnostic {
  id: string;
  /** Session scope, or null for capability-global events (heartbeat, auth). */
  sessionId: string | null;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  /** Short one-line label. */
  label: string;
  /** Expandable, multi-line technical detail (redacted). */
  detail?: string;
  /** Epoch ms; formatted relatively in the UI. */
  at: number;
}

export type ChatRole = 'user' | 'assistant';

/** One conversation turn rendered in the center column. */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  /** True while assistant tokens are still streaming in. */
  streaming: boolean;
  createdAt: number;
}

/** Risk class used to gate a tool call. */
export type ToolRisk = 'read' | 'write' | 'command';
export type ToolCallStatus = 'running' | 'done' | 'denied' | 'error';

/** An agent tool invocation, shown inline in the conversation. */
export interface AgentToolCall {
  id: string;
  sessionId: string;
  /** Raw tool name (e.g. `Read`, `Edit`, `Bash`, `WebSearch`). */
  name: string;
  risk: ToolRisk;
  /** One-line human summary (e.g. `Edit src/app.ts`). */
  summary: string;
  /**
   * Optional expandable detail surfaced in the conversation tool card — e.g. the
   * web-search query, the fetched URL, the command text, or a short diff.
   */
  detail?: string;
  /** For web tools: the target URL or search query, shown inline in chat. */
  target?: string;
  status: ToolCallStatus;
  startedAt: number;
  endedAt?: number;
}

/** A pending approval the renderer must resolve before the tool runs. */
export interface PermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  risk: ToolRisk;
  summary: string;
  /** Operation preview: command text, file path, or a short diff snippet. */
  detail?: string;
  createdAt: number;
}

/** The renderer's answer to a {@link PermissionRequest}. */
export interface PermissionDecision {
  id: string;
  behavior: 'allow' | 'deny';
  /** Remember this choice for the rest of the session (best-effort). */
  remember?: boolean;
  /** Optional reason surfaced back to the agent on deny. */
  message?: string;
}

export type AgentActivityType =
  | 'prompt'
  | 'tool'
  | 'file-change'
  | 'permission'
  | 'result'
  | 'error'
  | 'status';

/** An immutable, audit-style entry in the Activity feed. */
export interface AgentActivityItem {
  id: string;
  sessionId: string;
  type: AgentActivityType;
  label: string;
  detail?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  /** Epoch ms; formatted relatively in the UI. */
  at: number;
}

/** Everything the renderer needs to render a session when it (re)mounts. */
export interface AgentSessionSnapshot {
  messages: ChatMessage[];
  activity: AgentActivityItem[];
  changes: FileChange[];
  tasks: TaskItem[];
  toolCalls: AgentToolCall[];
}

/**
 * The structured event stream the main process pushes as the agent works.
 * The renderer applies each event to {@link AgentSessionSnapshot}-shaped state —
 * it never scrapes raw output.
 */
export type AgentEvent =
  | { kind: 'message-start'; sessionId: string; message: ChatMessage }
  | { kind: 'message-delta'; sessionId: string; messageId: string; text: string }
  | { kind: 'message-done'; sessionId: string; message: ChatMessage }
  | { kind: 'tool-start'; sessionId: string; call: AgentToolCall }
  | { kind: 'tool-end'; sessionId: string; callId: string; status: ToolCallStatus }
  | { kind: 'file-change'; sessionId: string; change: FileChange }
  | { kind: 'activity'; sessionId: string; item: AgentActivityItem }
  | { kind: 'tasks'; sessionId: string; tasks: TaskItem[] }
  | { kind: 'result'; sessionId: string; ok: boolean; text: string }
  | { kind: 'error'; sessionId: string; message: string; outcome: RequestOutcome }
  | { kind: 'request-state'; sessionId: string; request: RequestState }
  | { kind: 'diagnostic'; diagnostic: AgentDiagnostic };

/* ------------------------------------------------------------------ */
/* Commands (palette + shortcuts + native menu)                        */
/* ------------------------------------------------------------------ */

/**
 * A stable identifier for a command that the renderer can run. These are
 * dispatched from the command palette, keyboard shortcuts, and native
 * menu/tray items (via the `command:invoke` event).
 */
export type CommandId =
  | 'session.new'
  | 'drawer.toggleFiles'
  | 'drawer.toggleChanges'
  | 'drawer.toggleTasks'
  | 'drawer.toggleActivity'
  | 'sidebar.toggle'
  | 'palette.open'
  | 'settings.open'
  | 'view.reload'
  | 'workspace.open'
  | 'workspace.new'
  | 'workspace.switch'
  | 'workspace.reindex'
  | 'agent.stop'
  | 'agent.newSession';
