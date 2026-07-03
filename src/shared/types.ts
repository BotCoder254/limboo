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
    /** Chat/LLM-stream typeface — an id from the CHAT_FONTS allowlist. */
    chatFont: string;
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
      /** Composer default permission mode when a session has no remembered mode. */
      defaultMode: SessionPermissionMode;
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
      /** Show per-task execution durations once implementation runs. */
      showTaskDurations: boolean;
      /** Surface a Git-checkpoint hint next to tasks during execution. */
      showCheckpointsOnTasks: boolean;
      /** Keep previous plan revisions so iterations can be compared/restored. */
      retainPlanHistory: boolean;
      /** Max plan revisions kept per session (older ones are pruned). */
      historyLimit: number;
      /** Save a completed plan into the Local Memory system for future retrieval. */
      savePlansToMemory: boolean;
      /** Allow manual reordering of tasks after approval (best-effort UI only). */
      allowManualReorder: boolean;
      /** Fire a desktop notification when a plan phase completes. */
      notifyOnPhaseComplete: boolean;
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
    /**
     * Git worktree preferences — a session may own an isolated worktree (its own
     * directory + branch) so parallel sessions never contend for one working
     * tree. ALL worktree + hook settings live here in the Git category.
     */
    worktrees: {
      /** Offer "New session in worktree" and worktree-backed flows. */
      enabled: boolean;
      /** Absolute root for worktree checkouts ('' = {userData}/worktrees). */
      root: string;
      /** Prefix for auto-generated worktree branches (e.g. limboo/<slug>). */
      branchPrefix: string;
      /** Run the repo's setup hooks (limboo.json) after a worktree is created. */
      autoSetup: boolean;
      /** Require explicit confirmation before running setup/teardown hooks. */
      confirmHooks: boolean;
      /** Run teardown hooks + remove the worktree directory when archiving. */
      teardownOnArchive: boolean;
    };
    /**
     * Scripts & Services supervision — long-running dev processes (servers,
     * workers) owned by a session, auto-assigned a loopback port and optionally
     * exposed through the local *.localhost reverse proxy.
     */
    services: {
      /** Lowest / highest port auto-assigned to a supervised service. */
      portRangeStart: number;
      portRangeEnd: number;
      /** Expose services through the loopback-only *.localhost reverse proxy. */
      proxyEnabled: boolean;
      /** Loopback port the reverse proxy listens on. */
      proxyPort: number;
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
  /**
   * Search Engine — a core platform service that maintains a continuously-updated,
   * on-device index (files, content, symbols) and federates every other subsystem
   * (memory, git, sessions, commands, …) behind one query interface. Fully local:
   * no network, no embeddings API — retrieval is SQLite FTS5/BM25 fused with fuzzy
   * + trigram substring matching. These knobs live alongside Memory (both are the
   * app's retrieval layer). Settings are surfaced in the Memory settings category.
   */
  search: {
    /** Master switch for background indexing + the Search UI + context injection. */
    enabled: boolean;
    /** Index file contents (not just paths + symbols) for full-text search. */
    indexContents: boolean;
    /** Also index files matched by the workspace ignore rules (node_modules, …). */
    includeIgnored: boolean;
    /** Max file size (KiB) whose contents are indexed; larger files index path-only. */
    maxFileSizeKb: number;
    /** Supply ranked project context (files/symbols/docs) to the agent's prompt. */
    injectContext: boolean;
    /** Max context items injected into a single prompt (ranked, budget-capped). */
    maxInjected: number;
    /** Max results shown per source group in the Search UI. */
    maxResultsPerGroup: number;
    /**
     * Per-subsystem include/exclude for Global Search. Turning a noisy source off
     * removes its group from results without touching the index. Files/symbols/docs
     * come from the on-device index; the rest are federated from their managers.
     */
    sources: {
      files: boolean;
      symbols: boolean;
      docs: boolean;
      memory: boolean;
      commits: boolean;
      /** Branches + tags (git refs). */
      branches: boolean;
      sessions: boolean;
    };
    /** Real-time as-you-type debounce: instant (0ms) · fast (90ms) · balanced (200ms). */
    liveDelay: 'instant' | 'fast' | 'balanced';
    /** Recent-search ring length kept per scope (bounded by SEARCH_LIMITS.historyMax). */
    historyLimit: number;
    /** Fuzzy/typo-tolerant (substring) matching; off = strict prefix matching. */
    fuzzy: boolean;
    /** Title-bar search box opens the modal on click; off = only the ⌘P/Ctrl+P shortcut. */
    openOnClick: boolean;
  };
  /**
   * In-app auto-update (electron-updater + GitHub releases). Only ever active in
   * a packaged build; a no-op in dev. Limboo downloads updates over HTTPS from
   * its own GitHub Releases and verifies the signed installer before applying.
   */
  updates: {
    /** Check GitHub for a newer release shortly after launch (and hourly). */
    autoCheck: boolean;
    /** Download an available update automatically (else wait for the user). */
    autoDownload: boolean;
  };
  /**
   * Voice subsystem — speech is another input/output modality for the SAME
   * agent session (never a separate conversation). Speech processing is fully
   * local (sherpa-onnx: Kokoro TTS, Parakeet STT, Silero VAD); models are
   * downloaded on demand into userData. Workspace-independent: speech
   * preferences belong to the user, not a repository.
   */
  voice: {
    /** Master switch for the voice subsystem (capture + playback + UI). */
    enabled: boolean;
    input: {
      /** Microphone device id ('' = system default). */
      deviceId: string;
      /**
       * How recording starts/stops:
       * - `push-to-talk`: record only while the hotkey/button is held.
       * - `toggle`:       click to start, click to stop (manual endpoint).
       * - `auto`:         click to start; VAD silence detection auto-stops.
       */
      activation: 'push-to-talk' | 'toggle' | 'auto';
      /** VAD speech-probability threshold (higher = less sensitive). */
      sensitivity: number;
      /** Trailing silence (ms) that ends an utterance in `auto` mode. */
      silenceMs: number;
      /** Spoken language hint (Parakeet v2 is English-only). */
      language: string;
      /** Keep the model's automatic punctuation in transcripts. */
      autoPunctuation: boolean;
    };
    output: {
      /** Speak agent responses at all. */
      enabled: boolean;
      /** Speaker/output device id ('' = system default). */
      deviceId: string;
      /** Kokoro speaker id (0–10). */
      speakerId: number;
      /** Speech rate multiplier. */
      speed: number;
      /** Playback volume (0–1, renderer gain). */
      volume: number;
      /** Begin speaking sentences while the response is still streaming. */
      streamWhileGenerating: boolean;
      /** Speak only replies to spoken prompts, or every agent reply. */
      speakWhen: 'voice-initiated' | 'always';
    };
    /** Which streamed content is eligible for speech. */
    playbackEvents: {
      finalAnswers: boolean;
      whileToolsRun: boolean;
      planningUpdates: boolean;
      taskCompletion: boolean;
      notifications: boolean;
    };
    /** What a new voice input does to in-flight speech playback. */
    interruption: 'stop' | 'pause' | 'ignore';
    shortcuts: {
      /** Toggle voice capture (combo, `Mod` = Cmd/Ctrl). */
      toggle: string;
      /** Push-to-talk hold combo. */
      pushToTalk: string;
    };
    models: {
      /** Download missing speech models automatically (opt-in; default off). */
      autoDownload: boolean;
      /** Re-download a model when the app ships a newer pinned revision. */
      autoUpdate: boolean;
      /** Never touch the network for voice (also blocks manual downloads). */
      offlineOnly: boolean;
    };
  };
}

