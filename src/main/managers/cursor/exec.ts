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
  /**
   * `cmd` = Windows batch shim (needs the ComSpec bridge). `node` = the native
   * Windows install layout resolved past its shim: `path` is the bundled
   * `node.exe` and {@link entry} is the CLI's `index.js`, spawned argv-only
   * with the entry prepended — no shell, no ComSpec, runtime-safe.
   */
  kind: 'exe' | 'cmd' | 'node';
  /** kind `node` only: absolute path of the CLI entry script (index.js). */
  entry?: string;
  /** `cursor-agent --version` output captured during resolution, if any. */
  version?: string;
  /** How the executable was located (diagnostics only, renderer-visible). */
  source?: 'override' | 'path' | 'where' | 'install-dir';
}

/** The only argument shape allowed through the Windows ComSpec bridge. */
const SAFE_ARG_RE = /^[A-Za-z0-9=_.-]+$/;

/**
 * Version-directory names in the native Windows install layout
 * (`%LOCALAPPDATA%\cursor-agent\versions\<name>`). Mirrors the regex in
 * Cursor's own `cursor-agent.ps1` launcher: legacy `YYYY.MM.DD-<hash>` plus
 * the newer `YYYY.MM.DD-HH-MM-SS-<hash>` build-timestamp form. Anything that
 * fails this literal gate is never joined into a path.
 */
const VERSION_DIR_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

/** Strip Cursor credential material from captured CLI output. */
export function redactCursor(text: string): string {
  return text
    .replace(/crsr_[A-Za-z0-9_-]{8,}/g, 'crsr_***')
    .replace(/(CURSOR_API_KEY)\s*[:=]\s*\S+/gi, '$1=***');
}

let resolved: Promise<CursorExecutable | null> | null = null;

/** User-configured executable override (settings-driven, main-validated). */
let executableOverride = '';

/** Why the last override probe failed, for the auth state's error text. */
let execProblem: string | null = null;

/**
 * Apply the settings-driven executable-path override. Returns true when the
 * value changed (callers re-probe auth then). An empty string clears the
 * override and restores the default PATH/install-dir probe.
 */
export function configureCursorExec(opts: { executablePath: string }): boolean {
  const next = (opts.executablePath ?? '').trim().slice(0, CURSOR_LIMITS.execPathMax);
  if (next === executableOverride) return false;
  executableOverride = next;
  execProblem = null;
  resolved = null; // invalidate the memo; next resolve re-probes
  helpText = null;
  return true;
}

/** Human-readable reason the configured override failed, if any. */
export function getCursorExecProblem(): string | null {
  return execProblem;
}

/**
 * Locate the `cursor-agent` CLI. Memoized; pass `force` to re-probe (e.g. the
 * user just installed it and hit Refresh). Resolution order:
 *  0. The settings override, when set — fail-closed: an invalid override never
 *     falls back to PATH (a user pinning a path must not silently run some
 *     other binary).
 *  1. Plain `cursor-agent --version` — PATH lookup by the OS itself.
 *  2. win32: `where.exe cursor-agent` to find `.exe` (preferred) or `.cmd`
 *     shims — a shim's directory is first upgraded to the direct
 *     node.exe+index.js layout; then the native installer's literal
 *     `%LOCALAPPDATA%\cursor-agent` layout (the installer edits the REGISTRY
 *     user PATH, which a running GUI process never sees).
 *  3. Direct probe of `~/.local/bin/cursor-agent` then `~/.local/bin/agent`
 *     (GUI-launched Electron apps often miss the shell PATH that contains the
 *     documented install dir; newer docs name the binary plain `agent`).
 */
export function resolveCursorExecutable(force = false): Promise<CursorExecutable | null> {
  if (!resolved || force) {
    resolved = probeExecutable();
    helpText = null; // a new binary may support different flags
  }
  return resolved;
}

/** Memoized `cursor-agent --help` capture (flag-capability probes). */
let helpText: Promise<string> | null = null;

/**
 * Whether the resolved CLI documents `--approve-mcps` (auto-approve all
 * configured MCP servers in non-interactive runs). The flag appears in the
 * design research but not every CLI version — probe before passing it, and
 * degrade to not passing it (MCP is an enhancement, never a run blocker).
 */
export async function supportsApproveMcps(): Promise<boolean> {
  if (!helpText) {
    helpText = runCursorAgent(['--help'], { timeout: CURSOR_LIMITS.versionTimeoutMs }).then(
      (r) => (r.ok ? r.stdout : ''),
      () => '',
    );
  }
  return (await helpText).includes('--approve-mcps');
}

