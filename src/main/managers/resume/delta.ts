/**
 * Repository-delta computation for the Resume Pipeline — pure functions over
 * the bounded `runGit` runner.
 *
 * Security (CLAUDE.md §6): git is only ever invoked argv-only via the shared
 * {@link runGit}/{@link gitText} helpers (no shell, 15 s timeout, locked-down
 * env). The snapshot HEAD is regex-validated before it enters any argv as
 * defense in depth, every list is capped by `RESUME_LIMITS`, and nothing here
 * logs commit subjects or paths (counts only at the call sites).
 */
import { RESUME_LIMITS } from '@shared/constants';
import type {
  RepoDelta,
  RepoDeltaCommit,
  RepoDeltaFile,
  RepoDeltaFileCategory,
} from '@shared/types';
import { gitText, runGit } from '../git/exec';
import { parseNameStatus } from '../git/parse';

/** A dirty working-tree entry parsed from `git status --porcelain=v1 -z`. */
export interface DirtyEntry {
  path: string;
  status: string;
}

/** What a snapshot recorded / what the repo looks like now. */
export interface RepoAnchor {
  head: string | null;
  branch: string | null;
  dirtyHash: string;
  dirtyEntries: DirtyEntry[];
}

/** Only a real commit hash may enter a git argv (defense in depth). */
export function isValidHead(head: unknown): head is string {
  return typeof head === 'string' && /^[0-9a-f]{4,64}$/i.test(head);
}

/**
 * Parse `git status --porcelain=v1 -z` output. Entries are NUL-separated
 * `XY path` records; renames carry the origin path as an extra NUL field,
 * which is skipped (the delta reports the current path).
 */
export function parsePorcelainZ(raw: string, cap: number): DirtyEntry[] {
  const entries: DirtyEntry[] = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length && entries.length < cap; i++) {
    const part = parts[i];
    if (part.length < 4 || part[2] !== ' ') continue;
    const status = part.slice(0, 2).trim() || '??';
    entries.push({ path: part.slice(3), status });
    // `R`/`C` records are followed by the origin path as its own NUL field.
    if (part[0] === 'R' || part[0] === 'C') i++;
  }
  return entries;
}

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  // limboo.json is the repo's scripts/services config behind the ack-hash
  // trust gate — a change here must be prominent in the delta.
  'limboo.json',
]);

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);

