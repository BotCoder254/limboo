/**
 * Directory Tree + Indexer for the File System Layer. Builds the continuously
 * synchronized in-memory model of a workspace's physical structure that every
 * other subsystem (Files drawer, future search/indexing) reads instead of
 * traversing the disk itself.
 *
 * Security (CLAUDE.md §6): the walk is bounded by {@link FS_LIMITS.maxTreeEntries}
 * and {@link FS_LIMITS.maxDepth}, stays inside the workspace root via
 * {@link isInsideRoot}, and NEVER follows symlinks (they are recorded but not
 * descended) so there are no cycles and no escape from the root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FS_LIMITS } from '@shared/constants';
import type { FileNode, FileTree, IndexProgress } from '@shared/types';
import { isInsideRoot } from '../workspace/validate';
import type { IgnoreMatcher } from './ignore';

/** POSIX-normalize a workspace-relative path for stable cross-platform keys. */
function relPosix(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join('/');
}

/** Sort dirs first, then case-insensitive alphabetical — a stable explorer order. */
function sortNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * Cheap first pass: count the entries the build pass will visit so progress can
 * be expressed as a real percentage. Uses readdir only (no per-file stat) and
 * respects the same ignore / depth / cap / symlink rules as the build pass.
 */
function countEntries(root: string, matcher: IgnoreMatcher): number {
  let count = 0;
  const walk = (dir: string, depth: number) => {
    if (count >= FS_LIMITS.maxTreeEntries || depth > FS_LIMITS.maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count >= FS_LIMITS.maxTreeEntries) return;
      const full = path.join(dir, e.name);
      if (!isInsideRoot(root, full)) continue;
      const rel = relPosix(root, full);
      if (matcher.ignores(rel)) continue;
      count += 1;
      if (e.isDirectory() && !e.isSymbolicLink()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return count;
}

export interface BuildTreeOptions {
  workspaceId: string;
  root: string;
  matcher: IgnoreMatcher;
  /** Throttled progress sink; called at most every progressThrottleMs. */
  onProgress?: (progress: IndexProgress) => void;
}

/** Yield to the event loop so queued IPC (progress) flushes and the UI stays live. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** How many entries to process between cooperative yields. */
const YIELD_EVERY = 400;

/**
 * Build the full {@link FileTree} for a workspace, emitting throttled
 * {@link IndexProgress} as it goes. Cooperative/async: it periodically yields to
 * the event loop so the main process stays responsive and progress events
 * actually stream to the renderer instead of arriving only at completion.
 */
export async function buildTree({
  workspaceId,
  root,
  matcher,
  onProgress,
}: BuildTreeOptions): Promise<FileTree> {
  const total = countEntries(root, matcher);
  let processed = 0;
  let sinceYield = 0;
  let truncated = false;
  let lastEmit = 0;

  const emit = (phase: IndexProgress['phase'], force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmit < FS_LIMITS.progressThrottleMs) return;
    lastEmit = now;
    const percent =
      phase === 'done' ? 100 : total === 0 ? 0 : Math.min(99, Math.round((processed / total) * 100));
    onProgress({ workspaceId, phase, processed, total, percent });
  };

  emit('counting', true);

  const buildDir = async (dir: string, depth: number): Promise<FileNode[]> => {
    if (processed >= FS_LIMITS.maxTreeEntries) {
      truncated = true;
      return [];
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: FileNode[] = [];
    for (const e of entries) {
      if (processed >= FS_LIMITS.maxTreeEntries) {
        truncated = true;
        break;
      }
      const full = path.join(dir, e.name);
      if (!isInsideRoot(root, full)) continue;
      const rel = relPosix(root, full);
      if (matcher.ignores(rel)) continue;

      processed += 1;
      const isSymlink = e.isSymbolicLink();

      if (e.isDirectory() && !isSymlink) {
        const atDepthCap = depth + 1 > FS_LIMITS.maxDepth;
        const children = atDepthCap ? [] : await buildDir(full, depth + 1);
        if (atDepthCap) truncated = true;
        nodes.push({
          path: rel,
          name: e.name,
          type: 'dir',
          isSymlink: isSymlink || undefined,
          truncated: atDepthCap || undefined,
          children: children.sort(sortNodes),
        });
      } else {
        let size: number | undefined;
        try {
          // lstat so a symlink reports the link's own size, never its target.
          size = fs.lstatSync(full).size;
        } catch {
          /* ignore unreadable entry */
        }
        nodes.push({
          path: rel,
          name: e.name,
          type: 'file',
          size,
          isSymlink: isSymlink || undefined,
        });
      }
      emit('building');
      sinceYield += 1;
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await yieldToLoop();
      }
    }
    return nodes;
  };

  const children = (await buildDir(root, 0)).sort(sortNodes);
  const rootNode: FileNode = { path: '', name: path.basename(root) || root, type: 'dir', children };

  emit('done', true);

  return {
    workspaceId,
    root: rootNode,
    nodeCount: processed,
    truncated,
    builtAt: Date.now(),
  };
}
