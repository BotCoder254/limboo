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
export type ActivityTab =
  | 'files'
  | 'changes'
  | 'git'
  | 'memory'
  | 'tasks'
  | 'activity'
  | 'console'
  | 'terminal';

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
    /** Whether the left sessions sidebar is collapsed to a thin rail. */
    sessionsCollapsed: boolean;
    /** Whether the integrated terminal panel is open. */
    terminalOpen: boolean;
    /** Integrated terminal panel width in px. */
    terminalWidth: number;
    /** Git workspace drawer width in px (wider default than other tabs). */
    gitWidth: number;
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
    /**
     * Plan Mode preferences — the review-first workflow where the agent proposes
     * a plan before touching the repository. None of these touch credentials.
     */
    plan: {
      /** Composer default when a session has no remembered mode. */
      defaultMode: AgentMode;
      /** Stream the task checklist incrementally as the plan is built. */
      streamIncrementally: boolean;
      /** Auto-expand newly generated task rows in the panel. */
      autoExpandTasks: boolean;
      /** Collapse completed tasks automatically during implementation. */
      autoCollapseCompleted: boolean;
      /** Require a second confirmation click before execution begins. */
      requireSecondaryConfirm: boolean;
      /** Default format used by the plan Download action. */
      defaultExportFormat: 'md' | 'txt' | 'pdf';
      /** Show the plan metadata row (affected files, task count, risk). */
      showEstimates: boolean;
      /** Render architectural reasoning alongside tasks. */
      showReasoning: boolean;
      /** Highlight high-risk steps. */
      highlightRisk: boolean;
      /** Archive a plan once its implementation completes. */
      archiveCompleted: boolean;
    };
    /**
     * Integrated-terminal preferences. Appearance + behavior knobs for the
     * workspace terminal panel; the per-workspace shell + command-approval policy
     * live on {@link WorkspaceConfig} instead.
     */
    terminal: {
      /** Shell binary override (empty = per-workspace / OS default). */
      shell: string;
      /** Terminal font family (empty = the app mono token). */
      fontFamily: string;
      /** Terminal font size in px. */
      fontSize: number;
      /** Cursor shape. */
      cursorStyle: 'block' | 'bar' | 'underline';
      /** Blink the cursor. */
      cursorBlink: boolean;
      /** Scrollback buffer length in lines. */
      scrollback: number;
      /** Copy the selection to the clipboard automatically on mouse-up. */
      copyOnSelect: boolean;
      /** Ask for confirmation before killing a terminal with a live process. */
      confirmKill: boolean;
      /** Mirror agent-run shell commands into the integrated terminal. */
      mirrorAgentCommands: boolean;
    };
  };
  /**
   * Git integration preferences. Local-only — no network, no tokens. Commit
   * identity falls back to the global git config when left blank.
   */
  git: {
    /** Commit author name (blank = inherit global git config). */
    userName: string;
    /** Commit author email (blank = inherit global git config). */
    userEmail: string;
    /** Default commit message template / prefix. */
    commitMessageTemplate: string;
    /** Offer a suggested commit message derived from the conversation. */
    suggestCommitFromConversation: boolean;
    /** Automatically create a checkpoint before high-impact agent operations. */
    autoCheckpoint: boolean;
    /** Max checkpoints to keep per session (older ones are pruned). */
    maxCheckpoints: number;
    /** Confirm before switching branches when the working tree is dirty. */
    confirmBranchSwitchWithChanges: boolean;
    /** Which git operations require explicit confirmation in the UI. */
    commandApproval: 'destructive' | 'all' | 'none';
    /**
     * Push preferences. Limboo never stores remote credentials — push relies on
     * the user's existing git credential helper / SSH agent, so a missing
     * credential fails fast with a clear message rather than hanging.
     */
    push: {
      /** First push of a branch publishes it with `-u origin <branch>`. */
      autoSetUpstream: boolean;
      /** Require an explicit confirmation before a force push (--force-with-lease). */
      confirmForcePush: boolean;
    };
    /** Pull strategy. `ff-only` avoids silent merge commits; `rebase` replays. */
    pull: {
      strategy: 'ff-only' | 'rebase';
    };
  };
  /**
   * Local Memory System — a provider-independent platform service that preserves
   * project knowledge (decisions, conventions, preferences, solutions, notes) in
   * the on-device database and injects the most relevant entries into the agent
   * prompt before it reaches the harness. Fully local: no network, no embeddings
   * API. Retrieval is SQLite FTS5/BM25 fused with recency / confidence / usage.
   */
  memory: {
    /** Master switch for the memory subsystem (capture + retrieval + UI). */
    enabled: boolean;
    /** Inject ranked, relevant memories into the agent's system context. */
    injectIntoPrompt: boolean;
    /** Max memories injected into a single prompt (ranked, budget-capped). */
    maxInjected: number;
    /**
     * How new memories are created from activity (commits, conversations):
     * - `propose`: surface as pending proposals the user accepts/dismisses.
     * - `auto`:    silently store high-confidence candidates.
     * - `off`:     only manually-authored notes are stored.
     */
    autoCapture: 'propose' | 'auto' | 'off';
    /** In `propose` mode, candidates at/above this confidence auto-accept (0 disables). */
    autoAcceptConfidence: number;
    /** Decay + archive stale memories over time. */
    expiry: {
      enabled: boolean;
      /** Days of disuse after which an unpinned memory is flagged stale. */
      staleDays: number;
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
 * Composer execution mode. `plan` runs the agent read-only to propose an
 * implementation strategy for review; `implement` lets it modify the repository.
 */
export type AgentMode = 'plan' | 'implement';

/**
 * A development workspace — the primary unit of software engineering in Limboo.
 * Owned by the main-process SessionManager and persisted to SQLite. Every
 * session belongs to exactly one workspace (`workspaceId`) and bundles its
 * conversation, activity, and metadata so work can be paused and resumed.
 */
export interface Session {
  id: string;
  /** The workspace that owns this session. */
  workspaceId: string;
  title: string;
  branch: string;
  status: SessionStatus;
  /** Epoch ms the session was created. */
  createdAt: number;
  /** Epoch ms of last activity; the UI formats this relatively. */
  updatedAt: number;
  adds: number;
  dels: number;
  unread: number;
  pinned: boolean;
  /** Archived sessions are hidden from the primary list but fully preserved. */
  archived: boolean;
  /** Epoch ms when soft-deleted (moved to trash), or null when live. */
  deletedAt: number | null;
  /** Last composer mode used for this session (drives the Plan/Implement switch). */
  mode?: AgentMode;
}

/** Renderer-supplied patch for a session update (rename / pin / archive). */
export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

/** Sort order for the sessions sidebar. */
export type SessionSort = 'recent' | 'created' | 'title';

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  adds: number;
  dels: number;
}

/** Execution state of a single plan task (mirrors TodoWrite's status). */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;
  label: string;
  done: boolean;
  /** Richer status from TodoWrite; `done` stays in sync for back-compat. */
  status?: TaskStatus;
}

