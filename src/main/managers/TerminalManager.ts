/**
 * Terminal Manager — owns every PTY-backed shell the app or the coding agent
 * spawns (CLAUDE.md §8 Terminal Engine). Lives in the main process; the renderer
 * and agent reach it only via IPC.
 *
 * Each terminal is a managed resource keyed by id and grouped by workspace: it
 * tracks the working directory, shell, lifecycle state, a bounded scrollback ring
 * (for replay on rehydrate), and the underlying `node-pty` process. Pinned to the
 * `1.2.0-beta` line, which rewrote the native addon on Node-API (`node-addon-api`)
 * instead of NAN: the compiled binary is ABI-stable across Node.js *and* Electron
 * major versions, so the bundled per-platform prebuilt never needs a `node-gyp`
 * rebuild for a new Electron release (unlike `node-pty@1.1.0` or any of its
 * NAN-based prebuilt forks, which still rebuild — and need Visual Studio Build
 * Tools on Windows — whenever the host Electron ABI has no matching prebuilt).
 * Output is streamed to every window as `terminal:data` events; lifecycle changes
 * broadcast `terminal:updated` / `terminal:exit`.
 *
 * Security (CLAUDE.md §6): PTYs are spawned argv-style (the shell binary is
 * exec'd directly — never `shell: true`), the `cwd` is pinned to and validated
 * inside the workspace root before spawning, the environment is sanitized, and no
 * PTY output or command text is ever written to the logger (audit lines are
 * redacted). Bounds (max terminals/workspace, scrollback ring, write byte cap)
 * keep a runaway shell from exhausting memory or the main process.
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { IpcEvents } from '@shared/ipc-channels';
import { TERMINAL_LIMITS, clamp } from '@shared/constants';
import type {
  TerminalChunk,
  TerminalCommandRecord,
  TerminalCreateOptions,
  TerminalExit,
  TerminalSession,
  Workspace,
} from '@shared/types';
import { logger } from '../logger';
import type { WorkspaceManager } from './WorkspaceManager';
import type { SettingsManager } from './SettingsManager';

/** A live terminal: its public metadata, the PTY handle, and a scrollback ring. */
interface ManagedTerminal {
  meta: TerminalSession;
  proc: IPty;
  /** Bounded ring of recent output chunks, replayed when a view (re)attaches. */
  scrollback: string[];
  scrollbackBytes: number;
}

/** Strip token-like secrets before an audit line reaches the logger. */
function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=\S+/gi, '$1=***')
    .replace(/(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._-]{10,}/gi, '$1 ***');
}