/** A dotted-path key into {@link AppSettings} (kept loose for ergonomics). */
export type SettingsKey = string;

/* ------------------------------------------------------------------ */
/* Auto-update (electron-updater)                                      */
/* ------------------------------------------------------------------ */

/** Lifecycle stage of the in-app updater, mirrored into the renderer. */
export type UpdateStage =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/** The full updater status pushed to the renderer on every transition. */
export interface UpdateStatus {
  stage: UpdateStage;
  /** The currently running app version. */
  currentVersion: string;
  /** The newer version offered (available / downloading / downloaded). */
  version?: string;
  /** Release notes for the offered version (plain text, truncated). */
  notes?: string;
  /** Download progress, 0–100 (downloading stage only). */
  percent?: number;
  /** Last error message (error stage only). */
  error?: string;
  /** Epoch ms of the last check. */
  checkedAt?: number;
}

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
 * Internal to the main process (plan lifecycle, run bookkeeping); the renderer +
 * IPC speak {@link SessionPermissionMode} instead.
 */
export type AgentMode = 'plan' | 'implement';

/**
 * The harness-aligned permission mode the composer exposes as a single selector,
 * matching Claude Code's `Shift+Tab` cycle vocabulary:
 * - `plan`        → read-only analysis; the agent proposes a plan (SDK `plan`).
 * - `default`     → asks before edits/commands (SDK `default`).
 * - `acceptEdits` → auto-approves file edits; commands still prompt (SDK `acceptEdits`).
 * `bypassPermissions` is intentionally NOT exposed (this is a local, safety-first
 * app). The coarser auto/approve-all knobs live in Settings › Agent as advanced
 * enforcement layered on top by `canUseTool`.
 */