export interface ActivityItem {
  id: string;
  label: string;
  /** Epoch ms; formatted relatively in the UI. */
  at: number;
}

/* ------------------------------------------------------------------ */
/* Git (deep integration)                                              */
/* ------------------------------------------------------------------ */

/** Per-file working-tree status, normalized from git porcelain XY codes. */
export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

/** A single changed path in the working tree (index and/or worktree side). */
export interface GitFileChange {
  path: string;
  /** Previous path for renames/copies. */
  oldPath?: string;
  /** Overall display status. */
  status: GitFileStatus;
  /** Has staged (index) changes. */
  staged: boolean;
  /** Has unstaged (worktree) changes. */
  unstaged: boolean;
  /** Line additions / deletions (working tree + index), 0 for untracked/binary. */
  adds: number;
  dels: number;
}

/** Live repository status — the dashboard the Git workspace renders. */
export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  /** Configured upstream ref (e.g. origin/main), if any. */
  upstream?: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  detached: boolean;
  files: GitFileChange[];
  clean: boolean;
}

export type GitDiffLineKind = 'context' | 'add' | 'del' | 'hunk' | 'meta';

export interface GitDiffLine {
  kind: GitDiffLineKind;
  text: string;
  /** 1-based line numbers in the old / new file (absent for hunk/meta rows). */
  oldLine?: number;
  newLine?: number;
}

export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

