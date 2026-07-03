/**
 * Worktree path layout + containment guards for the Worktree Manager.
 *
 * Layout (Paseo-style): worktrees live under a single configurable root,
 * grouped by a short hash of the source repository's real path, and identified
 * by a short random slug:
 *
 *   {root}/{sha1(realpath(repo)).slice(0,12)}/{slug}
 *
 * The bucket keeps unrelated repos apart even when the user points several
 * workspaces at the same worktree root; the short slug keeps the total prefix
 * small so deep `node_modules` trees stay under Windows MAX_PATH.
 *
 * Security (CLAUDE.md §6): every path the manager creates or removes must pass
 * {@link assertInsideWorktreeRoot} — a realpath-aware containment check — so a
 * corrupted settings value or a stale DB row can never direct a recursive
 * delete outside the worktree root.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { WORKTREE_LIMITS } from '@shared/constants';
import type { AppSettings } from '@shared/types';

/** Resolve the configured worktree root ('' = default under userData). */
export function worktreeRootDir(settings: AppSettings): string {
  const configured = settings.git.worktrees.root.trim();
  if (configured && path.isAbsolute(configured)) return path.normalize(configured);
  return path.join(app.getPath('userData'), 'worktrees');
}

/** Short, stable per-repository bucket derived from the repo's real path. */
export function repoBucket(repoRoot: string): string {
  let real = repoRoot;
  try {
    real = fs.realpathSync.native(repoRoot);
  } catch {
    /* keep the normalized path when realpath fails (e.g. transient share) */
  }
  const normalized = path.normalize(real).toLowerCase();
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/** Short random slug (a-z0-9), generated exclusively in the main process. */
export function newSlug(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(WORKTREE_LIMITS.slugLength);
  let slug = '';
  for (let i = 0; i < WORKTREE_LIMITS.slugLength; i += 1) {
    slug += alphabet[bytes[i] % alphabet.length];
  }
  return slug;
}

/**
 * Guard that `target` resolves strictly inside the worktree root. Symlink-aware:
 * both sides are realpath'd when they exist so a link can't smuggle the target
 * elsewhere. Throws on escape; returns the resolved absolute target on success.
 */
export function assertInsideWorktreeRoot(root: string, target: string): string {
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.length > WORKTREE_LIMITS.rootPathMax ||
    target.includes('\0')
  ) {
    throw new Error('worktree: invalid path');
  }
  const realRoot = realpathIfExists(path.resolve(root));
  const resolved = path.resolve(target);
  // Realpath the deepest existing ancestor so symlinked segments can't escape.
  const realTarget = realpathIfExists(resolved);
  const rel = path.relative(realRoot, realTarget);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('worktree: path escapes the worktree root');
  }
  return resolved;
}

function realpathIfExists(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathIfExists(parent), path.basename(p));
  }
}
