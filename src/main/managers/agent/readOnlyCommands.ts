/**
 * Conservative read-only shell command classifier.
 *
 * `decideToolUse` treats `Bash` as command-risk, which categorically blocked
 * benign inspection commands (`git log`, `gh pr list`) in plan/ask runs and
 * forced an interactive prompt for them everywhere else. This module answers
 * one question — "can this command string mutate anything?" — with a
 * deny-by-default posture: unless every segment of the command is provably a
 * read-only invocation from the allowlist below, the answer is `false`.
 *
 * The classifier only ever RELAXES risk from `command` to `read`; it is
 * consulted AFTER the app-data guard (which string-matches the whole command
 * against userData/limboo.db), so a read of app internals stays blocked
 * regardless of what this module says.
 */

/** Whole-command rejects: substitution, expansion, redirection, background.
 *  `&&` is a permitted separator; a lone `&` (backgrounding) is not — hence
 *  the lookaround pair (a `&` not part of a `&&`). */
const UNSAFE_PATTERN = /[`<>]|\$\(|\$\{|\$[\w@#!?*-]|\|&|(?<!&)&(?!&)/;

/** Control characters (incl. newlines) — reject outright. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const MAX_COMMAND_LENGTH = 4096;

/** Commands that are read-only with any arguments (paths, flags, patterns). */
const BARE_SAFE = new Set([
  'ls', 'dir', 'pwd', 'cd', 'cat', 'type', 'head', 'tail', 'wc', 'file',
  'stat', 'du', 'df', 'echo', 'which', 'where', 'whoami', 'hostname',
  'date', 'grep', 'egrep', 'fgrep', 'diff', 'realpath', 'dirname',
  'basename', 'nl', 'uniq', 'cut', 'tr',
]);

/** Binaries allowed only for version/info flags. */
const VERSION_ONLY = new Set([
  'node', 'npm', 'npx', 'python', 'python3', 'pip', 'go', 'cargo', 'java',
  'ruby', 'dotnet', 'tsc',
]);
const VERSION_FLAGS = new Set(['-v', '-V', '--version', '--help', 'version']);

/** git subcommands that are read-only with any arguments. */
const GIT_SAFE = new Set([
  'status', 'log', 'show', 'diff', 'blame', 'shortlog', 'describe',
  'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file',
  'grep', 'cherry', 'count-objects', 'merge-base', 'name-rev', 'show-ref',
  'for-each-ref', 'check-ignore', 'whatchanged',
]);

/** `git branch` flags that keep it in listing territory. */
const GIT_BRANCH_LIST_FLAGS = new Set([
  '-a', '--all', '-r', '--remotes', '-v', '-vv', '--list', '--show-current',
  '--merged', '--no-merged', '--contains', '--points-at',
]);

/** gh subcommand groups whose read verbs are allowed. */
const GH_GROUPS = new Set([
  'pr', 'issue', 'run', 'release', 'repo', 'workflow', 'gist', 'search',
]);
const GH_READ_VERBS = new Set(['list', 'view', 'status', 'diff', 'checks']);

/**
 * Split a segment into tokens with minimal quote awareness. Returns null when
 * quoting is unbalanced (be conservative — reject what we cannot parse).
 */
function tokenize(segment: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Flags that turn an otherwise read-only git subcommand into a write or an
 * exec: `--output` writes a file (log/diff/show), `-O`/`--open-files-in-pager`
 * launches a program (grep), `--upload-pack`/`--receive-pack` run an arbitrary
 * command (ls-remote & friends).
 */
const GIT_UNSAFE_ARG = /^(-O|--output(=|$)|--open-files-in-pager(=|$)|--upload-pack(=|$)|--receive-pack(=|$))/;

function isReadOnlyGit(args: string[]): boolean {
  // Allow one leading `--no-pager` (common when driving git non-interactively).
  const rest = args[0] === '--no-pager' ? args.slice(1) : args;
  const sub = rest[0];
  if (!sub) return false;
  if (rest.some((t) => GIT_UNSAFE_ARG.test(t))) return false;
  const tail = rest.slice(1);
  if (GIT_SAFE.has(sub)) return true;
  switch (sub) {
    case 'remote':
      return tail.length === 0 || tail[0] === '-v' || tail[0] === 'show' || tail[0] === 'get-url';
    case 'branch':
      // Bare or flags-only listing; a bare name argument creates a branch.
      return tail.every(
        (t) =>
          GIT_BRANCH_LIST_FLAGS.has(t) || t.startsWith('--sort=') || t.startsWith('--format='),
      );
    case 'tag':
      return tail.length === 0 || tail.every((t) => t === '-l' || t === '--list' || t.startsWith('-n'));
    case 'stash':
      return tail[0] === 'list' || tail[0] === 'show';
    case 'config':
      return ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(tail[0] ?? '');
    case 'reflog':
      return tail.length === 0 || tail[0] === 'show';
    case 'worktree':
      return tail[0] === 'list';
    default:
      return false;
  }
}

function isReadOnlyGh(args: string[]): boolean {
  const [group, verb] = args;
  if (!group) return false;
  // `--web`/`-w` opens a browser — not a read.
  if (args.some((a) => a === '--web' || a === '-w')) return false;
  if (group === '--version' || group === 'status') return true;
  if (group === 'auth') return verb === 'status';
  // `gh api` can POST — deliberately absent.
  return GH_GROUPS.has(group) && GH_READ_VERBS.has(verb ?? '');
}

/**
 * True when a token could address a file OUTSIDE the workspace: absolute paths
 * (drive letter, leading slash/backslash, `~`) — bare or after an `=` — and any
 * `..` traversal. Bash args never reach the workspace path guard (only
 * `file_path` inputs do), so the classifier itself must refuse them; otherwise
 * `cat C:\...\.ssh\id_rsa` would auto-run as a "read" in plan/ask mode.
 */
function escapesWorkspace(token: string): boolean {
  // A `..` PATH SEGMENT is traversal; `HEAD..main` (a git range) is not.
  if (/(?:^|[\\/])\.\.(?:$|[\\/])/.test(token)) return true;
  return /(?:^|=)(?:[A-Za-z]:[\\/]|[\\/~])/.test(token);
}

function isReadOnlySegment(segment: string): boolean {
  const tokens = tokenize(segment.trim());
  if (!tokens || tokens.length === 0) return false;
  const [cmd, ...args] = tokens;
  // A path-y or assignment-shaped head is not a plain allowlisted binary.
  if (/[\\/=]/.test(cmd)) return false;
  // Workspace-relative arguments only — see escapesWorkspace.
  if (args.some(escapesWorkspace)) return false;
  const lower = cmd.toLowerCase();

  if (BARE_SAFE.has(lower)) return true;
  // `-ofile` (attached form) writes `file` — prefix-match, not equality.
  if (lower === 'sort') return !args.some((a) => a.startsWith('-o') || a.startsWith('--output'));
  // rg `--pre`/`--hostname-bin` execute an arbitrary program.
  if (lower === 'rg') return !args.some((a) => a.startsWith('--pre') || a.startsWith('--hostname-bin'));
  // tree `-o` writes an output file.
  if (lower === 'tree') return !args.some((a) => a.startsWith('-o'));
  if (lower === 'find') {
    return !args.some((a) => a === '-delete' || /^-(exec|ok|fprint|fls)/.test(a));
  }
  if (lower === 'git') return isReadOnlyGit(args);
  if (lower === 'gh') return isReadOnlyGh(args);
  if (VERSION_ONLY.has(lower)) {
    if (args.length > 0 && args.every((a) => VERSION_FLAGS.has(a))) return true;
    if (lower === 'npm') return ['ls', 'list', 'outdated'].includes(args[0] ?? '');
    if (lower === 'pip') return ['list', 'show'].includes(args[0] ?? '');
    return false;
  }
  return false;
}

/**
 * True only when the whole command string is provably read-only: no shell
 * metacharacters beyond `&& || | ;` separators, and every segment's binary +
 * subcommand is on the read-only allowlist. Anything unparseable is `false`.
 */
export function isReadOnlyShellCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  const text = command.trim();
  if (text.length === 0 || text.length > MAX_COMMAND_LENGTH) return false;
  if (CONTROL_CHARS.test(text)) return false;
  if (UNSAFE_PATTERN.test(text)) return false;
  const segments = text.split(/&&|\|\||\||;/);
  return segments.every((segment) => segment.trim().length > 0 && isReadOnlySegment(segment));
}

/**
 * Rule-generation surface for Cursor's declarative permission file: the same
 * allowlists that relax risk in `decideToolUse`, exported as data so the
 * generated `.cursor/cli.json` allow rules and this classifier can never
 * drift. Formatting into the `Shell(...)` grammar lives in
 * cursor/permissions.ts; flag-level holes in the "any args" forms (e.g.
 * `git log --output=<file>`) are closed there by companion deny rules.
 */
export interface ReadOnlyShellRuleSpecs {
  /** `git <sub>` invocations that stay read-only with any trailing args. */
  gitAnyArgs: string[];
  /** Exact `git ...` invocations safe only verbatim (listing forms). */
  gitExact: string[];
  /** `gh <group> <verb>` invocations read-only with any trailing args. */
  ghAnyArgs: string[];
  /** Exact `gh ...` invocations. */
  ghExact: string[];
  /** Command bases read-only with any args. */
  bare: string[];
}

export function readOnlyShellRuleSpecs(): ReadOnlyShellRuleSpecs {
  return {
    gitAnyArgs: [...GIT_SAFE].sort(),
    gitExact: [
      'branch', 'branch -a', 'branch -r', 'branch -vv', 'branch --show-current',
      'remote', 'remote -v', 'tag', 'tag -l', 'stash list', 'reflog',
      'worktree list', 'config --list',
    ],
    ghAnyArgs: [...GH_GROUPS].sort().flatMap((g) => [...GH_READ_VERBS].map((v) => `${g} ${v}`)),
    ghExact: ['status', 'auth status', '--version'],
    // Deliberately narrower than BARE_SAFE: only bases whose full flag
    // surface is safe unattended (rg rides its companion deny rules).
    bare: ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'diff', 'file', 'stat', 'which', 'where'],
  };
}