async function probeExecutable(): Promise<CursorExecutable | null> {
  execProblem = null;

  // 0. Explicit override — the ONLY candidate when configured (fail-closed:
  //    an invalid override never falls back to PATH). Accepts a real
  //    executable, a `.cmd`/`.bat`/`.ps1` shim, or the install DIRECTORY —
  //    shim/dir forms are upgraded to the direct node.exe+index.js layout
  //    when present, so the runtime (which refuses shims) works too.
  if (executableOverride) {
    const p = executableOverride;
    if (!path.isAbsolute(p)) {
      execProblem = 'Configured cursor-agent path must be absolute.';
      return null;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      execProblem = 'Configured cursor-agent path does not exist.';
      return null;
    }
    if (stat.isDirectory()) {
      const viaDir = await tryNodeLayout(p, 'override');
      if (!viaDir) {
        execProblem =
          'Configured cursor-agent directory has no node.exe + index.js layout (expected the native install dir, e.g. %LOCALAPPDATA%\\cursor-agent).';
        return null;
      }
      return viaDir;
    }
    if (!stat.isFile()) {
      execProblem = 'Configured cursor-agent path is not a file.';
      return null;
    }
    if (/\.(cmd|bat|ps1)$/i.test(p)) {
      // A shim: prefer resolving its directory to the direct node layout.
      const viaLayout = await tryNodeLayout(path.dirname(p), 'override');
      if (viaLayout) return viaLayout;
      if (/\.ps1$/i.test(p)) {
        execProblem =
          'Configured path is a PowerShell shim and its directory has no node.exe + index.js layout Limboo can run directly.';
        return null;
      }
      const viaShim = await tryVersion({ path: p, kind: 'cmd', source: 'override' });
      if (!viaShim) {
        execProblem = 'Configured cursor-agent path did not answer `--version`.';
        return null;
      }
      return viaShim;
    }
    const probed = await tryVersion({ path: p, kind: 'exe', source: 'override' });
    if (!probed) {
      execProblem = 'Configured cursor-agent path did not answer `--version`.';
      return null;
    }
    return probed;
  }

  // 1. Let the OS PATH search do the work.
  const direct = await tryVersion({ path: 'cursor-agent', kind: 'exe', source: 'path' });
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
      const viaExe = await tryVersion({ path: exe, kind: 'exe', source: 'where' });
      if (viaExe) return viaExe;
    }
    const shim = hits.find((h) => /\.(cmd|bat)$/i.test(h));
    if (shim) {
      // The official shim wraps node.exe + index.js — resolve past it so the
      // runtime (which refuses shims) can run; keep the shim as a fallback.
      const viaLayout = await tryNodeLayout(path.dirname(shim), 'where');
      if (viaLayout) return viaLayout;
      const viaShim = await tryVersion({ path: shim, kind: 'cmd', source: 'where' });
      if (viaShim) return viaShim;
    }

    // 2c. The native Windows installer's literal location. The installer adds
    //     it to the REGISTRY user PATH, which an already-running (GUI-launched)
    //     Electron process never sees — probing the directory directly rescues
    //     that stale-PATH case without touching the environment.
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const viaNative = await tryNodeLayout(
      path.join(localAppData, 'cursor-agent'),
      'install-dir',
    );
    if (viaNative) return viaNative;
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
      const viaProbe = await tryVersion({ path: candidate, kind: 'exe', source: 'install-dir' });
      if (viaProbe) return viaProbe;
    }
  }
  return null;
}

/**
 * Resolve the native Windows install layout under `baseDir` to a directly
 * spawnable node.exe + index.js pair, mirroring the official `cursor-agent.ps1`
 * launcher: a flat `node.exe`/`index.js` first, else the newest
 * `versions/<YYYY.MM.DD[-HH-MM-SS]-<hash>>` directory. Hardening: version-dir
 * names must pass {@link VERSION_DIR_RE} before being joined into a path, both
 * files must be regular files, and their realpaths must stay under the
 * realpath of `baseDir` (symlink-escape guard).
 */
