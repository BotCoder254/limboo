/**
 * Lightweight, read-only git status for a workspace root — the current branch and
 * the working-tree diff stat (added/deleted lines). Used to drive the live branch
 * label + Changes counts in the session sidebar.
 *
 * Security (CLAUDE.md §6): git runs via `execFileSync` with an argv array and a
 * fixed `cwd` — never `shell: true`, so nothing in the path is interpreted by a
 * shell. All calls are bounded by a short timeout and fail soft (return defaults).
 */
import { execFileSync } from 'node:child_process';

export interface GitStatus {
  /** Current branch name, or undefined when detached / not a repo. */
  branch?: string;
  /** Added lines across the working tree + index (uncommitted). */
  adds: number;
  /** Deleted lines across the working tree + index (uncommitted). */
  dels: number;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Active git branch, or undefined if not a repo / git unavailable / detached. */
export function gitBranch(root: string): string | undefined {
  const out = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return out && out !== 'HEAD' ? out : out || undefined;
}

/** Sum the numstat added/deleted columns; binary files report `-` and are skipped. */
function sumNumstat(out: string | null): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  if (!out) return { adds, dels };
  for (const line of out.split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 2) continue;
    const a = Number(cols[0]);
    const d = Number(cols[1]);
    if (Number.isFinite(a)) adds += a;
    if (Number.isFinite(d)) dels += d;
  }
  return { adds, dels };
}

/**
 * Working-tree diff stat: unstaged (`git diff`) + staged (`git diff --cached`)
 * line changes. Untracked files are not counted (they have no diff base).
 */
export function gitDiffStat(root: string): { adds: number; dels: number } {
  const unstaged = sumNumstat(git(root, ['diff', '--numstat']));
  const staged = sumNumstat(git(root, ['diff', '--cached', '--numstat']));
  return { adds: unstaged.adds + staged.adds, dels: unstaged.dels + staged.dels };
}

/** Combined branch + diff stat for a workspace root. Always returns a value. */
export function gitStatus(root: string): GitStatus {
  const { adds, dels } = gitDiffStat(root);
  return { branch: gitBranch(root), adds, dels };
}