export type SessionPermissionMode = 'plan' | 'default' | 'acceptEdits';

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
  /** Last composer permission mode used for this session (drives the selector). */
  mode?: SessionPermissionMode;
  /**
   * Absolute path of the session's dedicated git worktree, or null when the
   * session works directly in the shared workspace checkout. A worktree-backed
   * session is an isolated engineering environment: its own directory + branch,
   * so parallel sessions never contend for one working tree.
   */
  worktreePath: string | null;
  /** Branch checked out in the session's worktree (null without a worktree). */
  worktreeBranch: string | null;
  /** Lifecycle of the session's worktree directory. */
  worktreeStatus: WorktreeStatus;
  /** The ref the worktree branch was created from (recreate/duplicate base). */
  baseRef: string | null;
  /** User-defined sidebar folder (grouping); null = ungrouped. */
  folder: string | null;
  /** Orthogonal user-defined tags (bounded + sanitized in the main process). */
  tags: string[];
}

/** Lifecycle of a session's git worktree directory. */
export type WorktreeStatus = 'none' | 'creating' | 'ready' | 'missing' | 'removing';

/** One entry parsed from `git worktree list --porcelain`, joined to sessions. */
export interface WorktreeInfo {
  path: string;
  /** Checked-out branch ref (short name), absent when detached/bare. */
  branch?: string;
  head?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  /** The Limboo session that owns this worktree, when one does. */
  sessionId?: string;
  sessionTitle?: string;
}

/**
 * Everything a session owns, summarized before permanent removal so the user
 * can preserve selected resources (branch / worktree) while removing the rest.
 */
export interface SessionDependencies {
  worktree: { path: string; exists: boolean; dirty: boolean } | null;
  branch: { name: string; exists: boolean } | null;
  terminals: number;
  checkpoints: number;
  memoryLinks: number;
  hasPlan: boolean;
}

/**
 * One entry in a session's unified engineering timeline — a merged, chronological
 * view over the activity feed, diagnostics, git checkpoints, and lifecycle
 * events. Read-only; derived by query, never stored separately.
 */
export interface SessionTimelineEntry {
  id: string;
  kind: 'activity' | 'diagnostic' | 'checkpoint' | 'lifecycle';
  label: string;
  detail?: string;
  /** Epoch ms. */
  at: number;
}

/** Options accompanying a session delete (what to do with owned resources). */
export interface SessionDeleteOptions {
  /** Remove the worktree directory (forced when dirty only if user confirmed). */
  removeWorktree?: boolean;
  /** Also delete the worktree branch (default: keep it). */
  deleteBranch?: boolean;
  /** Force worktree removal even when the tree is dirty. */
  force?: boolean;
}

/** Renderer-supplied patch for a session update (rename / pin / archive / organize). */
export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  /** Sidebar folder; null clears the grouping. */
  folder?: string | null;
  tags?: string[];
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
/* Search Engine — unified, cross-subsystem retrieval                  */
/* ------------------------------------------------------------------ */

/**
 * The kind of object a search hit represents — i.e. which subsystem owns it.
 * `file` / `symbol` come from the SearchManager's own FTS index; the rest are
 * federated from the subsystem that already owns them (memory, git, sessions,
 * commands, settings, saved searches).
 */
export type SearchKind =
  | 'file'
  | 'symbol'
  | 'doc'
  | 'memory'
  | 'commit'
  | 'branch'
  | 'tag'
  | 'session'
  | 'terminal'
  | 'diagnostic'
  | 'command'
  | 'setting'
  | 'saved';

