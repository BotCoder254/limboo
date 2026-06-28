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
  AgentEvent,
  AgentInstall,
  AgentSessionSnapshot,
  AgentState,
  AgentToolCall,
  ChatMessage,
  FileChange,
  PermissionDecision,
  PermissionRequest,
  TaskItem,
  ToolRisk,
} from '@shared/types';
import { IpcEvents } from '@shared/ipc-channels';
import { getDb } from '../db/database';
import { logger } from '../logger';
import type { SettingsManager } from './SettingsManager';
import type { WorkspaceManager } from './WorkspaceManager';
import type { NotificationManager } from './NotificationManager';

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
    .replace(/(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=\S+/gi, '$1=***');
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
}

export class AgentManager {
  private state: AgentState = {
    status: 'unknown',
    install: { installed: false },
    activeSessionId: null,
  };

  private installChecked = false;
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

  /* ---------------------------------------------------------------- */
  /* Public API (reached via IPC)                                     */
  /* ---------------------------------------------------------------- */

  getState(): AgentState {
    return this.state;
  }

  /**
   * Detect whether Claude Code is usable. The SDK bundles the runtime, so this
   * really checks for available authentication — Claude Code owns auth and we
   * never read the secret itself, only whether one is configured.
   */
  getInstall(): AgentInstall {
    if (this.installChecked) return this.state.install;
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

    this.setState({
      install,
      status: install.installed ? (this.state.status === 'unknown' ? 'idle' : this.state.status) : 'not-installed',
    });
    return install;
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
    };
  }

  /** Resolve a pending permission prompt from the renderer. */
  respondPermission(decision: PermissionDecision): void {
    const entry = this.pending.get(decision.id);
    if (!entry) return;
    this.pending.delete(decision.id);

    if (decision.behavior === 'allow') {
      if (decision.remember) this.remembered.add(`${entry.sessionId}:remember`);
      entry.resolve({ behavior: 'allow' });
    } else {
      entry.resolve({
        behavior: 'deny',
        message: decision.message || 'Denied by the user.',
      });
    }

    // Drop back to streaming if there are no other prompts outstanding.
    if (this.pending.size === 0 && this.runs.has(entry.sessionId)) {
      this.setState({ status: 'streaming' });
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
    this.setState({ status: 'idle', activeSessionId: null });
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
  }

  /** Abort every active run. Called on quit. */
  cleanup(): void {
    for (const sessionId of [...this.runs.keys()]) this.stop(sessionId);
  }

  /**
   * Run a prompt for a session. Streams the agent's work as structured events.
   */
  async send(sessionId: string, prompt: string): Promise<void> {
    if (this.runs.has(sessionId)) {
      throw new Error('The agent is already working on this session.');
    }
    const install = this.getInstall();
    if (!install.installed) {
      throw new Error(install.error ?? 'Claude Code is not available.');
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
    this.pushActivity(sessionId, 'prompt', 'You', prompt.slice(0, 120), 'info');

    const cwd = ws.path;
    const agent = this.settings.getAll().agent;
    const abort = new AbortController();
    this.runs.set(sessionId, { abort, query: null });
    this.setState({ status: 'connecting', activeSessionId: sessionId, error: undefined });

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
      streaming = null;
    };

    try {
      const { query } = await loadSdk();
      const options = this.buildOptions(sessionId, cwd, abort, agent);
      const q = query({ prompt, options }) as unknown as AsyncIterable<SDKMessage> & {
        close?: () => void;
      };
      const run = this.runs.get(sessionId);
      if (run) run.query = q;
      this.setState({ status: 'streaming' });

      for await (const msg of q) {
        if (abort.signal.aborted) break;
        this.handleMessage(sessionId, msg, ensureStreaming, finishStreaming);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Agent run failed', redact(message));
        this.pushEvent({ kind: 'error', sessionId, message });
        this.pushActivity(sessionId, 'error', 'Agent error', message.slice(0, 160), 'danger');
        this.setState({ status: 'error', error: message });
      }
    } finally {
      finishStreaming();
      this.runs.delete(sessionId);
      if (this.state.status !== 'error') this.setState({ status: 'idle', activeSessionId: null });
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
          const message = `Agent error: ${msg.error}`;
          this.pushEvent({ kind: 'error', sessionId, message });
          this.pushActivity(sessionId, 'error', 'Agent error', String(msg.error), 'danger');
          break;
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
            this.onToolResult(sessionId, id, status);
          }
        }
        break;
      }

      case 'result': {
        finishStreaming();
        const ok = msg.subtype === 'success';
        const resultText = 'result' in msg && typeof msg.result === 'string' ? msg.result : '';
        this.pushEvent({ kind: 'result', sessionId, ok, text: resultText });
        this.pushActivity(
          sessionId,
          'result',
          ok ? 'Completed' : 'Ended with errors',
          ok ? undefined : resultText.slice(0, 160),
          ok ? 'success' : 'danger',
        );
        if (this.settings.getAll().behavior.notifications) {
          this.notifications.notify({
            title: ok ? 'Agent finished' : 'Agent stopped',
            body: ok ? 'Claude Code completed the task.' : 'The run ended with errors.',
          });
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
    const risk = classifyTool(name);
    const call: AgentToolCall = {
      id,
      sessionId,
      name,
      risk,
      summary: summarizeTool(name, input, risk),
      status: 'running',
      startedAt: Date.now(),
    };
    const rt = this.runtime(sessionId);
    rt.toolCalls = [...rt.toolCalls, call];
    this.pushEvent({ kind: 'tool-start', sessionId, call });
    this.pushActivity(sessionId, 'tool', call.summary, undefined, 'info');

    if (risk === 'write') {
      const change = changeFromInput(name, input);
      if (change) {
        rt.changes.set(change.path, change);
        this.pushEvent({ kind: 'file-change', sessionId, change });
        this.pushActivity(sessionId, 'file-change', `${change.status} ${shortPath(change.path)}`, undefined, 'info');
      }
    }
  }

  private onToolResult(sessionId: string, toolUseId: string, status: 'done' | 'error'): void {
    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    const call = rt.toolCalls.find((c) => c.id === toolUseId);
    if (!call) return;
    call.status = status;
    call.endedAt = Date.now();
    this.pushEvent({ kind: 'tool-end', sessionId, callId: toolUseId, status });
  }

  /* ---------------------------------------------------------------- */
  /* Permission bridge                                                */
  /* ---------------------------------------------------------------- */

  private buildOptions(
    sessionId: string,
    cwd: string,
    abort: AbortController,
    agent: ReturnType<SettingsManager['getAll']>['agent'],
  ): Options {
    const options: Options = {
      cwd,
      model: agent.model,
      permissionMode: 'default',
      canUseTool: this.makeCanUseTool(sessionId, cwd),
      maxTurns: agent.maxTurns,
      includePartialMessages: true,
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
      thinking: mapThinking(agent.thinking),
      stderr: (data: string) => logger.warn('[claude]', redact(data)),
    };
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

  private makeCanUseTool(sessionId: string, cwd: string) {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      { signal }: { signal: AbortSignal },
    ): Promise<PermissionResult> => {
      const risk = classifyTool(toolName);

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
      this.setState({ status: 'awaiting-permission' });
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