function resolveNodeLayout(baseDir: string): { node: string; entry: string } | null {
  try {
    const base = fs.realpathSync(baseDir);
    const contained = (p: string): string | null => {
      const real = fs.realpathSync(p);
      return real === base || real.startsWith(base + path.sep) ? real : null;
    };
    const pairAt = (dir: string): { node: string; entry: string } | null => {
      const node = path.join(dir, 'node.exe');
      const entry = path.join(dir, 'index.js');
      if (!fs.existsSync(node) || !fs.existsSync(entry)) return null;
      if (!fs.statSync(node).isFile() || !fs.statSync(entry).isFile()) return null;
      const realNode = contained(node);
      const realEntry = contained(entry);
      return realNode && realEntry ? { node: realNode, entry: realEntry } : null;
    };

    const flat = pairAt(base);
    if (flat) return flat;

    const versionsDir = path.join(base, 'versions');
    if (!fs.existsSync(versionsDir)) return null;
    const names = fs
      .readdirSync(versionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && VERSION_DIR_RE.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => versionKey(b) - versionKey(a) || b.localeCompare(a));
    for (const name of names) {
      const pair = pairAt(path.join(versionsDir, name));
      if (pair) return pair;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * `YYYY.MM.DD…` → numeric YYYYMMDD for newest-first ordering (0 on junk).
 * Callers filter through {@link VERSION_DIR_RE} first, but this must never
 * assume it: a malformed name (fewer than 3 dot parts → undefined.padStart
 * TypeError) would be swallowed by resolveNodeLayout's catch and silently
 * abort the whole layout resolution. Junk sorts to 0 instead of throwing.
 */
function versionKey(name: string): number {
  const parts = name.split('-')[0]?.split('.') ?? [];
  if (parts.length < 3) return 0;
  const [y, m, d] = parts;
  const key = Number(`${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`);
  return Number.isFinite(key) ? key : 0;
}

/** Probe `baseDir` for the node layout and confirm it answers `--version`. */
async function tryNodeLayout(
  baseDir: string,
  source: CursorExecutable['source'],
): Promise<CursorExecutable | null> {
  const layout = resolveNodeLayout(baseDir);
  if (!layout) return null;
  return tryVersion({ path: layout.node, kind: 'node', entry: layout.entry, source });
}

async function tryVersion(
  candidate: Pick<CursorExecutable, 'path' | 'kind' | 'entry' | 'source'>,
): Promise<CursorExecutable | null> {
  const exe: CursorExecutable = { ...candidate };
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

/**
 * Env overlay for direct node.exe launches: the official shim enables the
 * Node compile cache for faster CLI startup — match it (never overriding an
 * ambient value).
 */
function nodeLaunchEnv(exe: CursorExecutable): NodeJS.ProcessEnv {
  if (exe.kind !== 'node' || process.env.NODE_COMPILE_CACHE) return {};
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return { NODE_COMPILE_CACHE: path.join(localAppData, 'cursor-compile-cache') };
}

function execCursor(
  exe: CursorExecutable,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CursorResult> {
  let file = exe.path;
  let argv = args;
  let verbatim = false;
  if (exe.kind === 'node') {
    argv = [exe.entry as string, ...args];
  } else if (exe.kind === 'cmd') {
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
        env: { ...process.env, ...nodeLaunchEnv(exe), ...opts.env },
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
  if (exe.kind === 'node') {
    argv = [exe.entry as string, ...argv];
  } else if (exe.kind === 'cmd') {
    const bridged = comspecBridge(exe.path, argv);
    if (!bridged) return null;
    ({ file, argv } = bridged);
    verbatim = true;
  }
  return spawn(file, argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    env: { ...process.env, ...nodeLaunchEnv(exe), ...env },
  });
}

/**
 * Thrown when a runtime run resolves only a Windows batch shim. Print-mode
 * argv carries workspace paths and model ids that can never pass the ComSpec
 * whitelist, so the runtime refuses shims outright instead of widening
 * {@link SAFE_ARG_RE}.
 */
export class CursorShimError extends Error {
  constructor() {
    super(
      'cursor-agent resolved to a .cmd shim, which Limboo cannot run safely. ' +
        'Hit Refresh in Settings › Agent (Limboo resolves the native install layout ' +
        'under %LOCALAPPDATA%\\cursor-agent directly), or point the Executable path ' +
        'setting at the install directory, then retry.',
    );
    this.name = 'CursorShimError';
  }
}

/**
 * Spawn a long-lived `cursor-agent` run (print mode) with streaming pipes.
 * Unlike {@link runCursorAgent} this never buffers: stdout is consumed as an
 * NDJSON stream by the caller and stdin stays writable so the prompt rides it
 * (never argv — prompts would leak to OS process listings and hit argv length
 * limits). Secrets ride only in `opts.env`. Throws (never resolves null) so
 * the failure text reaches the run's error classifier.
 */
export async function spawnCursorRun(
  argv: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<ChildProcess> {
  const exe = await resolveCursorExecutable();
  if (!exe) {
    throw new Error(
      'cursor-agent not found. Install the Cursor CLI (https://cursor.com/cli), then retry.',
    );
  }
  if (exe.kind === 'cmd') throw new CursorShimError();
  return spawn(exe.path, exe.kind === 'node' ? [exe.entry as string, ...argv] : argv, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...nodeLaunchEnv(exe), ...opts.env },
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