/** A language-aware symbol classification (best-effort, from the regex extractor). */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'enum'
  | 'type'
  | 'constant'
  | 'variable'
  | 'struct'
  | 'trait'
  | 'module';

/** One unified search result, regardless of which subsystem produced it. */
export interface SearchHit {
  /** Stable id for React keys — `${kind}:${ref}`. */
  id: string;
  kind: SearchKind;
  /** Primary label (file name, symbol name, memory title, commit subject, …). */
  title: string;
  /** Secondary line (directory, signature, snippet, author/date, …). */
  subtitle?: string;
  /** Workspace-relative path when the hit maps to a file (file/symbol/doc). */
  path?: string;
  /** 1-indexed line for symbol/doc hits. */
  line?: number;
  /** Symbol classification for `symbol` hits. */
  symbolKind?: SymbolKind;
  /** Detected language for file/symbol hits. */
  lang?: string;
  /**
   * Opaque, kind-specific reference used to open the hit (commit hash, memory id,
   * command id, session id, branch name, …). For files this is the path.
   */
  ref: string;
  /** Composite rank score (ordering/debug only). */
  score?: number;
}

/** A group of hits sharing a `SearchKind`, for the grouped results UI. */
export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
  /** True when more hits exist than were returned (per-group cap hit). */
  truncated?: boolean;
}

/** Inline filters that narrow a global/scoped search. */
export interface SearchFilter {
  /** Restrict to these kinds (empty/undefined = all). */
  kinds?: SearchKind[];
  /** Restrict file/symbol hits to this language. */
  lang?: string;
  /** Restrict symbol hits to this classification. */
  symbolKind?: SymbolKind;
  /** Hard cap on total hits returned. */
  limit?: number;
  /** Fuzzy/substring matching; when false, symbol search is prefix-only (strict). */
  fuzzy?: boolean;
}

/** Options for a search request, always scoped to a workspace (or global). */
export interface SearchQueryOptions extends SearchFilter {
  workspaceId: string | null;
}

/** A persisted, re-runnable saved search. */
export interface SavedSearch {
  id: string;
  workspaceId: string | null;
  name: string;
  query: string;
  filter: SearchFilter;
  createdAt: number;
}

/** A recent-search entry (most-recent-first). */
export interface SearchHistoryEntry {
  query: string;
  at: number;
}

/** Progress of an in-flight search index pass (mirrors IndexProgress). */
export interface SearchIndexProgress {
  workspaceId: string;
  phase: 'indexing' | 'done';
  processed: number;
  total: number;
  percent: number;
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
  /**
   * Permission mode every new session in this workspace starts in. Overrides the
   * global `agent.plan.defaultMode`. The desktop equivalent of a repo's
   * `.claude/settings.json` `permissions.defaultMode`. Undefined = inherit global.
   */
  planDefaultMode?: SessionPermissionMode;
  /**
   * SHA-256 of the repo's limboo.json hooks the user has acknowledged. Repo
   * config is untrusted until acknowledged: setup/teardown hooks only run when
   * this matches the current config (or the user just confirmed the commands).
   */
  hooksAckHash?: string;
}

/* ------------------------------------------------------------------ */
/* Worktree repo config + Scripts & Services                           */
/* ------------------------------------------------------------------ */

/**
 * The repo-authored `limboo.json` at the workspace/worktree root: worktree
 * setup/teardown hooks, named scripts, and supervised services. Parsed and
 * strictly validated in the main process (size-capped, whitelisted names,
 * length-capped commands, prototype-pollution rejected) — see
 * `managers/worktree/config.ts`.
 */
export interface RepoConfig {
  /** Commands run sequentially right after a worktree is created. */
  setup: string[];
  /** Commands run before a worktree is removed (archive / delete). */
  teardown: string[];
  /** On-demand named commands (test, lint, migrate, …). */
  scripts: Record<string, string>;
  /** Long-running processes supervised per session. */
  services: Record<string, RepoServiceConfig>;
}

export interface RepoServiceConfig {
  command: string;
  /** Start automatically when the session's worktree comes up. */
  autoStart: boolean;
  /** Respawn policy after an unexpected exit. */
  restart: 'no' | 'on-failure';
}

export type ServiceStatus = 'starting' | 'running' | 'exited' | 'crashed' | 'stopped';

