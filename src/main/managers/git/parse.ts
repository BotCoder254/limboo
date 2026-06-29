/**
 * Pure parsers for git's machine-readable output (porcelain v2 status, unified
 * diff, log, blame). No I/O here — each takes raw git stdout and returns shared
 * domain models, so they are trivially testable and never touch the filesystem.
 */
import type {
  GitBlameLine,
  GitCommit,
  GitDiffHunk,
  GitDiffLine,
  GitFileChange,
  GitFileStatus,
} from '@shared/types';

/* ------------------------------------------------------------ status */

interface ParsedStatus {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  detached: boolean;
  files: GitFileChange[];
}

/** Map a single porcelain XY code half to a display status. */
function codeToStatus(code: string): GitFileStatus | null {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
    case 'T': // type-change, treat as modified
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
    case 'C':
      return 'renamed';
    default:
      return null;
  }
}

/**
 * Parse `git status --porcelain=v2 --branch -z`. The `-z` form NUL-separates
 * entries (and, for renames, the new path from the original path), so filenames
 * with spaces/newlines are handled correctly.
 */
export function parseStatus(raw: string): ParsedStatus {
  const out: ParsedStatus = { ahead: 0, behind: 0, detached: false, files: [] };
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const type = part[0];

    if (type === '#') {
      const [, key, ...rest] = part.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.head') {
        if (value === '(detached)') out.detached = true;
        else out.branch = value;
      } else if (key === 'branch.upstream') {
        out.upstream = value;
      } else if (key === 'branch.ab') {
        const m = /\+(\d+)\s+-(\d+)/.exec(value);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
      continue;
    }

    if (type === '1') {
      const fields = part.split(' ');
      const xy = fields[1] ?? '..';
      const filePath = fields.slice(8).join(' ');
      out.files.push(toChange(filePath, xy));
    } else if (type === '2') {
      const fields = part.split(' ');
      const xy = fields[1] ?? '..';
      const filePath = fields.slice(9).join(' ');
      const oldPath = parts[++i] ?? undefined;
      out.files.push({ ...toChange(filePath, xy), status: 'renamed', oldPath });
    } else if (type === 'u') {
      const fields = part.split(' ');
      const filePath = fields.slice(10).join(' ');
      out.files.push({
        path: filePath,
        status: 'conflicted',
        staged: false,
        unstaged: true,
        adds: 0,
        dels: 0,
      });
    } else if (type === '?') {
      out.files.push({
        path: part.slice(2),
        status: 'untracked',
        staged: false,
        unstaged: true,
        adds: 0,
        dels: 0,
      });
    }
    // '!' (ignored) entries are dropped — git doesn't emit them without --ignored.
  }
  return out;
}

function toChange(filePath: string, xy: string): GitFileChange {
  const x = xy[0] ?? '.';
  const y = xy[1] ?? '.';
  const staged = x !== '.' && x !== '?';
  const unstaged = y !== '.';
  const status = codeToStatus(x !== '.' ? x : y) ?? 'modified';
  return { path: filePath, status, staged, unstaged, adds: 0, dels: 0 };
}

/**
 * Parse `git diff --numstat -z` into an adds/dels map keyed by path. Best-effort:
 * renamed entries (3 NUL fields) are mapped onto the new path.
 */
export function parseNumstat(raw: string): Map<string, { adds: number; dels: number }> {
  const map = new Map<string, { adds: number; dels: number }>();
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || !/^\d|^-/.test(part)) continue;
    const [addsStr, delsStr, inlinePath] = part.split('\t');
    const adds = Number(addsStr);
    const dels = Number(delsStr);
    let key = inlinePath;
    // Rename form: numbers + empty path, then oldPath, then newPath as NUL parts.
    if (!key) {
      i++; // oldPath
      key = parts[++i] ?? '';
    }
    if (key) {
      map.set(key, {
        adds: Number.isFinite(adds) ? adds : 0,
        dels: Number.isFinite(dels) ? dels : 0,
      });
    }
  }
  return map;
}

