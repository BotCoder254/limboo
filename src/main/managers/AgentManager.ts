/**
 * AgentManager — the Coding Agent Manager. Orchestrates the local, already-
 * authenticated Claude Code through `@anthropic-ai/claude-agent-sdk`. Limboo is
 * NOT the agent; it is the operating environment around it (like a Git GUI shells
 * out to `git`). Claude Code owns authentication — this manager never stores or
 * forwards Anthropic credentials.
 *
 * Responsibilities (single domain = orchestration):
 *   • detect the local Claude Code install / auth
 *   • run prompts, map the SDK's structured message stream into typed AgentEvents
 *   • gate every tool call through a risk-based permission bridge (canUseTool)
 *   • path-guard every filesystem tool to the active workspace root
 *   • persist transcript + activity to SQLite and broadcast to all windows
 *
 * Security (CLAUDE.md §6): the SDK spawns the CLI argv-style (never shell:true);
 * file tools are canonicalized + confined to the workspace; secrets are redacted
 * before logging; prompt size is capped upstream in the IPC handler.
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type {
  Options,
  PermissionResult,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentActivityItem,
  AgentDiagnostic,
  AgentEvent,
  AgentInstall,
  AgentLifecycleStatus,
  AgentMode,
  AgentSessionSnapshot,
  AgentState,
  AgentToolCall,
  ChatMessage,
  DiagnosticCategory,
  DiagnosticSeverity,
  FileChange,
  PermissionDecision,
  PermissionRequest,
  PlanMeta,
  PlanStatus,
  RateLimitInfo,
  RequestOutcome,
  RequestState,
  SessionPlan,
  TaskItem,
  TaskStatus,
  TerminalCommandRecord,
  ToolRisk,
} from '@shared/types';
import { ACTIVITY_LIMITS, AGENT_LIMITS } from '@shared/constants';
import { IpcEvents } from '@shared/ipc-channels';
import { getDb } from '../db/database';
import { logger } from '../logger';
import type { SettingsManager } from './SettingsManager';
import type { WorkspaceManager } from './WorkspaceManager';
import type { NotificationManager } from './NotificationManager';
import type { TerminalManager } from './TerminalManager';
import type { SessionManager } from './SessionManager';
import type { GitManager } from './GitManager';
import type { MemoryManager } from './memory/MemoryManager';

/* ------------------------------------------------------------------ */
/* ESM loader — the SDK is ESM-only; main is a CJS bundle. Load it with */
/* the runtime's native dynamic import so the bundler never rewrites it. */
/* ------------------------------------------------------------------ */
type ClaudeSdk = typeof import('@anthropic-ai/claude-agent-sdk');
const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
let sdkPromise: Promise<ClaudeSdk> | null = null;
function loadSdk(): Promise<ClaudeSdk> {
  if (!sdkPromise) sdkPromise = importEsm('@anthropic-ai/claude-agent-sdk') as Promise<ClaudeSdk>;
  return sdkPromise;
}

/* ------------------------------------------------------------------ */
/* Tool risk classification                                            */
/* ------------------------------------------------------------------ */
const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead', 'TodoWrite',
]);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'BashOutput', 'KillBash', 'KillShell']);

/** The SDK tool the agent calls to present its plan and exit planning mode. */
const EXIT_PLAN_TOOL = 'ExitPlanMode';
/** The SDK tool the agent uses to maintain its implementation checklist. */
const TODO_TOOL = 'TodoWrite';

function classifyTool(name: string): ToolRisk {
  if (WRITE_TOOLS.has(name)) return 'write';
  if (COMMAND_TOOLS.has(name)) return 'command';
  if (READ_TOOLS.has(name)) return 'read';
  // Unknown / MCP tools are gated as commands (the conservative default).
  return 'command';
}

function filePathOf(input: Record<string, unknown>): string | undefined {
  const v = input.file_path ?? input.path ?? input.notebook_path;
  return typeof v === 'string' ? v : undefined;
}

/** Strip token-like secrets before anything reaches the logger. */
function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=\S+/gi, '$1=***')
    .replace(/(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._-]{10,}/gi, '$1 ***');
}

/* ------------------------------------------------------------------ */
/* Error classification — the heart of "process health vs request"    */
/* outcome". Maps a thrown error / SDK message to a request outcome    */
/* and (only when capability-level) a lifecycle transition.            */
/* ------------------------------------------------------------------ */
interface Classification {
  outcome: RequestOutcome;
  /** If set, escalate lifecycle; otherwise lifecycle stays ready/current. */
  lifecycle?: AgentLifecycleStatus;
  rateLimit?: RateLimitInfo;
  /** True when a transparent recovery retry is warranted. */
  recoverable: boolean;
}

function classifyAgentError(raw: string): Classification {
  const t = raw.toLowerCase();

  // Rate / session / usage limit — NOT an error. The process is healthy and
  // auth is valid; the service has only temporarily refused more model calls.
  if (/session limit|rate.?limit|usage limit|too many requests|hit your .*limit|quota|resets?\s+(at\s+)?\d/.test(t)) {
    return { outcome: 'rate-limited', lifecycle: 'rate-limited', rateLimit: parseRateLimit(raw), recoverable: false };
  }
  // Auth — needs the user to sign in to Claude Code again.
  if (/\b401\b|unauthorized|authentication|invalid api key|oauth|credentials? (expired|invalid|not found)|please run .?claude.? .*(sign|log) ?in|not authenticated/.test(t)) {
    return { outcome: 'auth-required', lifecycle: 'auth-required', recoverable: false };
  }
  // Context window — request-local; the capability stays ready.
  if (/context (window|length|limit) exceeded|prompt is too long|maximum context|too many tokens|context_length|model_context_window/.test(t)) {
    return { outcome: 'context-overflow', recoverable: false };
  }
  // Transient transport / process death / provider overload — retry.
  if (/econnreset|etimedout|epipe|enotfound|eai_again|socket hang up|stream (closed|ended|error)|process (exited|terminated|killed)|spawn|disconnect|network|fetch failed|\b50[023]\b|\b529\b|overloaded|temporarily unavailable/.test(t)) {
    return { outcome: 'failed', lifecycle: 'reconnecting', recoverable: true };
  }
  // Default: request-local failure; capability stays healthy.
  return { outcome: 'failed', recoverable: false };
}

