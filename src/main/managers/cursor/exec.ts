/**
 * Safe `cursor-agent` CLI runner for the Cursor provider (authentication only).
 *
 * Security (CLAUDE.md §6): the CLI is always invoked via `execFile`/`spawn`
 * with an **argv array** — never `shell: true`. Secrets (CURSOR_API_KEY,
 * NO_OPEN_BROWSER) ride only in the child **environment**, never on argv
 * (argv leaks to OS process listings). Calls are bounded by a timeout and a
 * max output buffer, and all captured output must pass {@link redactCursor}
 * before it can reach a log line or renderer-visible state.
 *
 * Windows `.cmd`/`.bat` shims cannot be run by `execFile` without a shell, so
 * they are executed through `%ComSpec% /d /s /c "<shim>" <args…>` — and ONLY
 * when every argument matches {@link SAFE_ARG_RE}. All Phase-1 arguments are
 * static literals (`login`, `logout`, `status`, `--format`, `json`, …); this
 * module refuses anything else on the cmd path by design. Never route user
 * input through it.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CURSOR_LIMITS } from '@shared/constants';

export interface CursorResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface CursorExecutable {
  /** Command name or absolute path handed to execFile/spawn. */
  path: string;
  /** `cmd` = Windows batch shim (needs the ComSpec bridge). */
  kind: 'exe' | 'cmd';
  /** `cursor-agent --version` output captured during resolution, if any. */
  version?: string;
}

/** The only argument shape allowed through the Windows ComSpec bridge. */
const SAFE_ARG_RE = /^[A-Za-z0-9=_.-]+$/;

/** Strip Cursor credential material from captured CLI output. */
export function redactCursor(text: string): string {
  return text
    .replace(/crsr_[A-Za-z0-9_-]{8,}/g, 'crsr_***')
    .replace(/(CURSOR_API_KEY)\s*[:=]\s*\S+/gi, '$1=***');
}

let resolved: Promise<CursorExecutable | null> | null = null;

/**
 * Locate the `cursor-agent` CLI. Memoized; pass `force` to re-probe (e.g. the
 * user just installed it and hit Refresh). Resolution order:
 *  1. Plain `cursor-agent --version` — PATH lookup by the OS itself.
 *  2. win32: `where.exe cursor-agent` to find `.exe` (preferred) or `.cmd` shims.
 *  3. Direct probe of `~/.local/bin/cursor-agent` then `~/.local/bin/agent`
 *     (GUI-launched Electron apps often miss the shell PATH that contains the
 *     documented install dir; newer docs name the binary plain `agent`).
 */
export function resolveCursorExecutable(force = false): Promise<CursorExecutable | null> {
  if (!resolved || force) resolved = probeExecutable();
  return resolved;
}

async function probeExecutable(): Promise<CursorExecutable | null> {
  // 1. Let the OS PATH search do the work.
  const direct = await tryVersion('cursor-agent', 'exe');
  if (direct) return direct;

  // 2. Windows: PATH may only hold a batch shim, which execFile can't start.
  if (process.platform === 'win32') {
    const where = await new Promise<string>((res) => {
      execFile(
        'where.exe',
        ['cursor-agent'],
        { timeout: CURSOR_LIMITS.versionTimeoutMs, windowsHide: true },
        (err, stdout) => res(err ? '' : String(stdout)),
      );
    });
    const hits = where.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h));
    if (exe) {
      const viaExe = await tryVersion(exe, 'exe');
      if (viaExe) return viaExe;
    }
    const shim = hits.find((h) => /\.(cmd|bat)$/i.test(h));
    if (shim) {
      const viaShim = await tryVersion(shim, 'cmd');
      if (viaShim) return viaShim;
    }
  }

  // 3. The documented install location, for PATH-less GUI launches. Newer
  //    Cursor docs also ship the binary as plain `agent`; that name is only
  //    probed inside the documented install dir — never via a bare PATH
  //    search, where `agent` could collide with an unrelated executable.
  for (const candidate of [
    path.join(os.homedir(), '.local', 'bin', 'cursor-agent'),
    path.join(os.homedir(), '.local', 'bin', 'cursor-agent.exe'),
    path.join(os.homedir(), '.local', 'bin', 'agent'),
    path.join(os.homedir(), '.local', 'bin', 'agent.exe'),
  ]) {
    if (fs.existsSync(candidate)) {
      const viaProbe = await tryVersion(candidate, 'exe');
      if (viaProbe) return viaProbe;
    }
  }
  return null;
}