/** Bucket a repo-relative POSIX path into a coarse delta category. */
export function categorizePath(relPath: string): RepoDeltaFileCategory {
  const lower = relPath.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  if (MANIFEST_BASENAMES.has(base)) return 'manifest';
  if (/(^|\/)migrations?\//.test(lower)) return 'migration';
  if (
    base.startsWith('tsconfig') ||
    base.startsWith('.eslintrc') ||
    base.startsWith('forge.config.') ||
    /^vite[^/]*\.config\./.test(base) ||
    base === '.gitignore' ||
    base === '.npmrc'
  ) {
    return 'config';
  }
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : '';
  if (DOC_EXTENSIONS.has(ext)) return 'doc';
  if (ext) return 'source';
  return 'other';
}

/** Map a parsed name-status entry onto the delta's file status vocabulary. */
function toDeltaStatus(status: string): RepoDeltaFile['status'] {
  switch (status) {
    case 'added':
    case 'deleted':
    case 'renamed':
    case 'modified':
      return status;
    default:
      return 'modified';
  }
}

/**
 * Compute the structured delta between a snapshot anchor and the repo's
 * current state. Every git call is bounded; overflow degrades to exact counts
 * with a capped list. Throws only on programmer error — git failures shrink
 * the delta instead of failing it.
 */
export async function computeRepoDelta(
  root: string,
  sessionId: string,
  snapshot: RepoAnchor & { at: number },
  current: RepoAnchor,
  maxCommits: number,
): Promise<RepoDelta> {
  const delta: RepoDelta = {
    sessionId,
    snapshotAt: snapshot.at,
    branchChanged: snapshot.branch !== current.branch,
    fromBranch: snapshot.branch,
    toBranch: current.branch,
    headMoved: snapshot.head !== current.head,
    fromHead: snapshot.head,
    toHead: current.head,
    commitsAhead: 0,
    commitsBehind: 0,
    commits: [],
    historyRewritten: false,
    rootChanged: false,
    files: [],
    filesTotal: 0,
    manifestChanges: [],
  };

  const snapHead = snapshot.head;
  const canRange = isValidHead(snapHead) && isValidHead(current.head) && delta.headMoved;

  if (canRange) {
    // 1. Does the snapshot commit still exist? (gc after a rebase drops it.)
    const exists = await runGit(root, ['cat-file', '-e', `${snapHead}^{commit}`]);
    if (!exists.ok) {
      delta.historyRewritten = true;
    } else {
      // 2. Fast-forward or rewrite? Non-ancestor = rebase/amend happened.
      const ancestor = await runGit(root, ['merge-base', '--is-ancestor', snapHead, 'HEAD']);
      if (!ancestor.ok) delta.historyRewritten = true;

      // 3. Exact counts in both directions.
      const ahead = await gitText(root, ['rev-list', '--count', `${snapHead}..HEAD`]);
      const behind = await gitText(root, ['rev-list', '--count', `HEAD..${snapHead}`]);
      delta.commitsAhead = Number.parseInt(ahead ?? '0', 10) || 0;
      delta.commitsBehind = Number.parseInt(behind ?? '0', 10) || 0;

      // 4. Capped commit list, newest first (0x1f-separated fields).
      const log = await runGit(root, [
        'log',
        '--format=%H%x1f%s%x1f%an%x1f%ct',
        '-n',
        String(maxCommits),
        `${snapHead}..HEAD`,
      ]);
      if (log.ok) {
        for (const line of log.stdout.split('\n')) {
          if (!line) continue;
          const [hash, subject, author, ct] = line.split('\x1f');
          if (!isValidHead(hash)) continue;
          const commit: RepoDeltaCommit = {
            hash,
            subject: (subject ?? '').slice(0, RESUME_LIMITS.subjectMax),
            author: (author ?? '').slice(0, 80),
            at: (Number.parseInt(ct ?? '0', 10) || 0) * 1000,
          };
          delta.commits.push(commit);
          if (delta.commits.length >= maxCommits) break;
        }
      }

      // 5. Committed file changes over the range.
      const diff = await runGit(root, ['diff', '--name-status', '-z', snapHead, 'HEAD']);
      if (diff.ok) {
        for (const change of parseNameStatus(diff.stdout)) {
          delta.files.push({
            path: change.path,
            status: toDeltaStatus(change.status),
            category: categorizePath(change.path),
            // Pre-rename path so enrichment can read the blob at the snapshot.
            oldPath: change.oldPath,
          });
        }
      }
    }
  }

  // 6. Merge current dirty entries (committed status wins on the same path).
  const seen = new Set(delta.files.map((f) => f.path));
  for (const dirty of current.dirtyEntries) {
    if (seen.has(dirty.path)) continue;
    seen.add(dirty.path);
    delta.files.push({ path: dirty.path, status: 'dirty', category: categorizePath(dirty.path) });
  }

  delta.filesTotal = delta.files.length;
  if (delta.files.length > RESUME_LIMITS.maxFilesInDelta) {
    delta.files = delta.files.slice(0, RESUME_LIMITS.maxFilesInDelta);
  }
  delta.manifestChanges = delta.files
    .filter((f) => f.category === 'manifest' || f.category === 'migration')
    .map((f) => f.path);

  return delta;
}

/** One-line human summary for the banner / activity feed. */
export function summarizeDelta(delta: RepoDelta): string {
  if (delta.rootChanged) return 'Execution root changed since last visit';
  const parts: string[] = [];
  if (delta.historyRewritten) parts.push('history rewritten');
  if (delta.commitsAhead > 0) {
    parts.push(`${delta.commitsAhead} commit${delta.commitsAhead === 1 ? '' : 's'}`);
  }
  if (delta.commitsBehind > 0) parts.push(`${delta.commitsBehind} behind`);
  if (delta.filesTotal > 0) {
    parts.push(`${delta.filesTotal} file${delta.filesTotal === 1 ? '' : 's'}`);
  }
  if (delta.branchChanged) {
    parts.push(`branch ${delta.fromBranch ?? 'detached'} → ${delta.toBranch ?? 'detached'}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Repository changed';
}

/** Unfinished plan/task items appended to the injected block (one-shot, capped). */
export interface PlanItemsContext {
  title: string;
  items: string[];
}

/**
 * Render the `<repository-delta>` system-prompt block within the char budget
 * (same trim-loop pattern as the memory/search context blocks). Advisory: the
 * agent's own Read/Grep/Glob remain authoritative.
 */
export function renderDeltaBlock(delta: RepoDelta, planItems?: PlanItemsContext | null): string {
  const budget = RESUME_LIMITS.injectCharBudget;
  const lines: string[] = [
    '<repository-delta>',
    'The repository changed since this conversation last worked in it. Reconcile',
    'your assumptions with these changes before relying on prior file/symbol',
    'knowledge; re-read anything you depend on.',
  ];
  if (delta.rootChanged) {
    lines.push('The session execution root changed (worktree recreated or detached).');
  }
  if (delta.historyRewritten) {
    lines.push('History was rewritten (rebase/amend) — prior commit hashes may be gone.');
  }
  if (delta.branchChanged) {
    lines.push(`Branch: ${delta.fromBranch ?? 'detached'} -> ${delta.toBranch ?? 'detached'}`);
  }
  if (delta.headMoved && delta.fromHead && delta.toHead) {
    lines.push(
      `HEAD: ${delta.fromHead.slice(0, 8)} -> ${delta.toHead.slice(0, 8)}` +
        ` (${delta.commitsAhead} ahead, ${delta.commitsBehind} behind)`,
    );
  }

  const out: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > budget) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };
  for (const line of lines) push(line);

  if (delta.commits.length > 0) {
    push(`Commits (newest first, ${delta.commits.length} of ${delta.commitsAhead}):`);
    for (const c of delta.commits) {
      if (!push(`- ${c.hash.slice(0, 8)} ${c.subject}`)) break;
    }
  }
  if (delta.files.length > 0) {
    push(`Changed files (${delta.filesTotal}):`);
    let listed = 0;
    for (const f of delta.files) {
      const tag = f.category === 'manifest' || f.category === 'migration' ? `[${f.category}] ` : '';
      if (!push(`- ${tag}${f.status}: ${f.path}`)) break;
      listed++;
    }
    if (listed < delta.filesTotal) push(`- ... and ${delta.filesTotal - listed} more`);
  }
  if (delta.manifestChanges.length > 0) {
    push(
      `Dependency manifests / migrations changed: ${delta.manifestChanges
        .slice(0, 8)
        .join(', ')} — re-check installed dependencies and schema assumptions.`,
    );
  }
  if (delta.symbols && delta.symbols.length > 0) {
    push('Symbol changes (~ = signature changed):');
    for (const s of delta.symbols) {
      const added = s.added.length > 0 ? ` +${s.added.join(', +')}` : '';
      const removed = s.removed.length > 0 ? ` -${s.removed.join(', -')}` : '';
      const changed = s.changed && s.changed.length > 0 ? ` ~${s.changed.join(', ~')}` : '';
      if (!push(`- ${s.path}:${added}${removed}${changed}`)) break;
    }
  }
  if (delta.refImpacts && delta.refImpacts.length > 0) {
    for (const r of delta.refImpacts) {
      if (!push(`- ${r.importers} file${r.importers === 1 ? '' : 's'} import ${r.path}`)) break;
    }
  }
  if (delta.downgradedMemories && delta.downgradedMemories.length > 0) {
    push(
      `Project memories referencing removed files were downgraded: ${delta.downgradedMemories
        .map((m) => m.title)
        .slice(0, 5)
        .join('; ')}.`,
    );
  }
  const dirtyCount = delta.files.filter((f) => f.status === 'dirty').length;
  if (dirtyCount > 0) push(`(uncommitted changes present: ${dirtyCount} files)`);

  if (planItems && planItems.items.length > 0) {
    push(`Unfinished plan items from "${planItems.title.slice(0, 80)}":`);
    for (const item of planItems.items.slice(0, RESUME_LIMITS.maxPlanItemsInjected)) {
      if (!push(`- [ ] ${item.slice(0, RESUME_LIMITS.planItemCharMax)}`)) break;
    }
  }

  out.push('</repository-delta>');
  return out.join('\n');
}