/** Parse a provider rate-limit message into structured info (best-effort). */
function parseRateLimit(raw: string): RateLimitInfo {
  const message = redact(raw).slice(0, 240);
  const tzMatch = raw.match(/\(([A-Za-z]+\/[A-Za-z_]+)\)/);
  const timeMatch = raw.match(/resets?(?:\s+at)?\s+(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  let resetsAt: number | undefined;
  if (timeMatch) resetsAt = computeNextReset(timeMatch, tzMatch?.[1]);
  return { message, resetsAt, timezone: tzMatch?.[1] };
}

/**
 * Given a parsed "HH:MM[am/pm]" match and an optional IANA timezone, return the
 * epoch ms of the next wall-clock occurrence of that time. Uses Intl to read the
 * timezone's current UTC offset; falls back to local time on any error.
 */
function computeNextReset(m: RegExpMatchArray, timeZone?: string): number | undefined {
  try {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;

    const now = new Date();
    // Offset (minutes) of the target tz relative to UTC, computed from a probe.
    const tzOffsetMin = timeZone ? tzOffsetMinutes(now, timeZone) : -now.getTimezoneOffset();
    // Build the target instant for "today" at HH:MM in that tz, then roll forward.
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let target = utcMidnight + (hour * 60 + minute - tzOffsetMin) * 60_000;
    if (target <= now.getTime()) target += 24 * 60 * 60_000;
    return target;
  } catch {
    return undefined;
  }
}

/** The UTC offset (in minutes, east-positive) of `tz` at instant `at`. */
function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/** Exponential backoff with a hard cap. */
function backoff(base: number, attempt: number): number {
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 30_000);
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Per-session ephemeral state (changes / tasks / tool calls)         */
/* ------------------------------------------------------------------ */
interface SessionRuntime {
  changes: Map<string, FileChange>;
  tasks: TaskItem[];
  toolCalls: AgentToolCall[];
}

interface ActiveRun {
  abort: AbortController;
  query: { close?: () => void } | null;
  /** Whether this run is a read-only plan run or a normal implement run. */
  mode: AgentMode;
  /** Terminal SDK result for the active attempt (drives outcome classification). */
  result?: { ok: boolean; text: string };
  /** Set true once an ExitPlanMode plan was captured (suppresses the failure throw). */
  planCaptured?: boolean;
}

export class AgentManager {
  private state: AgentState = {
    lifecycle: 'starting',
    install: { installed: false },
    request: { sessionId: null, phase: 'idle', outcome: null, attempt: 0, maxAttempts: 0 },
    activeSessionId: null,
    heartbeat: { lastOkAt: null, consecutiveFailures: 0 },
  };

  private installChecked = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private rateLimitTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly runs = new Map<string, ActiveRun>();
  /** Pending permission prompts awaiting a renderer decision. */
  private readonly pending = new Map<
    string,
    { resolve: (r: PermissionResult) => void; sessionId: string }
  >();
  /** Remembered "always allow" choices, keyed `sessionId:risk`. */
  private readonly remembered = new Set<string>();

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly settings: SettingsManager,
    private readonly notifications: NotificationManager,
  ) {}

  /** The integrated terminal, wired after construction (avoids a ctor cycle). */
  private terminal: TerminalManager | null = null;

  /** Maps an in-flight command tool-call id → the terminal it is mirrored into. */
  private readonly mirroredCommands = new Map<string, { terminalId: string; command: string; startedAt: number }>();

  /** Inject the Terminal Manager used to mirror agent-run shell commands. */
  setTerminalManager(terminal: TerminalManager): void {
    this.terminal = terminal;
  }

  /** Sessions manager, wired after construction (used to auto-title from the first prompt). */
  private sessions: SessionManager | null = null;

  /** Inject the Session Manager so the first prompt can name an untitled session. */
  setSessionManager(sessions: SessionManager): void {
    this.sessions = sessions;
  }

  /** Git Manager, wired after construction (auto-checkpoints + live refresh). */
  private git: GitManager | null = null;

  /** Inject the Git Manager so the agent can checkpoint before heavy work. */
  setGitManager(git: GitManager): void {
    this.git = git;
  }

  /** Local Memory System, wired after construction (prompt context injection). */
  private memory: MemoryManager | null = null;

  /**
   * Inject the Memory Manager. Memory is a platform service owned by the app, not
   * the agent — the manager only *consumes* it to enrich each prompt with the most
   * relevant project knowledge before the harness runs.
   */
  setMemoryManager(memory: MemoryManager): void {
    this.memory = memory;
  }

  /**
   * Build the system-prompt addition that injects ranked, relevant memories for a
   * prompt. Returns undefined when memory is disabled / not injecting / empty.
   * Fully local and best-effort: a failure never blocks the run.
   */
  private memoryContextFor(sessionId: string, prompt: string): string | undefined {
    if (!this.memory) return undefined;
    const cfg = this.settings.getAll().memory;
    if (!cfg.enabled || !cfg.injectIntoPrompt) return undefined;
    try {
      const ws = this.workspace.getActive();
      const hits = this.memory.retrieve({
        workspaceId: ws?.id ?? null,
        sessionId,
        prompt,
        limit: cfg.maxInjected,
      });
      const block = this.memory.buildContextBlock(hits);
      if (block) {
        this.diag('request', 'debug', `Injected ${hits.length} memories`, undefined, sessionId);
      }
      return block || undefined;
    } catch (err) {
      logger.warn('memory: context build failed', err);
      return undefined;
    }
  }

  /**
   * Create one automatic checkpoint per run, the first time the agent performs a
   * write/command, so the pre-edit state is always recoverable. Fire-and-forget:
   * never blocks or fails the stream. Honors the `git.autoCheckpoint` setting.
   */
  private maybeAutoCheckpoint(sessionId: string): void {
    if (!this.git) return;
    const run = this.runs.get(sessionId) as { checkpointed?: boolean } | undefined;
    if (!run || run.checkpointed) return;
    run.checkpointed = true;
    if (!this.settings.getAll().git.autoCheckpoint) return;
    const ws = this.workspace.getActive();
    if (!ws) return;
    void this.git
      .createCheckpoint(ws.id, sessionId, 'Before agent changes', { auto: true })
      .then((cp) => {
        if (cp) {
          this.pushActivity(sessionId, 'status', 'Created checkpoint', cp.label, 'info');
        }
      })
      .catch(() => {
        /* checkpointing is best-effort and never breaks a run */
      });
  }

  /* ---------------------------------------------------------------- */
  /* Public API (reached via IPC)                                     */
  /* ---------------------------------------------------------------- */

  getState(): AgentState {
    return this.state;
  }

  /**
   * Boot the manager: probe the capability once, then begin heartbeat
   * supervision. Called from the main-process wiring after construction.
   */
  start(): void {
    this.setLifecycle('initializing');
    this.diag('lifecycle', 'info', 'Agent manager starting');
    this.probeHealth(true);
    this.startHeartbeat();
    this.sweepDiagnostics();
    // Re-tune the heartbeat whenever connection settings change.
    this.settings.onChange(() => this.reconfigure());
  }

  /**
   * Detect whether Claude Code is usable. The SDK bundles the runtime, so this
   * really checks for available authentication — Claude Code owns auth and we
   * never read the secret itself, only whether one is configured. Cached for the
   * IPC accessor; {@link probeHealth} forces a fresh read.
   */
  getInstall(): AgentInstall {
    if (this.installChecked) return this.state.install;
    return this.probeHealth(true);
  }

  /**
   * Re-read install/auth presence and reconcile the lifecycle. `force` bypasses
   * the cache (used by the heartbeat). Only checks for the *presence* of creds —
   * never reads the secret.
   */
  private probeHealth(force = false): AgentInstall {
    if (this.installChecked && !force) return this.state.install;
    this.installChecked = true;

    const hasEnvToken =
      !!process.env.ANTHROPIC_API_KEY ||
      !!process.env.ANTHROPIC_AUTH_TOKEN ||
      !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const home = os.homedir();
    const credFiles = [
      path.join(home, '.claude', '.credentials.json'),
      path.join(home, '.claude.json'),
    ];
    const hasCredFile = credFiles.some((f) => {
      try {
        return fs.existsSync(f);
      } catch {
        return false;
      }
    });

    const install: AgentInstall = hasEnvToken || hasCredFile
      ? { installed: true }
      : {
          installed: false,
          error:
            'Claude Code is not authenticated. Open a terminal, run `claude`, and sign in — Limboo reuses that login.',
        };

    // Reconcile lifecycle without clobbering an in-flight run's state.
    const busy = this.runs.size > 0;
    let lifecycle = this.state.lifecycle;
    if (!install.installed) {
      lifecycle = 'not-installed';
    } else if (!busy && (this.state.lifecycle === 'starting' || this.state.lifecycle === 'initializing' || this.state.lifecycle === 'not-installed' || this.state.lifecycle === 'auth-required')) {
      lifecycle = 'ready';
    }
    this.setState({ install, lifecycle, error: install.installed ? undefined : this.state.error });
    return install;
  }

  /** Force a fresh auth probe — invoked after the user signs in again. */
  retryAuth(): AgentInstall {
    this.diag('auth', 'info', 'Re-checking Claude Code authentication');
    return this.probeHealth(true);
  }

  /** Re-read connection settings and restart the heartbeat with new cadence. */
  reconfigure(): void {
    this.startHeartbeat();
  }

  /** Restore a session's transcript + activity (from SQLite) plus live state. */
  getSnapshot(sessionId: string): AgentSessionSnapshot {
    const rt = this.runtimes.get(sessionId);
    return {
      messages: this.loadMessages(sessionId),
      activity: this.loadActivity(sessionId),
      changes: rt ? [...rt.changes.values()] : [],
      tasks: rt ? rt.tasks : [],
      toolCalls: rt ? rt.toolCalls : [],
      plan: this.loadPlan(sessionId),
    };
  }

  /** Load the persisted diagnostics console history (global or per-session). */
  getDiagnostics(sessionId?: string | null): AgentDiagnostic[] {
    const db = getDb();
    const rows = (
      sessionId
        ? db
            .prepare(
              'SELECT id, session_id, severity, category, label, detail, created_at FROM agent_diagnostics WHERE session_id = ? ORDER BY created_at DESC LIMIT 500',
            )
            .all(sessionId)
        : db
            .prepare(
              'SELECT id, session_id, severity, category, label, detail, created_at FROM agent_diagnostics ORDER BY created_at DESC LIMIT 500',
            )
            .all()
    ) as Array<{
      id: string;
      session_id: string | null;
      severity: string;
      category: string;
      label: string;
      detail: string | null;
      created_at: number;
    }>;
    return rows
      .map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        severity: r.severity as DiagnosticSeverity,
        category: r.category as DiagnosticCategory,
        label: r.label,
        detail: r.detail ?? undefined,
        at: r.created_at,
      }))
      .reverse();
  }

  /** Resolve a pending permission prompt from the renderer. */
  respondPermission(decision: PermissionDecision): void {
    const entry = this.pending.get(decision.id);
    if (!entry) return;
    this.pending.delete(decision.id);

    if (decision.behavior === 'allow') {
      if (decision.remember) this.remembered.add(`${entry.sessionId}:remember`);
      this.diag('tool', 'info', 'Tool approved', undefined, entry.sessionId);
      entry.resolve({ behavior: 'allow' });
    } else {
      this.diag('tool', 'warning', 'Tool rejected', decision.message, entry.sessionId);
      entry.resolve({
        behavior: 'deny',
        message: decision.message || 'Denied by the user.',
      });
    }

    // Drop back to streaming if there are no other prompts outstanding.
    if (this.pending.size === 0 && this.runs.has(entry.sessionId)) {
      this.setLifecycle('streaming');
      this.setRequest({ phase: 'streaming' });
    }
  }

  /** Abort the active run for a session. */
  stop(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.abort.abort();
    try {
      run.query?.close?.();
    } catch {
      /* already closed */
    }
    // Reject any prompts tied to this session so canUseTool unblocks.
    for (const [id, entry] of this.pending) {
      if (entry.sessionId === sessionId) {
        this.pending.delete(id);
        entry.resolve({ behavior: 'deny', message: 'Run stopped by the user.', interrupt: true });
      }
    }
    this.runs.delete(sessionId);
    this.completeRequest(sessionId, 'cancelled');
    if (!this.isCapabilityDegraded()) this.setLifecycle('ready', { activeSessionId: null });
    this.diag('request', 'warning', 'Run cancelled', undefined, sessionId);
    this.pushEvent({ kind: 'activity', sessionId, item: this.activity(sessionId, 'status', 'Run stopped', undefined, 'warning') });
  }

  /** Forget a session entirely (transcript, activity, runtime state). */
  clearSession(sessionId: string): void {
    this.stop(sessionId);
    this.runtimes.delete(sessionId);
    const db = getDb();
    db.prepare('DELETE FROM agent_messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM agent_activity WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM agent_session_meta WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM agent_diagnostics WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM agent_plans WHERE session_id = ?').run(sessionId);
  }

  /** Abort every active run + stop all supervision timers. Called on quit. */
  cleanup(): void {
    for (const sessionId of [...this.runs.keys()]) this.stop(sessionId);
    this.stopHeartbeat();
    this.clearRateLimitTimer();
    this.clearIdleTimer();
  }

  /**
   * Run a prompt for a session. Streams the agent's work as structured events,
   * with transparent recovery on transient failures. A failed *request* never
   * marks the whole agent dead — only a genuinely degraded *capability* does.
   */
  async send(sessionId: string, prompt: string, mode: AgentMode = 'implement'): Promise<void> {
    if (this.runs.has(sessionId)) {
      throw new Error('The agent is already working on this session.');
    }
    const install = this.getInstall();
    if (!install.installed) {
      this.setLifecycle('auth-required');
      throw new Error(install.error ?? 'Claude Code is not available.');
    }
    if (this.state.lifecycle === 'rate-limited') {
      throw new Error(this.state.rateLimit?.message ?? 'The agent is rate limited right now.');
    }
    const ws = this.workspace.getActive();
    if (!ws) {
      throw new Error('Open a workspace before talking to the agent.');
    }

    // Record + persist the user turn immediately so it feels live.
    const userMsg: ChatMessage = {
      id: newId(),
      sessionId,
      role: 'user',
      text: prompt,
      streaming: false,
      createdAt: Date.now(),
    };
    this.persistMessage(userMsg);
    this.pushEvent({ kind: 'message-done', sessionId, message: userMsg });
    this.pushActivity(sessionId, 'prompt', 'You', prompt.slice(0, ACTIVITY_LIMITS.labelMax), 'info');
    // Name an untitled session after its first prompt (a no-op once renamed).
    this.sessions?.autoTitle(sessionId, prompt);
    // Remember the mode so the composer restores it when this session reopens.
    this.sessions?.setMode(sessionId, mode);

    // Plan run: open a fresh planning artifact so the panel switches into its
    // "analyzing repository" state immediately while the agent reads.
    if (mode === 'plan') {
      this.beginPlan(sessionId, prompt);
    }

    const cfg = this.settings.getAll().agent.connection;
    const abort = new AbortController();
    this.runs.set(sessionId, { abort, query: null, mode });
    this.clearIdleTimer();
    this.setRequest({
      sessionId,
      phase: 'submitting',
      outcome: null,
      attempt: 0,
      maxAttempts: cfg.maxRecoveryAttempts,
      detail: undefined,
    });
    this.setLifecycle('busy', { activeSessionId: sessionId, error: undefined });
    this.diag('request', 'info', `Prompt submitted (${mode})`, prompt.slice(0, ACTIVITY_LIMITS.detailMax), sessionId);

    try {
      await this.runWithRecovery(sessionId, prompt, abort, cfg, mode);
    } finally {
      const captured = this.runs.get(sessionId)?.planCaptured;
      this.runs.delete(sessionId);
      // A plan run that ended without presenting a plan (error/cancel) must not
      // leave the panel stuck "analyzing" — settle it back to a rejected state.
      if (mode === 'plan' && !captured) {
        const plan = this.loadPlan(sessionId);
        if (plan && plan.status === 'planning') {
          const settled: SessionPlan = { ...plan, status: 'rejected' };
          this.savePlan(settled);
          this.pushEvent({ kind: 'plan', sessionId, plan: settled });
        }
      }
      if (!this.isCapabilityDegraded()) this.setLifecycle('ready', { activeSessionId: null });
      this.armIdleTimer(cfg);
    }
  }

  /** Retry wrapper around {@link runOnce}: classify, recover, or surface. */
  private async runWithRecovery(
    sessionId: string,
    prompt: string,
    abort: AbortController,
    cfg: ReturnType<SettingsManager['getAll']>['agent']['connection'],
    mode: AgentMode,
  ): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await this.runOnce(sessionId, prompt, abort, mode);
        if (abort.signal.aborted) {
          // The user stopped mid-stream; stop() already recorded 'cancelled'.
          return;
        }
        // A captured plan ends the read-only run cleanly — it is not a failure.
        if (this.runs.get(sessionId)?.planCaptured) {
          this.completeRequest(sessionId, 'success');
          this.markHeartbeatOk();
          return;
        }
        // A successful implement run that fulfilled a plan marks it completed.
        if (mode === 'implement') this.markPlanCompletedIfImplementing(sessionId);
        this.completeRequest(sessionId, 'success');
        this.markHeartbeatOk();
        if (this.state.lifecycle === 'reconnecting') {
          this.setLifecycle('ready');
          this.diag('recovery', 'info', 'Recovered', undefined, sessionId);
        }
        if (this.state.lifecycle === 'rate-limited') this.clearRateLimit('request succeeded');
        return;
      } catch (err) {
        if (abort.signal.aborted) {
          this.completeRequest(sessionId, 'cancelled');
          return;
        }
        const raw = err instanceof Error ? err.message : String(err);
        const cls = classifyAgentError(redact(raw));
        this.diag('recovery', cls.recoverable ? 'warning' : 'error', `Run error (${cls.outcome})`, redact(raw), sessionId);

        if (cls.outcome === 'rate-limited' && cls.rateLimit) {
          this.enterRateLimited(cls.rateLimit, sessionId);
          this.completeRequest(sessionId, 'rate-limited', cls.rateLimit.message);
          return;
        }
        if (cls.outcome === 'auth-required') {
          this.setLifecycle('auth-required', { error: redact(raw) });
          this.completeRequest(sessionId, 'auth-required', 'Sign in to Claude Code again.');
          this.pushEvent({ kind: 'error', sessionId, message: redact(raw), outcome: 'auth-required' });
          this.pushActivity(sessionId, 'error', 'Authentication required', undefined, 'warning');
          this.diag('auth', 'warning', 'Authentication required', redact(raw));
          return;
        }
        if (cls.outcome === 'context-overflow') {
          this.completeRequest(sessionId, 'context-overflow', 'Context window exceeded.');
          this.pushEvent({ kind: 'error', sessionId, message: redact(raw), outcome: 'context-overflow' });
          this.pushActivity(sessionId, 'error', 'Context window exceeded', undefined, 'warning');
          return; // capability stays ready — this is request-local
        }

        if (cls.recoverable && cfg.maxRecoveryAttempts > 0 && attempt < cfg.maxRecoveryAttempts) {
          attempt += 1;
          this.setLifecycle('reconnecting');
          this.setRequest({ phase: 'recovering', attempt });
          this.diag('recovery', 'info', `Reconnect attempt ${attempt}/${cfg.maxRecoveryAttempts}`, undefined, sessionId);
          const ok = await this.abortableDelay(backoff(cfg.reconnectDelay, attempt), abort);
          if (!ok) {
            this.completeRequest(sessionId, 'cancelled');
            return;
          }
          continue; // retry — runOnce reuses buildOptions → options.resume
        }

        // Exhausted or non-recoverable.
        logger.error('Agent run failed', redact(raw));
        this.completeRequest(sessionId, cls.outcome, redact(raw));
        this.pushEvent({ kind: 'error', sessionId, message: redact(raw), outcome: cls.outcome });
        this.pushActivity(sessionId, 'error', 'Agent error', redact(raw).slice(0, ACTIVITY_LIMITS.detailMax), 'danger');
        if (cls.recoverable) {
          // A transport error whose recovery budget is spent — capability degraded.
          this.setLifecycle('failed', { error: redact(raw) });
        }
        // Otherwise a request-local failure: the agent itself stays ready (the
        // outer send() finally restores 'ready' since the capability is healthy).
        return;
      }
    }
  }

  /** A single SDK run attempt. Streams events; re-throws on any failure. */
  private async runOnce(
    sessionId: string,
    prompt: string,
    abort: AbortController,
    mode: AgentMode,
  ): Promise<void> {
    const ws = this.workspace.getActive();
    if (!ws) throw new Error('Open a workspace before talking to the agent.');
    const cwd = ws.path;
    const agent = this.settings.getAll().agent;

    let streaming: ChatMessage | null = null;
    const ensureStreaming = (): ChatMessage => {
      if (!streaming) {
        streaming = {
          id: newId(),
          sessionId,
          role: 'assistant',
          text: '',
          streaming: true,
          createdAt: Date.now(),
        };
        this.pushEvent({ kind: 'message-start', sessionId, message: { ...streaming } });
      }
      return streaming;
    };
    const finishStreaming = (finalText?: string): void => {
      if (!streaming) return;
      if (typeof finalText === 'string' && finalText.length > 0) streaming.text = finalText;
      streaming.streaming = false;
      this.persistMessage(streaming);
      this.pushEvent({ kind: 'message-done', sessionId, message: { ...streaming } });
      // Badge the session as unread if the user is looking at a different one.
      this.sessions?.bumpUnread(sessionId);
      streaming = null;
    };

    const run = this.runs.get(sessionId);
    if (run) run.result = undefined;
    this.setRequest({ phase: 'connecting' });

    try {
      const { query } = await loadSdk();
      const memoryContext = this.memoryContextFor(sessionId, prompt);
      const options = this.buildOptions(sessionId, cwd, abort, agent, mode, memoryContext);
      this.diag('lifecycle', 'debug', 'Handshake — query opened', undefined, sessionId);
      const q = query({ prompt, options }) as unknown as AsyncIterable<SDKMessage> & {
        close?: () => void;
      };
      if (run) run.query = q;
      this.setLifecycle('streaming');
      this.setRequest({ phase: 'streaming' });
      this.diag('stream', 'debug', 'Streaming response', undefined, sessionId);

      for await (const msg of q) {
        if (abort.signal.aborted) break;
        this.handleMessage(sessionId, msg, ensureStreaming, finishStreaming);
      }
    } finally {
      finishStreaming();
    }

    // A captured plan halts the read-only run via an ExitPlanMode interrupt;
    // that is the intended terminal state, not an error to classify/retry.
    if (this.runs.get(sessionId)?.planCaptured) return;

    // A non-success terminal result is surfaced as a throw so the recovery loop
    // can classify it (rate-limit / auth / context / transient / hard failure).
    const result = this.runs.get(sessionId)?.result;
    if (result && !result.ok && !abort.signal.aborted) {
      throw new Error(result.text || 'The run ended with errors.');
    }
  }

  /* ---------------------------------------------------------------- */
  /* SDK message → structured events                                  */
  /* ---------------------------------------------------------------- */

  private handleMessage(
    sessionId: string,
    msg: SDKMessage,
    ensureStreaming: () => ChatMessage,
    finishStreaming: (finalText?: string) => void,
  ): void {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          this.rememberSdkSession(sessionId, msg.session_id);
        }
        break;
      }

      case 'stream_event': {
        const ev = msg.event as unknown as { type?: string; delta?: { type?: string; text?: string } };
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          const m = ensureStreaming();
          m.text += ev.delta.text;
          this.pushEvent({ kind: 'message-delta', sessionId, messageId: m.id, text: ev.delta.text });
        }
        break;
      }

      case 'assistant': {
        if (msg.error) {
          // Surface as a throw so the recovery loop classifies it consistently.
          throw new Error(String(msg.error));
        }
        const content = (msg.message?.content ?? []) as unknown as Array<Record<string, unknown>>;
        const text = content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('');
        if (text.trim().length > 0) {
          // Make sure a message exists even when no partial deltas were streamed
          // (e.g. includePartialMessages produced nothing), then finalize it.
          ensureStreaming();
          finishStreaming(text);
        }

        for (const block of content) {
          if (block.type === 'tool_use') {
            this.onToolUse(
              sessionId,
              String(block.id ?? newId()),
              String(block.name ?? 'tool'),
              (block.input as Record<string, unknown>) ?? {},
            );
          }
        }
        break;
      }

      case 'user': {
        const content = (msg.message?.content ?? []) as unknown as Array<Record<string, unknown>>;
        for (const block of content) {
          if (block.type === 'tool_result') {
            const id = String(block.tool_use_id ?? '');
            const status = block.is_error ? 'error' : 'done';
            this.onToolResult(sessionId, id, status, toolResultText(block.content));
          }
        }
        break;
      }

      case 'result': {
        finishStreaming();
        const ok = msg.subtype === 'success';
        const resultText = 'result' in msg && typeof msg.result === 'string' ? msg.result : '';
        const run = this.runs.get(sessionId);
        if (run) run.result = { ok, text: resultText || String(msg.subtype ?? '') };
        this.pushEvent({ kind: 'result', sessionId, ok, text: resultText });
        if (ok) {
          // Failure paths are owned by runWithRecovery (classified + surfaced).
          this.pushActivity(sessionId, 'result', 'Completed', undefined, 'success');
          this.diag('request', 'info', 'Run completed', undefined, sessionId);
          if (this.settings.getAll().behavior.notifications) {
            this.notifications.notify({
              title: 'Agent finished',
              body: 'Claude Code completed the task.',
            });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  /** Register a tool invocation (drives the inline chip + activity + changes). */
  private onToolUse(
    sessionId: string,
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): void {
    // TodoWrite drives the live task checklist rather than an inline chip.
    if (name === TODO_TOOL) {
      this.onTodoWrite(sessionId, input);
      return;
    }
    // ExitPlanMode presents the plan. It is normally captured in canUseTool; do
    // it here too as a fallback (in case the SDK doesn't route it through the
    // permission callback) and never render it as a tool chip.
    if (name === EXIT_PLAN_TOOL) {
      const run = this.runs.get(sessionId);
      if (!run?.planCaptured) {
        this.capturePlan(sessionId, typeof input.plan === 'string' ? input.plan : '');
        if (run) run.planCaptured = true;
      }
      return;
    }

    const risk = classifyTool(name);
    const call: AgentToolCall = {
      id,
      sessionId,
      name,
      risk,
      summary: summarizeTool(name, input, risk),
      detail: permissionDetail(name, input),
      target: toolTarget(name, input),
      status: 'running',
      startedAt: Date.now(),
    };
    const rt = this.runtime(sessionId);
    rt.toolCalls = [...rt.toolCalls, call];
    this.pushEvent({ kind: 'tool-start', sessionId, call });
    this.pushActivity(sessionId, 'tool', call.summary, call.target, 'info');
    this.diag('tool', 'info', call.summary, call.target ?? call.detail, sessionId);

    // Mirror agent-run shell commands into the integrated terminal so the user
    // sees exactly what the agent executes. The Agent SDK does not stream tool
    // stdout, so this is a record (command now, output on result) — not a live PTY.
    if (name === 'Bash') this.mirrorCommandStart(sessionId, id, input);

    // Snapshot the pre-edit state before the first write/command of this run.
    if (risk === 'write' || name === 'Bash') this.maybeAutoCheckpoint(sessionId);

    if (risk === 'write') {
      const change = changeFromInput(name, input);
      if (change) {
        rt.changes.set(change.path, change);
        this.pushEvent({ kind: 'file-change', sessionId, change });
        this.pushActivity(sessionId, 'file-change', `${change.status} ${shortPath(change.path)}`, undefined, 'info');
      }
    }
  }

  private onToolResult(
    sessionId: string,
    toolUseId: string,
    status: 'done' | 'error',
    output?: string,
  ): void {
    // Complete any mirrored command record first (independent of toolCalls state).
    this.mirrorCommandEnd(sessionId, toolUseId, status, output);

    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    const call = rt.toolCalls.find((c) => c.id === toolUseId);
    if (!call) return;
    call.status = status;
    call.endedAt = Date.now();
    this.pushEvent({ kind: 'tool-end', sessionId, callId: toolUseId, status });
  }

  /* ---------------------------------------------------------------- */
  /* Terminal mirroring (agent shell commands → integrated terminal)  */
  /* ---------------------------------------------------------------- */

  /** Echo an agent Bash command into the integrated terminal (status running). */
  private mirrorCommandStart(
    sessionId: string,
    callId: string,
    input: Record<string, unknown>,
  ): void {
    if (!this.terminal) return;
    if (!this.settings.getAll().agent.terminal.mirrorAgentCommands) return;
    const workspaceId = this.workspace.getActive()?.id;
    if (!workspaceId) return;
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) return;

    const terminalId = this.terminal.ensureAgentTerminal(workspaceId);
    if (!terminalId) return;

    const startedAt = Date.now();
    this.mirroredCommands.set(callId, { terminalId, command, startedAt });
    const record: TerminalCommandRecord = {
      terminalId,
      sessionId,
      callId,
      command,
      status: 'running',
      startedAt,
    };
    this.terminal.mirrorAgentCommand(record);
  }

  /** Complete a mirrored command record with its output + exit status. */
  private mirrorCommandEnd(
    sessionId: string,
    callId: string,
    status: 'done' | 'error',
    output?: string,
  ): void {
    const pending = this.mirroredCommands.get(callId);
    if (!pending || !this.terminal) return;
    this.mirroredCommands.delete(callId);
    const record: TerminalCommandRecord = {
      terminalId: pending.terminalId,
      sessionId,
      callId,
      command: pending.command,
      output: output ? output.slice(0, 100_000) : undefined,
      status: status === 'error' ? 'error' : 'done',
      exitCode: status === 'error' ? 1 : 0,
      startedAt: pending.startedAt,
      endedAt: Date.now(),
    };
    this.terminal.mirrorAgentCommand(record);
  }

  /** Map a TodoWrite call into the live task checklist + broadcast it. */
  private onTodoWrite(sessionId: string, input: Record<string, unknown>): void {
    const todos = Array.isArray(input.todos) ? (input.todos as Array<Record<string, unknown>>) : [];
    const tasks: TaskItem[] = todos.map((t, i) => {
      const status = normalizeTaskStatus(t.status);
      const label = String(t.content ?? t.activeForm ?? `Task ${i + 1}`).slice(0, 300);
      return { id: `${sessionId}_todo_${i}`, label, status, done: status === 'completed' };
    });
    const rt = this.runtime(sessionId);
    rt.tasks = tasks;
    this.pushEvent({ kind: 'tasks', sessionId, tasks });
  }

  /* ---------------------------------------------------------------- */
  /* Plan Mode                                                        */
  /* ---------------------------------------------------------------- */

  /** Public accessor (IPC): the current plan artifact for a session, if any. */
  getPlan(sessionId: string): SessionPlan | null {
    return this.loadPlan(sessionId);
  }

  /** Open a fresh planning artifact when a plan run starts. */
  private beginPlan(sessionId: string, prompt: string): void {
    const plan: SessionPlan = {
      sessionId,
      status: 'planning',
      title: deriveTitle('', prompt),
      markdown: '',
      meta: { frameworks: this.workspace.getActive()?.metadata.frameworks?.slice(0, 6) },
      createdAt: Date.now(),
    };
    this.savePlan(plan);
    this.pushEvent({ kind: 'plan', sessionId, plan });
    this.pushActivity(sessionId, 'status', 'Planning started', 'Analyzing the repository (read-only)', 'info');
    this.diag('request', 'info', 'Plan run started', undefined, sessionId);
  }

  /** Capture the plan the agent presented through ExitPlanMode, awaiting approval. */
  private capturePlan(sessionId: string, rawMarkdown: string): void {
    const markdown = rawMarkdown.slice(0, AGENT_LIMITS.planMarkdownMax);
    const existing = this.loadPlan(sessionId);
    const rt = this.runtimes.get(sessionId);
    const taskCount = rt?.tasks.length || undefined;
    const plan: SessionPlan = {
      sessionId,
      status: 'ready',
      title: deriveTitle(markdown, existing?.title),
      markdown,
      meta: {
        taskCount,
        affectedFiles: countAffectedFiles(markdown),
        risk: estimateRisk(taskCount),
        frameworks: existing?.meta.frameworks,
      },
      createdAt: existing?.createdAt ?? Date.now(),
      pinned: existing?.pinned,
    };
    this.savePlan(plan);
    this.pushEvent({ kind: 'plan', sessionId, plan });
    this.pushActivity(sessionId, 'status', 'Plan ready for review', undefined, 'info');
    this.diag('request', 'info', 'Plan captured — awaiting approval', undefined, sessionId);
  }

  /**
   * Approve a ready plan and begin implementation. Records the approval, unlocks
   * writes (implement mode), and resumes the same SDK session so the agent keeps
   * the plan in context. The only transition that lets the agent touch the repo.
   */
  async approvePlan(sessionId: string): Promise<void> {
    const plan = this.loadPlan(sessionId);
    if (!plan || plan.status !== 'ready') {
      throw new Error('There is no plan ready to approve for this session.');
    }
    const approved: SessionPlan = { ...plan, status: 'implementing', approvedAt: Date.now() };
    this.savePlan(approved);
    this.pushEvent({ kind: 'plan', sessionId, plan: approved });
    this.pushActivity(sessionId, 'status', 'Plan approved — implementing', undefined, 'success');
    this.diag('request', 'info', 'Plan approved', undefined, sessionId);

    await this.send(
      sessionId,
      'The plan is approved. Implement it now, working through the steps in order and tracking your progress with the TodoWrite tool. Ask for approval before any change you are unsure about.',
      'implement',
    );
  }

  /** Reject a ready plan; the session returns to an idle, no-plan state. */
  rejectPlan(sessionId: string): void {
    const plan = this.loadPlan(sessionId);
    if (!plan) return;
    const rejected: SessionPlan = { ...plan, status: 'rejected' };
    this.savePlan(rejected);
    this.pushEvent({ kind: 'plan', sessionId, plan: rejected });
    this.pushActivity(sessionId, 'status', 'Plan rejected', undefined, 'warning');
    this.diag('request', 'info', 'Plan rejected', undefined, sessionId);
  }

  /** Discard the current plan and run a fresh planning pass (optionally guided). */
  async regeneratePlan(sessionId: string, extra?: string): Promise<void> {
    const plan = this.loadPlan(sessionId);
    const base = plan?.title ? `Reconsider the plan for: ${plan.title}.` : 'Produce a new implementation plan.';
    const prompt = extra && extra.trim().length > 0 ? `${base}\n\n${extra.trim()}` : base;
    await this.send(sessionId, prompt, 'plan');
  }

  /** When a plan was being implemented and the run succeeds, mark it completed. */
  private markPlanCompletedIfImplementing(sessionId: string): void {
    const plan = this.loadPlan(sessionId);
    if (!plan || plan.status !== 'implementing') return;
    const completed: SessionPlan = { ...plan, status: 'completed' };
    this.savePlan(completed);
    this.pushEvent({ kind: 'plan', sessionId, plan: completed });
    this.diag('request', 'info', 'Plan implementation completed', undefined, sessionId);
  }

  private savePlan(plan: SessionPlan): void {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO agent_plans
           (session_id, status, title, markdown, meta, pinned, created_at, approved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.sessionId,
        plan.status,
        plan.title,
        plan.markdown,
        JSON.stringify(plan.meta ?? {}),
        plan.pinned ? 1 : 0,
        plan.createdAt,
        plan.approvedAt ?? null,
        Date.now(),
      );
  }

  private loadPlan(sessionId: string): SessionPlan | null {
    const row = getDb()
      .prepare(
        'SELECT session_id, status, title, markdown, meta, pinned, created_at, approved_at FROM agent_plans WHERE session_id = ?',
      )
      .get(sessionId) as
      | {
          session_id: string;
          status: string;
          title: string;
          markdown: string;
          meta: string;
          pinned: number;
          created_at: number;
          approved_at: number | null;
        }
      | undefined;
    if (!row) return null;
    let meta: PlanMeta = {};
    try {
      meta = JSON.parse(row.meta) as PlanMeta;
    } catch {
      /* keep empty meta on a corrupt row */
    }
    return {
      sessionId: row.session_id,
      status: row.status as PlanStatus,
      title: row.title,
      markdown: row.markdown,
      meta,
      pinned: row.pinned === 1,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Permission bridge                                                */
  /* ---------------------------------------------------------------- */

  private buildOptions(
    sessionId: string,
    cwd: string,
    abort: AbortController,
    agent: ReturnType<SettingsManager['getAll']>['agent'],
    mode: AgentMode,
    memoryContext?: string,
  ): Options {
    const options: Options = {
      cwd,
      model: agent.model,
      // Plan mode keeps the SDK read-only and lets the agent present a plan via
      // the ExitPlanMode tool; our canUseTool captures it. Implement mode runs
      // normally with the per-tool approval bridge.
      permissionMode: mode === 'plan' ? 'plan' : 'default',
      canUseTool: this.makeCanUseTool(sessionId, cwd, mode),
      maxTurns: agent.maxTurns,
      includePartialMessages: true,
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
      thinking: mapThinking(agent.thinking),
      stderr: (data: string) => logger.warn('[claude]', redact(data)),
    };
    // Local Memory System: append ranked project knowledge to Claude Code's
    // default system prompt (preset preserved), so the agent starts each task
    // with the most relevant context instead of an empty slate.
    if (memoryContext) {
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append: memoryContext };
    }
    if (!agent.webSearch) options.disallowedTools = ['WebSearch', 'WebFetch'];

    // Resume the Claude Code session so multi-turn conversations keep context.
    const sdkSessionId = this.loadSdkSession(sessionId);
    if (sdkSessionId) options.resume = sdkSessionId;

    return options;
  }

  private loadSdkSession(sessionId: string): string | undefined {
    const row = getDb()
      .prepare('SELECT sdk_session_id FROM agent_session_meta WHERE session_id = ?')
      .get(sessionId) as { sdk_session_id?: string } | undefined;
    return row?.sdk_session_id || undefined;
  }

  private makeCanUseTool(sessionId: string, cwd: string, mode: AgentMode) {
    const planRun = mode === 'plan';
    return async (
      toolName: string,
      input: Record<string, unknown>,
      { signal }: { signal: AbortSignal },
    ): Promise<PermissionResult> => {
      // ExitPlanMode: the agent is presenting its plan. Capture it for review and
      // interrupt the run — nothing is executed until the user approves.
      if (toolName === EXIT_PLAN_TOOL) {
        const run = this.runs.get(sessionId);
        if (!run?.planCaptured) {
          this.capturePlan(sessionId, typeof input.plan === 'string' ? input.plan : '');
          if (run) run.planCaptured = true;
        }
        return { behavior: 'deny', message: 'Plan captured for your review.', interrupt: true };
      }

      const risk = classifyTool(toolName);

      // Read-only contract (defense in depth): while a plan run is underway the
      // SDK already blocks writes, but we also refuse any write/command here so a
      // misbehaving tool can never touch the repo before approval.
      if (planRun && risk !== 'read') {
        this.pushActivity(sessionId, 'permission', `Blocked ${toolName} during planning`, undefined, 'warning');
        return { behavior: 'deny', message: 'Planning is read-only — approve the plan to make changes.' };
      }

      // Path guard: confine every filesystem tool to the workspace root.
      const target = filePathOf(input);
      if (target && !isInside(cwd, target)) {
        this.pushActivity(
          sessionId,
          'permission',
          `Blocked ${toolName} outside workspace`,
          shortPath(target),
          'danger',
        );
        return { behavior: 'deny', message: `Path is outside the workspace: ${target}` };
      }

      const mode = this.settings.getAll().agent;
      const autoRead = risk === 'read' && mode.autoApproveReads && mode.permissionMode !== 'approve-all';
      if (mode.permissionMode === 'auto' || autoRead) {
        return { behavior: 'allow' };
      }
      if (this.remembered.has(`${sessionId}:remember`)) {
        return { behavior: 'allow' };
      }

      // Interactive approval — bridge to the renderer and await its decision.
      const request: PermissionRequest = {
        id: newId(),
        sessionId,
        tool: toolName,
        risk,
        summary: summarizeTool(toolName, input, risk),
        detail: permissionDetail(toolName, input),
        createdAt: Date.now(),
      };
      this.pushActivity(sessionId, 'permission', `Asked to ${request.summary}`, undefined, 'warning');
      this.diag('tool', 'warning', `Approval requested: ${request.summary}`, request.detail, sessionId);
      this.setLifecycle('awaiting-permission');
      this.setRequest({ phase: 'awaiting-permission' });
      this.broadcastChannel(IpcEvents.agentPermissionRequest, request);

      return new Promise<PermissionResult>((resolve) => {
        const onAbort = () => {
          this.pending.delete(request.id);
          resolve({ behavior: 'deny', message: 'Run stopped.', interrupt: true });
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        this.pending.set(request.id, {
          sessionId,
          resolve: (r) => {
            signal.removeEventListener('abort', onAbort);
            resolve(r);
          },
        });
      });
    };
  }

  /* ---------------------------------------------------------------- */
  /* Persistence helpers                                              */
  /* ---------------------------------------------------------------- */

  private runtime(sessionId: string): SessionRuntime {
    let rt = this.runtimes.get(sessionId);
    if (!rt) {
      rt = { changes: new Map(), tasks: [], toolCalls: [] };
      this.runtimes.set(sessionId, rt);
    }
    return rt;
  }

  private persistMessage(m: ChatMessage): void {
    getDb()
      .prepare(
        'INSERT OR REPLACE INTO agent_messages (id, session_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(m.id, m.sessionId, m.role, m.text, m.createdAt);
  }

  private loadMessages(sessionId: string): ChatMessage[] {
    const rows = getDb()
      .prepare(
        'SELECT id, session_id, role, text, created_at FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC',
      )
      .all(sessionId) as Array<{ id: string; session_id: string; role: string; text: string; created_at: number }>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role === 'assistant' ? 'assistant' : 'user',
      text: r.text,
      streaming: false,
      createdAt: r.created_at,
    }));
  }

  private loadActivity(sessionId: string): AgentActivityItem[] {
    const rows = getDb()
      .prepare(
        'SELECT payload FROM agent_activity WHERE session_id = ? ORDER BY created_at ASC',
      )
      .all(sessionId) as Array<{ payload: string }>;
    const out: AgentActivityItem[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.payload) as AgentActivityItem);
      } catch {
        /* skip corrupt row */
      }
    }
    return out;
  }

  private activity(
    sessionId: string,
    type: AgentActivityItem['type'],
    label: string,
    detail?: string,
    tone?: AgentActivityItem['tone'],
  ): AgentActivityItem {
    return { id: newId(), sessionId, type, label, detail, tone, at: Date.now() };
  }

  private pushActivity(
    sessionId: string,
    type: AgentActivityItem['type'],
    label: string,
    detail?: string,
    tone?: AgentActivityItem['tone'],
  ): void {
    const item = this.activity(sessionId, type, label, detail, tone);
    getDb()
      .prepare(
        'INSERT INTO agent_activity (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(item.id, sessionId, type, JSON.stringify(item), item.at);
    this.pushEvent({ kind: 'activity', sessionId, item });
  }

  private rememberSdkSession(sessionId: string, sdkSessionId: string): void {
    getDb()
      .prepare(
        'INSERT OR REPLACE INTO agent_session_meta (session_id, sdk_session_id, updated_at) VALUES (?, ?, ?)',
      )
      .run(sessionId, sdkSessionId, Date.now());
  }

  /* ---------------------------------------------------------------- */
  /* State + broadcast                                                */
  /* ---------------------------------------------------------------- */

  private setState(patch: Partial<AgentState>): void {
    this.state = { ...this.state, ...patch };
    this.broadcastChannel(IpcEvents.agentStateChanged, this.state);
  }

  private setLifecycle(lifecycle: AgentLifecycleStatus, patch: Partial<AgentState> = {}): void {
    this.setState({ lifecycle, ...patch });
  }

  private setRequest(patch: Partial<RequestState>): void {
    const request = { ...this.state.request, ...patch };
    this.setState({ request });
    this.pushEvent({ kind: 'request-state', sessionId: request.sessionId ?? '', request });
  }

  private completeRequest(sessionId: string, outcome: RequestOutcome, detail?: string): void {
    this.setRequest({ sessionId, phase: 'done', outcome, detail, attempt: 0 });
  }

  /** True when the capability itself is degraded (not just the last request). */
  private isCapabilityDegraded(): boolean {
    return (
      this.state.lifecycle === 'reconnecting' ||
      this.state.lifecycle === 'rate-limited' ||
      this.state.lifecycle === 'auth-required' ||
      this.state.lifecycle === 'offline' ||
      this.state.lifecycle === 'failed' ||
      this.state.lifecycle === 'not-installed'
    );
  }

  /* ---------------------------------------------------------------- */
  /* Diagnostics console                                              */
  /* ---------------------------------------------------------------- */

  private diag(
    category: DiagnosticCategory,
    severity: DiagnosticSeverity,
    label: string,
    detail?: string,
    sessionId: string | null = null,
  ): void {
    // Honor the verbosity preference: drop debug lines unless verbose.
    const verbosity = this.settings.getAll().agent.logVerbosity;
    if (severity === 'debug' && verbosity !== 'verbose') return;
    const d: AgentDiagnostic = {
      id: newId(),
      sessionId: sessionId || null,
      severity,
      category,
      label,
      detail: detail ? redact(detail).slice(0, 2_000) : undefined,
      at: Date.now(),
    };
    if (this.settings.getAll().agent.connection.sessionPersistence) this.persistDiagnostic(d);
    this.pushEvent({ kind: 'diagnostic', diagnostic: d });
  }

  private persistDiagnostic(d: AgentDiagnostic): void {
    try {
      getDb()
        .prepare(
          'INSERT INTO agent_diagnostics (id, session_id, severity, category, label, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(d.id, d.sessionId, d.severity, d.category, d.label, d.detail ?? null, d.at);
    } catch {
      /* diagnostics are best-effort — never block a run on a write failure */
    }
  }

  /** Bound the diagnostics table: keep ~14 days of history. */
  private sweepDiagnostics(): void {
    try {
      const cutoff = Date.now() - 14 * 24 * 60 * 60_000;
      getDb().prepare('DELETE FROM agent_diagnostics WHERE created_at < ?').run(cutoff);
    } catch {
      /* best-effort */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Heartbeat supervision                                            */
  /* ---------------------------------------------------------------- */

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.settings.getAll().agent.connection.heartbeatInterval;
    if (interval <= 0) return;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), interval);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private markHeartbeatOk(): void {
    this.setState({ heartbeat: { lastOkAt: Date.now(), consecutiveFailures: 0 } });
  }

  /**
   * Lightweight liveness re-verification. There is no persistent child process
   * between prompts, so this re-probes install/auth presence and confirms the
   * SDK is loadable — never an expensive model call.
   */
  private async heartbeat(): Promise<void> {
    // An active run is itself the liveness signal; rate-limit/auth states clear
    // on their own paths, so don't fight them.
    if (this.runs.size > 0) return;
    if (this.state.lifecycle === 'rate-limited' || this.state.lifecycle === 'auth-required') return;

    const cfg = this.settings.getAll().agent.connection;
    try {
      const install = this.probeHealth(true);
      if (!install.installed) throw new Error('Claude Code authentication is no longer available.');
      await loadSdk();
      this.markHeartbeatOk();
      if (this.state.lifecycle === 'reconnecting' || this.state.lifecycle === 'offline') {
        this.setLifecycle('ready', { error: undefined });
        this.diag('heartbeat', 'info', 'Capability recovered');
      }
    } catch (err) {
      const failures = this.state.heartbeat.consecutiveFailures + 1;
      this.setState({ heartbeat: { lastOkAt: this.state.heartbeat.lastOkAt, consecutiveFailures: failures } });
      this.diag('heartbeat', 'warning', `Heartbeat failed (${failures})`, redact(String(err)));
      if (failures >= cfg.heartbeatFailureThreshold && this.state.lifecycle === 'ready') {
        this.setLifecycle('reconnecting');
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rate-limit handling                                              */
  /* ---------------------------------------------------------------- */

  private enterRateLimited(info: RateLimitInfo, sessionId: string): void {
    this.setLifecycle('rate-limited', { rateLimit: info, activeSessionId: null });
    this.diag('rate-limit', 'warning', 'Rate / session limit hit', info.message);
    this.pushActivity(sessionId, 'status', 'Rate limited', info.message.slice(0, ACTIVITY_LIMITS.detailMax), 'warning');
    this.clearRateLimitTimer();
    if (info.resetsAt) {
      const ms = Math.max(0, info.resetsAt - Date.now());
      this.rateLimitTimer = setTimeout(() => this.clearRateLimit('reset time elapsed'), ms + 1_000);
      if (this.rateLimitTimer.unref) this.rateLimitTimer.unref();
    }
    if (this.settings.getAll().agent.connection.connectivityNotifications) {
      this.notifications.notify({ title: 'Agent rate limited', body: info.message });
    }
  }

  /** Clear the rate-limit state (timer elapsed, or a later request succeeded). */
  private clearRateLimit(reason: string): void {
    if (this.state.lifecycle !== 'rate-limited') return;
    this.clearRateLimitTimer();
    this.setLifecycle('ready', { rateLimit: undefined });
    this.diag('rate-limit', 'info', 'Rate limit cleared', reason);
  }

  /** Renderer-triggered manual clear ("try again now"). */
  clearRateLimitManual(): void {
    this.clearRateLimit('cleared by the user');
  }

  private clearRateLimitTimer(): void {
    if (this.rateLimitTimer) {
      clearTimeout(this.rateLimitTimer);
      this.rateLimitTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Idle + recovery utilities                                        */
  /* ---------------------------------------------------------------- */

  private armIdleTimer(cfg: ReturnType<SettingsManager['getAll']>['agent']['connection']): void {
    this.clearIdleTimer();
    if (cfg.idleTimeout <= 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.runs.size > 0) return;
      this.diag('lifecycle', 'debug', 'Idle');
      if (cfg.autoRestart && this.state.lifecycle === 'ready') this.probeHealth(true);
    }, cfg.idleTimeout);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Resolve true after `ms`, or false if aborted first. */
  private abortableDelay(ms: number, abort: AbortController): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        abort.signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      if (abort.signal.aborted) return onAbort();
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private pushEvent(event: AgentEvent): void {
    this.broadcastChannel(IpcEvents.agentEvent, event);
  }

  private broadcastChannel(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function mapThinking(thinking: 'off' | 'on' | 'adaptive'): Options['thinking'] {
  if (thinking === 'off') return { type: 'disabled' };
  if (thinking === 'on') return { type: 'enabled', budgetTokens: 10_000 };
  return { type: 'adaptive' };
}

/** Coerce a TodoWrite status string into our TaskStatus union. */
function normalizeTaskStatus(value: unknown): TaskStatus {
  if (value === 'completed' || value === 'in_progress') return value;
  return 'pending';
}

/**
 * Pick a short plan title: the first markdown heading, else the first non-empty
 * line, else a prior title / prompt, else a sensible default.
 */
function deriveTitle(markdown: string, fallback?: string): string {
  const lines = markdown.split('\n').map((l) => l.trim());
  const heading = lines.find((l) => /^#{1,3}\s+/.test(l));
  if (heading) return truncate(heading.replace(/^#{1,3}\s+/, ''), 80);
  const firstLine = lines.find((l) => l.length > 0);
  if (firstLine) return truncate(firstLine.replace(/^[-*]\s+/, ''), 80);
  if (fallback && fallback.trim().length > 0) return truncate(fallback.trim(), 80);
  return 'Implementation plan';
}

/** Best-effort count of distinct file-ish paths referenced in a plan. */
function countAffectedFiles(markdown: string): number | undefined {
  const matches = markdown.match(/[\w./-]+\.[a-zA-Z]{1,5}\b/g);
  if (!matches) return undefined;
  const files = new Set(matches.filter((m) => m.includes('/') || m.includes('.')));
  return files.size > 0 ? files.size : undefined;
}

/** Coarse risk estimate from the number of checklist tasks. */
function estimateRisk(taskCount?: number): PlanMeta['risk'] {
  if (!taskCount) return undefined;
  if (taskCount <= 3) return 'low';
  if (taskCount <= 8) return 'medium';
  return 'high';
}

/**
 * Extract plain text from a tool_result block's `content`, which the SDK delivers
 * either as a string or as an array of `{ type: 'text', text }` parts.
 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const part = b as Record<string, unknown>;
        return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }
  return '';
}

/** True when `target` resolves to a path inside `root` (symlink-aware). */
function isInside(root: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const abs = path.isAbsolute(target) ? target : path.resolve(realRoot, target);
    // Resolve symlinks where possible; fall back to the lexical path otherwise.
    let resolved = abs;
    try {
      resolved = fs.realpathSync(abs);
    } catch {
      resolved = path.resolve(abs);
    }
    const rel = path.relative(realRoot, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || p;
}

function summarizeTool(name: string, input: Record<string, unknown>, risk: ToolRisk): string {
  const file = filePathOf(input);
  switch (name) {
    case 'Read':
      return `Read ${file ? shortPath(file) : 'a file'}`;
    case 'Write':
      return `Create ${file ? shortPath(file) : 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${file ? shortPath(file) : 'a file'}`;
    case 'Bash':
      return `Run ${truncate(String(input.command ?? 'a command'), 60)}`;
    case 'Grep':
      return `Search "${truncate(String(input.pattern ?? ''), 40)}"`;
    case 'Glob':
      return `Find ${truncate(String(input.pattern ?? ''), 40)}`;
    case 'WebSearch':
      return `Web search: ${truncate(String(input.query ?? ''), 40)}`;
    case 'WebFetch':
      return `Fetch ${truncate(String(input.url ?? ''), 40)}`;
    default:
      return risk === 'command' ? `Run ${name}` : name;
  }
}

/** The inline "target" shown in chat for a tool — a URL, query, or path. */
function toolTarget(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'WebSearch') return truncate(String(input.query ?? ''), 120) || undefined;
  if (name === 'WebFetch') return truncate(String(input.url ?? ''), 160) || undefined;
  if (name === 'Bash') return truncate(String(input.command ?? ''), 120) || undefined;
  if (name === 'Grep') return truncate(String(input.pattern ?? ''), 80) || undefined;
  const file = filePathOf(input);
  return file ? shortPath(file) : undefined;
}

function permissionDetail(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'Bash') return String(input.command ?? '');
  if (name === 'Edit') {
    const oldS = String(input.old_string ?? '');
    const newS = String(input.new_string ?? '');
    return `- ${truncate(oldS, 200)}\n+ ${truncate(newS, 200)}`;
  }
  if (name === 'Write') return truncate(String(input.content ?? ''), 400);
  const file = filePathOf(input);
  return file;
}

function changeFromInput(name: string, input: Record<string, unknown>): FileChange | null {
  const file = filePathOf(input);
  if (!file) return null;
  if (name === 'Write') {
    const content = String(input.content ?? '');
    return { path: file, status: 'modified', adds: countLines(content), dels: 0 };
  }
  if (name === 'Edit') {
    return {
      path: file,
      status: 'modified',
      adds: countLines(String(input.new_string ?? '')),
      dels: countLines(String(input.old_string ?? '')),
    };
  }
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
    let adds = 0;
    let dels = 0;
    for (const e of edits) {
      adds += countLines(String(e.new_string ?? ''));
      dels += countLines(String(e.old_string ?? ''));
    }
    return { path: file, status: 'modified', adds, dels };
  }
  return { path: file, status: 'modified', adds: 0, dels: 0 };
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split('\n').length;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
