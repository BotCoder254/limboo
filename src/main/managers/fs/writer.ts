/**
 * Centralized File Writer. The renderer never mutates files directly — every
 * write/create/delete/rename/copy passes through here so validation, boundary
 * enforcement, atomicity, and history recording all stay in one place (the
 * mutation half of the File System Layer gateway).
 *
 * Security (CLAUDE.md §6):
 *   - the workspace root itself is never a valid mutation target;
 *   - every path (source AND destination) is resolved against the root and must
 *     stay inside it ({@link isInsideRoot});
 *   - because a target may not exist yet, the deepest EXISTING ancestor is
 *     `realpath`ed and re-checked for containment, so a symlinked directory can
 *     never redirect a mutation outside the workspace;
 *   - writes refuse to go through a symlink; delete/rename operate on the link
 *     itself and never follow it; recursive copies skip symlinks entirely;
 *   - any path containing a `.git` segment is rejected (repo integrity);
 *   - writes are atomic (temp sibling + rename) and capped at
 *     {@link FS_LIMITS.maxWriteBytes}; recursive delete/copy are bounded by
 *     {@link FS_LIMITS.maxCopyEntries}.
 *
 * File contents are never logged.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FS_LIMITS } from '@shared/constants';
import type { FileWriteResult } from '@shared/types';
import { isInsideRoot } from '../workspace/validate';

/** Thrown when a mutation is rejected for a security/validation reason. */
export class FileWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileWriteError';
  }
}

/** Workspace-relative POSIX form of an absolute path under `root`. */
function toPosixRel(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Resolve a mutation target inside the workspace root, or throw. `relPath` is
 * expected to already be a bounded, NUL-free, relative, non-traversing string
 * (validated at the IPC boundary); every check here is defense in depth.
 */
function resolveMutationTarget(root: string, relPath: string): string {
  const rel = (relPath ?? '').trim();
  if (!rel) throw new FileWriteError('Refusing to mutate the workspace root.');

  const segments = rel.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) throw new FileWriteError('Refusing to mutate the workspace root.');
  if (segments.some((s) => s === '..')) {
    throw new FileWriteError('Path escapes the workspace root.');
  }
  if (segments.some((s) => s.toLowerCase() === '.git')) {
    throw new FileWriteError('Refusing to touch the .git directory.');
  }

  const target = path.resolve(root, segments.join(path.sep));
  if (!isInsideRoot(root, target) || target === path.resolve(root)) {
    throw new FileWriteError('Path escapes the workspace root.');
  }

  // The target may not exist yet, so realpath the deepest EXISTING ancestor and
  // re-assert containment against the REAL root — a symlinked directory in the
  // chain can never redirect the mutation outside the workspace.
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    throw new FileWriteError('Workspace root is not accessible.');
  }
  let probe = target;
  for (;;) {
    let real: string | null = null;
    try {
      real = fs.realpathSync(probe);
    } catch {
      real = null;
    }
    if (real !== null) {
      if (!isInsideRoot(realRoot, real)) {
        throw new FileWriteError('Resolved path escapes the workspace root.');
      }
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break; // hit the filesystem root — nothing existed
    probe = parent;
  }
  return target;
}

/** Write `content` to a temp sibling, then atomically rename it into place. */
function atomicWrite(target: string, content: string): void {
  const tmp = path.join(
    path.dirname(target),
    `.limboo-tmp-${crypto.randomBytes(6).toString('hex')}`,
  );
  let committed = false;
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    // rename() replaces an existing file atomically on both POSIX and Windows.
    fs.renameSync(tmp, target);
    committed = true;
  } finally {
    if (!committed) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* temp never created or already gone */
      }
    }
  }
}

/** Count entries under a directory, throwing past `FS_LIMITS.maxCopyEntries`. */
function assertBoundedSubtree(dir: string, budget: { left: number }): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    budget.left -= 1;
    if (budget.left < 0) {
      throw new FileWriteError('Directory has too many entries for this operation.');
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      assertBoundedSubtree(path.join(dir, entry.name), budget);
    }
  }
}

/** True when `child` is the same path as `parent` or nested anywhere under it. */
function isSameOrSubpath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function requireParentDir(target: string): void {
  const parent = lstatOrNull(path.dirname(target));
  if (!parent || !parent.isDirectory()) {
    throw new FileWriteError('Parent directory does not exist.');
  }
}

/** Atomically write a UTF-8 file inside the workspace (temp sibling + rename). */
export function writeWorkspaceFile(
  root: string,
  relPath: string,
  content: string,
  opts: { overwrite?: boolean } = {},
): FileWriteResult {
  if (Buffer.byteLength(content, 'utf8') > FS_LIMITS.maxWriteBytes) {
    throw new FileWriteError('Content exceeds the write size cap.');
  }
  const target = resolveMutationTarget(root, relPath);
  const existing = lstatOrNull(target);
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new FileWriteError('Refusing to write through a symlink.');
    }
    if (!existing.isFile()) {
      throw new FileWriteError('Destination exists and is not a regular file.');
    }
    if (!opts.overwrite) {
      throw new FileWriteError('File already exists.');
    }
  }
  requireParentDir(target);
  atomicWrite(target, content);
  return { path: toPosixRel(root, target), size: fs.statSync(target).size, created: !existing };
}