/* -------------------------------------------------------------- diff */

/** Parse a single-file unified diff into hunks with old/new line numbers. */
export function parseUnifiedDiff(raw: string): { binary: boolean; hunks: GitDiffHunk[] } {
  const hunks: GitDiffHunk[] = [];
  let binary = false;
  let current: GitDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      binary = true;
      continue;
    }
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode')
    ) {
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
      oldLine = m ? Number(m[1]) : 0;
      newLine = m ? Number(m[2]) : 0;
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) {
      current.lines.push({ kind: 'meta', text: line.slice(1).trim() });
      continue;
    }
    const marker = line[0];
    const text = line.slice(1);
    let diffLine: GitDiffLine;
    if (marker === '+') {
      diffLine = { kind: 'add', text, newLine: newLine++ };
    } else if (marker === '-') {
      diffLine = { kind: 'del', text, oldLine: oldLine++ };
    } else {
      diffLine = { kind: 'context', text, oldLine: oldLine++, newLine: newLine++ };
    }
    current.lines.push(diffLine);
  }
  return { binary, hunks };
}

/* --------------------------------------------------------------- log */

const FIELD = '\x1f';
const RECORD = '\x1e';

/** The git log pretty format that {@link parseLog} consumes. */
export const LOG_FORMAT = `%H${FIELD}%h${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${FIELD}%D${RECORD}`;

export function parseLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of raw.split(RECORD)) {
    const row = record.replace(/^\n/, '');
    if (!row.trim()) continue;
    const [hash, shortHash, author, email, at, subject, refs] = row.split(FIELD);
    if (!hash) continue;
    commits.push({
      hash,
      shortHash,
      author,
      email,
      at: Number(at) * 1000,
      subject: subject ?? '',
      refs: (refs ?? '')
        .split(', ')
        .map((r) => r.replace(/^HEAD -> /, '').trim())
        .filter(Boolean),
    });
  }
  return commits;
}

/** Parse `git diff-tree --no-commit-id --name-status -r -z <hash>`. */
export function parseNameStatus(raw: string): GitFileChange[] {
  const files: GitFileChange[] = [];
  const parts = raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!/^[A-Z]/.test(code)) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[++i];
      const newPath = parts[++i];
      files.push({
        path: newPath,
        oldPath,
        status: 'renamed',
        staged: true,
        unstaged: false,
        adds: 0,
        dels: 0,
      });
    } else {
      const filePath = parts[++i];
      files.push({
        path: filePath,
        status: codeToStatus(letter) ?? 'modified',
        staged: true,
        unstaged: false,
        adds: 0,
        dels: 0,
      });
    }
  }
  return files;
}

/* ------------------------------------------------------------- blame */

export function parseBlame(raw: string): GitBlameLine[] {
  const lines: GitBlameLine[] = [];
  const commits = new Map<string, { author: string; at: number; summary: string }>();
  let pending: { hash: string; line: number } | null = null;
  let cur: { author: string; at: number; summary: string } = { author: '', at: 0, summary: '' };

  for (const line of raw.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header) {
      pending = { hash: header[1], line: Number(header[2]) };
      cur = commits.get(header[1]) ?? { author: '', at: 0, summary: '' };
      continue;
    }
    if (line.startsWith('author ')) cur.author = line.slice(7);
    else if (line.startsWith('author-time ')) cur.at = Number(line.slice(12)) * 1000;
    else if (line.startsWith('summary ')) cur.summary = line.slice(8);
    else if (line.startsWith('\t') && pending) {
      commits.set(pending.hash, cur);
      lines.push({
        line: pending.line,
        hash: pending.hash,
        shortHash: pending.hash.slice(0, 7),
        author: cur.author,
        at: cur.at,
        summary: cur.summary,
      });
      pending = null;
    }
  }
  return lines;
}