/** Approx scrollback cap in bytes (lines × a generous per-line estimate). */
const SCROLLBACK_BYTES_MAX = TERMINAL_LIMITS.scrollbackLines * 256;

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private seq = 0;
  /**
   * Resolves a session's effective execution root (its worktree when it owns
   * one, else the workspace path). Injected by the composition root to avoid a
   * hard dependency on the WorktreeManager.
   */
  private sessionRootResolver: ((sessionId: string) => string | null) | null = null;

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly settings: SettingsManager,
  ) {}

  /** Inject the session→root resolver (worktree-backed sessions). */
  setSessionRootResolver(resolve: (sessionId: string) => string | null): void {
    this.sessionRootResolver = resolve;
  }

  /* ----------------------------------------------------------- queries */

  /** Public metadata for every terminal in a workspace (creation order). */
  list(workspaceId: string): TerminalSession[] {
    return [...this.terminals.values()]
      .filter((t) => t.meta.workspaceId === workspaceId)
      .map((t) => t.meta);
  }

  /** Recent buffered output for a terminal, replayed when a view attaches. */
  scrollback(terminalId: string): string {
    return this.terminals.get(terminalId)?.scrollback.join('') ?? '';
  }

  /* ----------------------------------------------------------- lifecycle */

  /**
   * Spawn a new PTY for a workspace. The shell is resolved from the workspace
   * config, then the global terminal setting, then the OS default. The `cwd` is
   * the workspace root, validated to be a real directory inside that root.
   */
  create(workspaceId: string, opts: TerminalCreateOptions = {}): TerminalSession {
    const ws = this.requireWorkspace(workspaceId);

    const existing = this.list(workspaceId).filter((t) => t.status === 'running').length;
    if (existing >= TERMINAL_LIMITS.maxPerWorkspace) {
      throw new Error(`Terminal limit reached (${TERMINAL_LIMITS.maxPerWorkspace}) for this workspace`);
    }

    const cwd = this.resolveCwd(ws, opts.sessionId);
    const shell = this.resolveShell(ws);
    const cols = clamp(opts.cols ?? TERMINAL_LIMITS.cols.default, TERMINAL_LIMITS.cols.min, TERMINAL_LIMITS.cols.max);
    const rows = clamp(opts.rows ?? TERMINAL_LIMITS.rows.default, TERMINAL_LIMITS.rows.min, TERMINAL_LIMITS.rows.max);

    const id = `term_${Date.now().toString(36)}_${(this.seq++).toString(36)}`;
    const title = (opts.title ?? `Terminal ${this.list(workspaceId).length + 1}`).slice(
      0,
      TERMINAL_LIMITS.titleMax,
    );

    // Argv-style spawn — never `shell: true`. node-pty execs the shell binary
    // directly with a login/interactive arg; no string is passed through a shell.
    const proc = pty.spawn(shell, this.shellArgs(shell), {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: this.sanitizedEnv(),
    });

    const meta: TerminalSession = {
      id,
      workspaceId,
      title,
      cwd,
      shell,
      status: 'running',
      origin: opts.origin ?? 'user',
      sessionId: opts.sessionId,
      createdAt: Date.now(),
    };

    const managed: ManagedTerminal = { meta, proc, scrollback: [], scrollbackBytes: 0 };
    this.terminals.set(id, managed);

    proc.onData((data) => {
      this.recordScrollback(managed, data);
      this.broadcast<TerminalChunk>(IpcEvents.terminalData, { terminalId: id, data });
    });
    proc.onExit(({ exitCode, signal }) => {
      meta.status = signal && signal !== 0 ? 'crashed' : 'exited';
      meta.exitCode = exitCode;
      this.broadcast<TerminalExit>(IpcEvents.terminalExit, { terminalId: id, exitCode, signal });
      this.broadcastUpdated(workspaceId);
    });

    logger.info(`Terminal opened: ${redact(title)} (${shell}) in workspace ${workspaceId}`);
    this.broadcastUpdated(workspaceId);
    return meta;
  }

  /** Feed user keystrokes / paste into a terminal (byte-capped). */
  write(terminalId: string, data: string): void {
    const t = this.terminals.get(terminalId);
    if (!t || t.meta.status !== 'running') return;
    if (typeof data !== 'string') return;
    // Cap the write so a hostile renderer can't shove an unbounded buffer through.
    const capped = data.length > TERMINAL_LIMITS.writeBytesMax
      ? data.slice(0, TERMINAL_LIMITS.writeBytesMax)
      : data;
    t.proc.write(capped);
  }

  /** Resize a terminal's PTY grid. */
  resize(terminalId: string, cols: number, rows: number): void {
    const t = this.terminals.get(terminalId);
    if (!t || t.meta.status !== 'running') return;
    const c = clamp(Math.floor(cols), TERMINAL_LIMITS.cols.min, TERMINAL_LIMITS.cols.max);
    const r = clamp(Math.floor(rows), TERMINAL_LIMITS.rows.min, TERMINAL_LIMITS.rows.max);
    try {
      t.proc.resize(c, r);
    } catch {
      // node-pty throws if the process already exited — harmless.
    }
  }

  /** Rename a terminal's user-facing label. */
  rename(terminalId: string, title: string): TerminalSession | null {
    const t = this.terminals.get(terminalId);
    if (!t) return null;
    t.meta.title = String(title).slice(0, TERMINAL_LIMITS.titleMax);
    this.broadcastUpdated(t.meta.workspaceId);
    return t.meta;
  }

  /** Kill a terminal and drop it from the registry. */
  kill(terminalId: string): void {
    const t = this.terminals.get(terminalId);
    if (!t) return;
    const wsId = t.meta.workspaceId;
    this.killProc(t);
    this.terminals.delete(terminalId);
    this.broadcastUpdated(wsId);
  }

  /** Clear a terminal's buffered scrollback ring (the view clears its own grid). */
  clear(terminalId: string): void {
    const t = this.terminals.get(terminalId);
    if (!t) return;
    t.scrollback = [];
    t.scrollbackBytes = 0;
  }

  /** Kill every terminal belonging to a workspace (e.g. workspace removed). */
  disposeWorkspace(workspaceId: string): void {
    for (const [id, t] of this.terminals) {
      if (t.meta.workspaceId === workspaceId) {
        this.killProc(t);
        this.terminals.delete(id);
      }
    }
    this.broadcastUpdated(workspaceId);
  }

  /**
   * Kill every terminal owned by a session (worktree teardown / delete). PTYs
   * holding a cwd inside a worktree keep `git worktree remove` failing with
   * EBUSY on Windows, so this runs before any directory removal.
   */
  disposeSession(sessionId: string): void {
    let workspaceId: string | null = null;
    for (const [id, t] of this.terminals) {
      if (t.meta.sessionId === sessionId) {
        workspaceId = t.meta.workspaceId;
        this.killProc(t);
        this.terminals.delete(id);
      }
    }
    if (workspaceId) this.broadcastUpdated(workspaceId);
  }

  /** Number of live terminals owned by a session (delete dependency summary). */
  countForSession(sessionId: string): number {
    let n = 0;
    for (const t of this.terminals.values()) {
      if (t.meta.sessionId === sessionId && t.meta.status === 'running') n += 1;
    }
    return n;
  }

  /** Kill every PTY on shutdown — no orphaned shells. */
  dispose(): void {
    for (const t of this.terminals.values()) this.killProc(t);
    this.terminals.clear();
  }

  /* ------------------------------------------------- agent mirroring */

  /**
   * Ensure a workspace terminal exists for mirroring agent commands. Reuses the
   * most recent running agent-origin terminal, else creates one. Returns its id,
   * or null when no workspace can be resolved.
   */
  ensureAgentTerminal(workspaceId: string, sessionId?: string): string | null {
    if (!this.workspace.getById(workspaceId)) return null;
    const running = this.list(workspaceId).filter((t) => t.status === 'running');
    // A worktree-backed session's mirror terminal must live in ITS cwd — match
    // by owning session first, then fall back to any agent/first terminal only
    // for plain (non-worktree) sessions.
    const bySession = sessionId
      ? running.find((t) => t.origin === 'agent' && t.sessionId === sessionId)
      : undefined;
    const sessionRoot = sessionId ? this.sessionRootResolver?.(sessionId) ?? null : null;
    const wsPath = this.workspace.getById(workspaceId)?.path ?? null;
    const isWorktreeSession = !!sessionRoot && sessionRoot !== wsPath;
    const agentTerm =
      bySession ??
      (isWorktreeSession
        ? undefined
        : running.find((t) => t.origin === 'agent' && !t.sessionId) ?? running.find((t) => !t.sessionId));
    if (agentTerm) return agentTerm.id;
    try {
      return this.create(workspaceId, { title: 'Agent', origin: 'agent', sessionId }).id;
    } catch (err) {
      logger.warn('ensureAgentTerminal failed', err);
      return null;
    }
  }

  /** Broadcast a mirrored agent command record to the renderer. */
  mirrorAgentCommand(record: TerminalCommandRecord): void {
    this.broadcast<TerminalCommandRecord>(IpcEvents.terminalCommand, record);
  }

  /* --------------------------------------------- hook / service commands */

  /**
   * Spawn a PTY that runs ONE command to completion (worktree setup/teardown
   * hooks, named scripts, supervised services) with its output streamed like a
   * normal terminal. The command string is user/repo-authored configuration —
   * never composed by the renderer — and is passed as a single argv element to
   * the directly exec'd shell binary (never `shell: true`).
   */
  createForCommand(opts: {
    workspaceId: string;
    sessionId: string;
    cwd: string;
    command: string;
    title: string;
    origin: 'hook' | 'service';
    env?: Record<string, string>;
    onExit?: (exitCode: number) => void;
  }): TerminalSession {
    const ws = this.requireWorkspace(opts.workspaceId);
    if (!safeIsDir(opts.cwd)) throw new Error('Command cwd is not a directory');

    const existing = this.list(opts.workspaceId).filter((t) => t.status === 'running').length;
    if (existing >= TERMINAL_LIMITS.maxPerWorkspace) {
      throw new Error(`Terminal limit reached (${TERMINAL_LIMITS.maxPerWorkspace}) for this workspace`);
    }

    const shell = this.resolveShell(ws);
    const [bin, args] =
      process.platform === 'win32'
        ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', opts.command]]
        : [shell, ['-c', opts.command]];

    const id = `term_${Date.now().toString(36)}_${(this.seq++).toString(36)}`;
    const env = this.sanitizedEnv();
    for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;

    const proc = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cwd: opts.cwd,
      cols: TERMINAL_LIMITS.cols.default,
      rows: TERMINAL_LIMITS.rows.default,
      env,
    });

    const meta: TerminalSession = {
      id,
      workspaceId: opts.workspaceId,
      title: opts.title.slice(0, TERMINAL_LIMITS.titleMax),
      cwd: opts.cwd,
      shell: bin,
      status: 'running',
      origin: opts.origin,
      sessionId: opts.sessionId,
      createdAt: Date.now(),
    };
    const managed: ManagedTerminal = { meta, proc, scrollback: [], scrollbackBytes: 0 };
    this.terminals.set(id, managed);

    proc.onData((data) => {
      this.recordScrollback(managed, data);
      this.broadcast<TerminalChunk>(IpcEvents.terminalData, { terminalId: id, data });
    });
    proc.onExit(({ exitCode, signal }) => {
      meta.status = signal && signal !== 0 ? 'crashed' : 'exited';
      meta.exitCode = exitCode;
      this.broadcast<TerminalExit>(IpcEvents.terminalExit, { terminalId: id, exitCode, signal });
      this.broadcastUpdated(opts.workspaceId);
      try {
        opts.onExit?.(exitCode);
      } catch (err) {
        logger.warn('command terminal onExit callback failed', err);
      }
    });

    logger.info(`Command terminal opened: ${redact(meta.title)} (${opts.origin})`);
    this.broadcastUpdated(opts.workspaceId);
    return meta;
  }

  /* --------------------------------------------------------- internals */

  private killProc(t: ManagedTerminal): void {
    try {
      t.proc.kill();
    } catch {
      // Already dead — fine.
    }
  }

  private recordScrollback(t: ManagedTerminal, data: string): void {
    t.scrollback.push(data);
    t.scrollbackBytes += data.length;
    while (t.scrollbackBytes > SCROLLBACK_BYTES_MAX && t.scrollback.length > 1) {
      const dropped = t.scrollback.shift();
      t.scrollbackBytes -= dropped?.length ?? 0;
    }
  }

  private resolveCwd(ws: Workspace, sessionId?: string): string {
    // A session that owns a worktree spawns its terminals inside that worktree.
    // The worktree path comes from the main-side WorktreeManager (validated by
    // its containment guard at creation) — never from the renderer. If the
    // directory vanished, fall back to the workspace root with a warning.
    if (sessionId && this.sessionRootResolver) {
      const sessionRoot = this.sessionRootResolver(sessionId);
      if (sessionRoot && sessionRoot !== ws.path) {
        if (safeIsDir(sessionRoot)) {
          try {
            return fs.realpathSync(sessionRoot);
          } catch {
            return sessionRoot;
          }
        }
        logger.warn(`Session worktree missing — terminal falls back to workspace root`);
      }
    }
    // The PTY's working directory is otherwise the (real) workspace root, guarded
    // against symlink escapes — the same containment rule the agent/file layers use.
    const root = ws.path;
    let real = root;
    try {
      real = fs.realpathSync(root);
    } catch {
      real = root;
    }
    if (!isInside(root, real) || !safeIsDir(real)) {
      throw new Error('Workspace root is not a valid directory');
    }
    return real;
  }

  private resolveShell(ws: Workspace): string {
    const fromWorkspace = ws.config.preferredShell?.trim();
    const fromSettings = this.settings.getAll().agent.terminal.shell?.trim();
    const chosen = fromWorkspace || fromSettings || defaultShell();
    return chosen;
  }

  private shellArgs(shell: string): string[] {
    if (process.platform === 'win32') return [];
    // Interactive login-ish shell so rc files load; no command string is passed.
    const base = path.basename(shell);
    if (base === 'bash' || base === 'zsh' || base === 'sh') return ['-i'];
    return [];
  }

  /**
   * A sanitized environment for the PTY. Inherits the user's env (the agent and
   * git tooling expect PATH etc.) but stamps terminal-friendly markers. We never
   * log this object.
   */
  private sanitizedEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    // Signal to spawned tooling that it runs inside Limboo's integrated terminal.
    env.LIMBOO_TERMINAL = '1';
    return env;
  }

  private requireWorkspace(workspaceId: string): Workspace {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
    return ws;
  }

  private broadcastUpdated(workspaceId: string): void {
    this.broadcast<{ workspaceId: string; terminals: TerminalSession[] }>(
      IpcEvents.terminalsUpdated,
      { workspaceId, terminals: this.list(workspaceId) },
    );
  }

  private broadcast<T>(channel: string, payload: T): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Module helpers                                                      */
/* ------------------------------------------------------------------ */

/** True when `target` resolves to a path inside `root` (symlink-aware). */
function isInside(root: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const abs = path.isAbsolute(target) ? target : path.resolve(realRoot, target);
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

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The OS default shell when neither workspace nor settings override it. */
function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  if (process.platform === 'darwin') {
    return process.env.SHELL || '/bin/zsh';
  }
  return process.env.SHELL || '/bin/bash';
}