async function tryVersion(file: string, kind: 'exe' | 'cmd'): Promise<CursorExecutable | null> {
  const exe: CursorExecutable = { path: file, kind };
  const r = await execCursor(exe, ['--version'], { timeout: CURSOR_LIMITS.versionTimeoutMs });
  if (!r.ok) return null;
  const version = r.stdout.trim().split(/\r?\n/)[0]?.slice(0, 80);
  return { ...exe, version: version || undefined };
}

/**
 * Run one `cursor-agent` subcommand. Resolves even on non-zero exit (inspect
 * `.ok`) and never rejects — the runGit idiom. `opts.env` is overlaid on the
 * inherited environment (secrets go HERE, never in `args`).
 */
export async function runCursorAgent(
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CursorResult> {
  const exe = await resolveCursorExecutable();
  if (!exe) return { ok: false, stdout: '', stderr: 'cursor-agent not found', code: 127 };
  return execCursor(exe, args, opts);
}

function execCursor(
  exe: CursorExecutable,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CursorResult> {
  let file = exe.path;
  let argv = args;
  let verbatim = false;
  if (exe.kind === 'cmd') {
    const bridged = comspecBridge(exe.path, args);
    if (!bridged) {
      return Promise.resolve({ ok: false, stdout: '', stderr: 'cursor-agent: unsafe argument refused', code: 1 });
    }
    ({ file, argv } = bridged);
    verbatim = true;
  }
  return new Promise((resolve) => {
    execFile(
      file,
      argv,
      {
        timeout: opts.timeout ?? CURSOR_LIMITS.statusTimeoutMs,
        maxBuffer: CURSOR_LIMITS.outputMax,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        env: { ...process.env, ...opts.env },
      },
      (err, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : stdout?.toString() ?? '';
        const errOut = typeof stderr === 'string' ? stderr : stderr?.toString() ?? '';
        if (!err) {
          resolve({ ok: true, stdout: out, stderr: errOut, code: 0 });
          return;
        }
        const code = (err as { code?: number }).code;
        resolve({
          ok: false,
          stdout: out,
          stderr: errOut || err.message,
          code: typeof code === 'number' ? code : 1,
        });
      },
    );
  });
}

/**
 * Spawn the interactive `cursor-agent login` child (streaming stdout so manual
 * mode can capture the printed URL). Returns null when the CLI is unresolved
 * or a cmd-shim argument fails the whitelist.
 */
export async function spawnCursorLogin(env: NodeJS.ProcessEnv): Promise<ChildProcess | null> {
  const exe = await resolveCursorExecutable();
  if (!exe) return null;
  let file = exe.path;
  let argv: string[] = ['login'];
  let verbatim = false;
  if (exe.kind === 'cmd') {
    const bridged = comspecBridge(exe.path, argv);
    if (!bridged) return null;
    ({ file, argv } = bridged);
    verbatim = true;
  }
  return spawn(file, argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    env: { ...process.env, ...env },
  });
}

/**
 * Build the `%ComSpec% /d /s /c ""<shim>" <args…>"` argv for a batch shim.
 * Refuses (returns null) unless every argument is a static-literal token —
 * cmd.exe metacharacters can never reach this line.
 */
function comspecBridge(shimPath: string, args: string[]): { file: string; argv: string[] } | null {
  if (!args.every((a) => SAFE_ARG_RE.test(a))) return null;
  if (/["%^&|<>]/.test(shimPath)) return null;
  const file = process.env.ComSpec ?? 'cmd.exe';
  // With /s, cmd strips the outer quotes of the /c payload, leaving the quoted
  // shim path + whitelisted literal args. windowsVerbatimArguments keeps Node
  // from re-quoting the payload.
  const payload = `""${shimPath}" ${args.join(' ')}"`;
  return { file, argv: ['/d', '/s', '/c', payload] };
}