/** Create an empty file; fails if anything already exists at the path. */
export function createWorkspaceFile(root: string, relPath: string): FileWriteResult {
  const target = resolveMutationTarget(root, relPath);
  if (lstatOrNull(target)) throw new FileWriteError('An entry already exists at that path.');
  requireParentDir(target);
  atomicWrite(target, '');
  return { path: toPosixRel(root, target), size: 0, created: true };
}

/** Create a directory (and missing intermediates) inside the workspace. */
export function createWorkspaceDir(root: string, relPath: string): FileWriteResult {
  const target = resolveMutationTarget(root, relPath);
  if (lstatOrNull(target)) throw new FileWriteError('An entry already exists at that path.');
  fs.mkdirSync(target, { recursive: true });
  return { path: toPosixRel(root, target), created: true };
}

/**
 * Delete a file, symlink (the link itself, never its target), or directory.
 * Non-empty directories require `recursive: true` and stay within the entry cap.
 */
export function deleteWorkspaceEntry(
  root: string,
  relPath: string,
  opts: { recursive?: boolean } = {},
): void {
  const target = resolveMutationTarget(root, relPath);
  const stat = lstatOrNull(target);
  if (!stat) throw new FileWriteError('No such file or directory.');

  if (stat.isDirectory()) {
    if (!opts.recursive) {
      if (fs.readdirSync(target).length > 0) {
        throw new FileWriteError('Directory is not empty (pass recursive).');
      }
      fs.rmdirSync(target);
      return;
    }
    assertBoundedSubtree(target, { left: FS_LIMITS.maxCopyEntries });
    fs.rmSync(target, { recursive: true, force: false });
    return;
  }
  fs.rmSync(target, { force: false });
}

/**
 * Rename or move an entry (the destination is a full workspace-relative path).
 * Symlinks are moved as links; overwrite only ever replaces file with file.
 */
export function renameWorkspaceEntry(
  root: string,
  fromRel: string,
  toRel: string,
  opts: { overwrite?: boolean } = {},
): FileWriteResult {
  const from = resolveMutationTarget(root, fromRel);
  const to = resolveMutationTarget(root, toRel);
  const source = lstatOrNull(from);
  if (!source) throw new FileWriteError('No such file or directory.');
  if (isSameOrSubpath(from, to)) {
    throw new FileWriteError('Destination is inside the source path.');
  }
  const dest = lstatOrNull(to);
  if (dest) {
    if (!opts.overwrite) throw new FileWriteError('Destination already exists.');
    if (!source.isFile() || !dest.isFile()) {
      throw new FileWriteError('Only a file may replace an existing file.');
    }
  }
  requireParentDir(to);
  fs.renameSync(from, to);
  return {
    path: toPosixRel(root, to),
    size: source.isFile() ? source.size : undefined,
    created: !dest,
  };
}

/**
 * Copy a file or directory inside the workspace. Directory copies are bounded
 * by the entry cap and skip symlinks entirely; symlink sources are refused.
 */
export function copyWorkspaceEntry(
  root: string,
  fromRel: string,
  toRel: string,
  opts: { overwrite?: boolean } = {},
): FileWriteResult {
  const from = resolveMutationTarget(root, fromRel);
  const to = resolveMutationTarget(root, toRel);
  const source = lstatOrNull(from);
  if (!source) throw new FileWriteError('No such file or directory.');
  if (source.isSymbolicLink()) throw new FileWriteError('Refusing to copy a symlink.');
  if (isSameOrSubpath(from, to)) {
    throw new FileWriteError('Destination is inside the source path.');
  }
  const dest = lstatOrNull(to);

  if (source.isFile()) {
    if (dest) {
      if (!opts.overwrite) throw new FileWriteError('Destination already exists.');
      if (!dest.isFile()) throw new FileWriteError('Only a file may replace an existing file.');
    }
    requireParentDir(to);
    fs.copyFileSync(from, to, opts.overwrite ? 0 : fs.constants.COPYFILE_EXCL);
    return { path: toPosixRel(root, to), size: fs.statSync(to).size, created: !dest };
  }

  if (!source.isDirectory()) throw new FileWriteError('Source is not a file or directory.');
  if (dest) throw new FileWriteError('Destination already exists.');
  const budget = { left: FS_LIMITS.maxCopyEntries };
  assertBoundedSubtree(from, budget);
  requireParentDir(to);
  copyDirRecursive(from, to);
  return { path: toPosixRel(root, to), created: true };
}

/** Bounded recursive directory copy (symlinks skipped, never followed). */
function copyDirRecursive(from: string, to: string): void {
  fs.mkdirSync(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirRecursive(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  }
}