/** A supervised service instance owned by one session. */
export interface ServiceInfo {
  sessionId: string;
  name: string;
  status: ServiceStatus;
  /** Loopback port assigned from the configured range (null until started). */
  port: number | null;
  /** Direct URL (http://127.0.0.1:<port>) once running. */
  url: string | null;
  /** Deterministic *.localhost URL when the reverse proxy is enabled. */
  proxyUrl: string | null;
  /** Terminal streaming this service's output. */
  terminalId: string | null;
  /** Consecutive on-failure respawns since the last clean start. */
  restarts: number;
  autoStart: boolean;
}

/** Repo config + acknowledgment state, as served to the renderer. */
export interface RepoConfigState {
  config: RepoConfig | null;
  /** SHA-256 over the hooks portion — pass back to run what was displayed. */
  hash: string;
  /** True when the workspace has already acknowledged these hooks. */
  acked: boolean;
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
export type TerminalOrigin = 'user' | 'agent' | 'hook' | 'service';

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
  /** The session this terminal belongs to (worktree terminals / hooks / services). */
  sessionId?: string;
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
  /** Owning session — a worktree-backed session's terminals spawn in its worktree. */
  sessionId?: string;
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
  /**
   * Axis B — the active / last run, kept for back-compat with anything that
   * only cares about the most-recently-touched session. Multi-session UI must
   * use {@link requestsBySession} instead — sessions can run concurrently, and
   * this single field cannot represent more than one at a time.
   */
  request: RequestState;
  /** Session id whose run is currently active, if any. */
  activeSessionId: string | null;
  /** Per-session run phase — the source of truth once more than one session
   *  can be in flight at once (see CLAUDE.md multi-session concurrency notes). */
  requestsBySession: Record<string, RequestState>;
  /** Every tool approval currently awaiting a renderer decision, across all sessions. */
  pendingPermissions: PermissionRequest[];
  /** Every `AskUserQuestion` clarification currently awaiting renderer answers, across all sessions. */
  pendingClarifications: ClarificationRequest[];
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
  /**
   * For file-editing tools (Write/Edit/MultiEdit): the change summary
   * (path + status + add/del line counts) so the stream can render `+adds/-dels`
   * and a Created/Edited/Deleted indicator inline.
   */
  change?: FileChange;
  /**
   * For file-editing tools: truncated before/after content + language id so the
   * conversation stream can render a Shiki-highlighted diff on expand. `before` is
   * empty for creates, `after` empty for deletes.
   */
  edit?: { before: string; after: string; lang?: string };
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

/** One selectable choice within a {@link ClarificationQuestion}. */
export interface ClarificationOption {
  label: string;
  description: string;
}

/**
 * A single clarifying question generated by the agent's `AskUserQuestion` tool.
 * The agent authors these; the app only renders and collects answers.
 */
export interface ClarificationQuestion {
  /** The full question text to display. */
  question: string;
  /** Short label for the question (≤12 chars per the SDK). */
  header: string;
  /** 2–4 choices. */
  options: ClarificationOption[];
  /** When true, multiple options may be selected. */
  multiSelect: boolean;
}

/**
 * A pending `AskUserQuestion` the renderer must answer before the run resumes.
 * Unlike a {@link PermissionRequest}, this transfers control to the user: the
 * agent's `canUseTool` callback stays paused until the answers come back.
 */
export interface ClarificationRequest {
  id: string;
  sessionId: string;
  /** 1–4 questions. */
  questions: ClarificationQuestion[];
  createdAt: number;
}

/**
 * The renderer's answer to a {@link ClarificationRequest}. `answers` is keyed by
 * each question's text; the value is the selected option label(s) or free text.
 * `response` is an optional general reply that dismisses the structured questions.
 */
export interface ClarificationDecision {
  id: string;
  answers: Record<string, string | string[]>;
  response?: string;
}

export type AgentActivityType =
  | 'prompt'
  | 'tool'
  | 'file-change'
  | 'permission'
  | 'clarification'
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

/**
 * A historical snapshot of a {@link SessionPlan}, captured whenever the plan is
 * regenerated or re-captured. Lets the user compare and restore across iterative
 * planning cycles. Persisted to the `plan_revisions` table.
 */
export interface PlanRevision {
  /** Stable id for this revision row. */
  id: string;
  sessionId: string;
  /** Monotonic revision number within the session (1-based). */
  rev: number;
  /** The plan status at the moment it was snapshotted. */
  status: PlanStatus;
  title: string;
  markdown: string;
  meta: PlanMeta;
  /** Epoch ms the revision was recorded. */
  createdAt: number;
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
/* Voice subsystem — local STT/TTS as a modality of the agent session  */
/* ------------------------------------------------------------------ */

/** Registry ids of the downloadable local speech models. */
export type VoiceModelId = 'kokoro-en-v0_19' | 'parakeet-tdt-0.6b-v2-int8' | 'silero-vad';

/** What a speech model does. */
export type VoiceModelKind = 'tts' | 'stt' | 'vad';

/** Install/download lifecycle of one local speech model. */
export type VoiceModelPhase =
  | 'not-installed'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'extracting'
  | 'installed'
  | 'error';

/**
 * Live state of one downloadable speech model, pushed to the renderer while a
 * download/verify/extract is in flight and after install-state changes.
 */
export interface VoiceModelState {
  id: VoiceModelId;
  kind: VoiceModelKind;
  label: string;
  description: string;
  phase: VoiceModelPhase;
  /** Total archive size in bytes (registry estimate until headers arrive). */
  totalBytes: number;
  /** Bytes received so far (downloading / paused). */
  receivedBytes?: number;
  /** Overall progress 0–100 (download 0–95, verify 95–98, extract 98–100). */
  percent?: number;
  /** Current transfer speed (bytes/sec, smoothed). */
  bytesPerSec?: number;
  /** Estimated seconds remaining for the download. */
  etaSec?: number;
  /** Epoch ms the model finished installing. */
  installedAt?: number;
  /** Size on disk of the installed model. */
  installedBytes?: number;
  /** Pinned registry revision installed (for auto-update checks). */
  rev?: number;
  /** A newer pinned revision is available. */
  updateAvailable?: boolean;
  /** Human-readable failure (phase === 'error'). */
  error?: string;
}

/** Runtime phase of the voice orchestrator. */
export type VoicePhase =
  | 'idle' // nothing active
  | 'unavailable' // required models missing or the speech worker failed
  | 'starting' // worker fork / model warm-up in flight
  | 'listening' // mic open, waiting for speech (VAD auto mode)
  | 'recording' // speech in progress (or toggle/PTT active)
  | 'transcribing' // utterance ended, STT running
  | 'speaking'; // TTS playback in flight

/** The voice runtime state, broadcast to the renderer on every transition. */
export interface VoiceState {
  phase: VoicePhase;
  /** Session the capture / playback is bound to, or null when idle. */
  sessionId: string | null;
  /** Which required models are installed and loadable. */
  modelsReady: { stt: boolean; tts: boolean; vad: boolean };
  /** Human-readable failure detail (phase === 'unavailable'). */
  error?: string;
}

/** A finished utterance transcript, pushed just before it goes to the agent. */
export interface VoiceTranscript {
  sessionId: string;
  text: string;
  /**
   * Whether this is the final transcript for the utterance. Offline models
   * always emit final=true; the field future-proofs streaming STT.
   */
  final: boolean;
  /** Length of the recognized audio (ms). */
  durationMs: number;
}

/** One synthesized PCM chunk pushed to the renderer for Web Audio playback. */
export interface VoiceTtsChunk {
  /** Groups the chunks of one spoken sentence/utterance. */
  utteranceId: string;
  sessionId: string;
  /** Sample rate of the PCM (24000 for Kokoro). */
  sampleRate: number;
  /** Mono Int16 PCM samples. */
  pcm: ArrayBuffer;
  /** Chunk ordinal within the utterance. */
  seq: number;
  /** True on the final chunk of the utterance. */
  last: boolean;
}

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
  | 'session.newInWorktree'
  | 'session.duplicate'
  | 'session.nextTab'
  | 'session.prevTab'
  | 'drawer.toggleFiles'
  | 'drawer.toggleChanges'
  | 'drawer.toggleTasks'
  | 'drawer.toggleActivity'
  | 'sidebar.toggle'
  | 'palette.open'
  | 'search.open'
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
  | 'terminal.new'
  | 'worktree.prune'
  | 'voice.toggle';