/** A parsed unified diff for one file. */
export interface GitFileDiff {
  path: string;
  oldPath?: string;
  binary: boolean;
  /** True when the file is staged-side (the diff was computed with --cached). */
  staged: boolean;
  hunks: GitDiffHunk[];
  /** Detected language hint for syntax highlighting (file extension based). */
  language?: string;
  /** Set when the real diff exceeded the size cap and was elided. */
  truncated?: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  body?: string;
  author: string;
  email: string;
  /** Author date, epoch ms. */
  at: number;
  /** Decorations (branch/tag refs) pointing at this commit. */
  refs: string[];
}

export interface GitCommitDetail {
  commit: GitCommit;
  files: GitFileChange[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitTag {
  name: string;
  hash: string;
  subject?: string;
}

export interface GitBlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  at: number;
  summary: string;
}

/** A lightweight, session-scoped recovery point stored as a dedicated git ref. */
export interface GitCheckpoint {
  id: string;
  sessionId: string;
  workspaceId: string;
  ref: string;
  commit: string;
  label: string;
  auto: boolean;
  messageId?: string;
  files: string[];
  createdAt: number;
}

/** Result of a guarded branch checkout — surfaces dirty-tree pre-flight info. */
export interface GitCheckoutResult {
  ok: boolean;
  /** Set when the checkout was refused because the working tree is dirty. */
  blockedByDirty?: boolean;
  changedFiles?: number;
  error?: string;
}

/**
 * Result of `git push`. Known git stderr signatures are decoded into flags so
 * the UI can guide the user (publish a branch, pull first, configure creds)
 * instead of surfacing a raw error. Limboo stores no credentials.
 */
export interface GitPushResult {
  ok: boolean;
  /** The branch was published with `-u origin <branch>` (first push). */
  setUpstream?: boolean;
  /** Push rejected because the remote has commits we don't (non-fast-forward). */
  rejected?: boolean;
  /** A pull/fetch is needed before pushing. */
  needsPull?: boolean;
  /** The branch has no upstream and auto-set-upstream is off. */
  noUpstream?: boolean;
  /** The repository has no remote configured. */
  noRemote?: boolean;
  /** Push failed because no credentials are configured for the remote. */
  authFailed?: boolean;
  /** Commits pushed (ahead count consumed), best-effort. */
  pushed?: number;
  error?: string;
}

/** Result of `git pull` — decodes fast-forward / conflict / divergence cases. */
export interface GitPullResult {
  ok: boolean;
  /** Remote work was integrated (fast-forward or rebase succeeded). */
  updated?: boolean;
  /** Already up to date — nothing to integrate. */
  upToDate?: boolean;
  /** The pull could not fast-forward and the strategy forbade a merge. */
  notFastForward?: boolean;
  /** The pull/rebase stopped on conflicts that need manual resolution. */
  conflicts?: boolean;
  /** Files left in a conflicted state, if known. */
  files?: string[];
  /** No remote / no upstream to pull from. */
  noUpstream?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Local Memory System                                                 */
/* ------------------------------------------------------------------ */

/**
 * Memory tiers, shortest-lived to most durable. Higher tiers outrank lower ones
 * during retrieval so architectural knowledge surfaces before transient detail.
 */
export type MemoryTier =
  | 'session' // transient, current-session context
  | 'workspace' // repository characteristics shared across sessions
  | 'project' // durable product knowledge (rules, domain, requirements)
  | 'preference' // how the developer prefers to work
  | 'convention' // recurring coding standards / patterns
  | 'decision' // architecture decisions (first-class, with rationale)
  | 'solution' // reusable implementation knowledge
  | 'note'; // manually-authored note

/** Where a memory came from. Manual notes are trusted highest. */
export type MemorySource =
  | 'manual'
  | 'auto'
  | 'commit'
  | 'conversation'
  | 'review'
  | 'terminal'
  | 'import';

/** Lifecycle of a memory. Only `active` rows are ever injected into a prompt. */
export type MemoryStatus = 'active' | 'archived' | 'proposed' | 'rejected';

/** A single unit of durable project knowledge. */
export interface Memory {
  id: string;
  /** Owning workspace, or null for global/user-scope (preferences). */
  workspaceId: string | null;
  tier: MemoryTier;
  title: string;
  body: string;
  source: MemorySource;
  /** 0..1 confidence the entry is intentional, durable knowledge. */
  confidence: number;
  pinned: boolean;
  status: MemoryStatus;
  /** How many times this memory has been retrieved into a prompt. */
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms after which the memory is considered stale (null = never). */
  expiresAt: number | null;
  /** Originating session, commit, or file (for "navigate back to source"). */
  sessionId: string | null;
  commitHash: string | null;
  filePath: string | null;
}

/** A memory plus an FTS snippet + score, returned from search/retrieval. */
export interface MemoryHit extends Memory {
  /** Highlighted snippet around the match (search) — plain body otherwise. */
  snippet?: string;
  /** Composite rank score (debug / ordering only). */
  score?: number;
}

/** Renderer-supplied fields when creating a memory. */
export interface MemoryCreateInput {
  workspaceId: string | null;
  tier: MemoryTier;
  title: string;
  body: string;
  source?: MemorySource;
  confidence?: number;
  pinned?: boolean;
  sessionId?: string | null;
}

/** Renderer-supplied patch when editing a memory (all optional). */
export interface MemoryUpdateInput {
  title?: string;
  body?: string;
  tier?: MemoryTier;
  pinned?: boolean;
  confidence?: number;
}

/** Filters for listing memories in the Memory panel. */
export interface MemoryListFilter {
  workspaceId: string | null;
  tiers?: MemoryTier[];
  /** Include archived rows (default false). */
  includeArchived?: boolean;
  limit?: number;
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
/* File System Layer (Phase 4 — read + watch + index foundation)       */
/* ------------------------------------------------------------------ */

/** Whether a tree node is a file or a directory. */
export type FileNodeType = 'file' | 'dir';

/**
 * One node in the synchronized directory tree maintained by the File System
 * Layer. Paths are workspace-relative (POSIX `/` separators) so the renderer can
 * key/render them consistently across platforms. The root node uses `path: ''`.
 */
export interface FileNode {
  /** Workspace-relative path (POSIX separators). Empty string for the root. */
  path: string;
  /** Base name of the entry. */
  name: string;
  type: FileNodeType;
  /** File size in bytes (files only; omitted for dirs). */
  size?: number;
  /** True when the entry is a symlink (never followed — see security notes). */
  isSymlink?: boolean;
  /** True when the walk hit the entry cap and stopped descending here. */
  truncated?: boolean;
  /** Child nodes (dirs only), sorted dirs-first then alphabetically. */
  children?: FileNode[];
}

/** A full directory-tree snapshot for one workspace. */
export interface FileTree {
  workspaceId: string;
  root: FileNode;
  /** Total file + directory nodes contained in the tree. */
  nodeCount: number;
  /** True when the walk was capped (the tree is partial). */
  truncated: boolean;
  /** Epoch ms the tree was built. */
  builtAt: number;
}

/** Phase of an indexing pass (drives the progress UI). */
export type IndexPhase = 'counting' | 'building' | 'done';

/** Progress of an indexing pass, pushed to the renderer as it proceeds. */
export interface IndexProgress {
  workspaceId: string;
  phase: IndexPhase;
  /** Entries processed so far. */
  processed: number;
  /** Best-effort total (from the counting pass); 0 until known. */
  total: number;
  /** Integer 0–100; reaches 100 when `phase === 'done'`. */
  percent: number;
}

/** Result of a centralized File Reader read. */
export interface FileReadResult {
  /** Workspace-relative path (POSIX separators). */
  path: string;
  /** UTF-8 text content; omitted when binary or too large to return. */
  content?: string;
  /** Detected encoding (currently always 'utf-8' when text is returned). */
  encoding: 'utf-8';
  /** True when binary content was detected (content is withheld). */
  isBinary: boolean;
  /** Size on disk in bytes. */
  size: number;
  /** True when the file exceeded the read cap and content was withheld. */
  tooLarge: boolean;
}

/** App-level interaction recorded by the File History (distinct from git). */
export interface FileHistoryEntry {
  /** Workspace-relative path (POSIX separators). */
  path: string;
  action: 'read' | 'index' | 'change';
  /** Epoch ms. */
  at: number;
}

/* ------------------------------------------------------------------ */
/* Integrated Terminal — workspace-scoped PTY sessions                 */
/* ------------------------------------------------------------------ */

/** Lifecycle state of a managed terminal's underlying PTY. */
export type TerminalStatus = 'running' | 'exited' | 'crashed';

/** Who opened a terminal — a user action or the coding agent. */
export type TerminalOrigin = 'user' | 'agent';

/**
 * A managed terminal session. The PTY itself lives in the main process
 * (node-pty); this is the metadata the renderer renders and persists.
 */
export interface TerminalSession {
  id: string;
  workspaceId: string;
  /** User-facing label (editable). */
  title: string;
  /** Working directory the PTY was spawned in (always inside the workspace root). */
  cwd: string;
  /** Resolved shell binary path (e.g. /bin/zsh). */
  shell: string;
  status: TerminalStatus;
  origin: TerminalOrigin;
  createdAt: number;
  /** Exit code, once the PTY has exited. */
  exitCode?: number;
}

/** A chunk of raw PTY output (VT byte stream) for one terminal. */
export interface TerminalChunk {
  terminalId: string;
  data: string;
}

/** A terminal's PTY exit notification. */
export interface TerminalExit {
  terminalId: string;
  exitCode: number;
  signal?: number;
}

/** Options accepted when creating a terminal. */
export interface TerminalCreateOptions {
  /** Optional label; a default ("Terminal N") is assigned when omitted. */
  title?: string;
  /** Initial PTY size. */
  cols?: number;
  rows?: number;
  /** Marks an agent-initiated terminal (used for the mirror flow). */
  origin?: TerminalOrigin;
}

/** Status of a mirrored agent command record. */
export type TerminalCommandStatus = 'running' | 'done' | 'error';

/**
 * A coding-agent shell command mirrored into the integrated terminal. The Agent
 * SDK does not stream tool stdout, so the command is echoed on `tool-start`
 * (status `running`) and completed on `tool-end` (output + exit). This is a
 * record surfaced in the terminal, not a live PTY stream.
 */
export interface TerminalCommandRecord {
  terminalId: string;
  /** The agent session that initiated the command. */
  sessionId: string;
  /** The agent tool-call id this record mirrors. */
  callId: string;
  /** The command text the agent ran. */
  command: string;
  /** Final command output (filled on completion); omitted while running. */
  output?: string;
  status: TerminalCommandStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
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

/**
 * Lifecycle of a Plan Mode artifact:
 * - `planning`  — the agent is doing read-only analysis, plan not ready yet.
 * - `ready`     — plan captured, awaiting the user's explicit approval.
 * - `implementing` — approved; the agent is executing the plan.
 * - `completed` — the implementation run finished successfully.
 * - `rejected`  — the user declined the plan.
 */
export type PlanStatus = 'planning' | 'ready' | 'implementing' | 'completed' | 'rejected';

/** Best-effort planning metadata shown in the plan header. */
export interface PlanMeta {
  /** Number of files the plan expects to touch (derived from the run). */
  affectedFiles?: number;
  /** Number of checklist tasks. */
  taskCount?: number;
  /** Coarse risk estimate. */
  risk?: 'low' | 'medium' | 'high';
  /** Detected frameworks (from the workspace metadata). */
  frameworks?: string[];
}

/**
 * A Plan Mode artifact: the agent's proposed implementation strategy for a
 * session. Persisted to SQLite so an unfinished plan survives an app restart.
 */
export interface SessionPlan {
  sessionId: string;
  status: PlanStatus;
  /** Short human title for the plan (derived from the first heading / prompt). */
  title: string;
  /** The raw plan markdown the agent produced via ExitPlanMode. */
  markdown: string;
  meta: PlanMeta;
  createdAt: number;
  /** Epoch ms the user approved execution, if approved. */
  approvedAt?: number;
  /** Pinned plans are preserved even after a new plan begins. */
  pinned?: boolean;
}

/** Everything the renderer needs to render a session when it (re)mounts. */
export interface AgentSessionSnapshot {
  messages: ChatMessage[];
  activity: AgentActivityItem[];
  changes: FileChange[];
  tasks: TaskItem[];
  toolCalls: AgentToolCall[];
  /** The active Plan Mode artifact for this session, if any. */
  plan?: SessionPlan | null;
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
  | { kind: 'plan'; sessionId: string; plan: SessionPlan }
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
  | 'session.duplicate'
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
  | 'agent.newSession'
  | 'agent.planMode'
  | 'agent.implementMode'
  | 'plan.approve'
  | 'terminal.toggle'
  | 'terminal.new';
