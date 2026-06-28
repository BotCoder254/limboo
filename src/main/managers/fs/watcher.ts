/**
 * Workspace Watcher. Observes the active workspace for on-disk changes made by
 * any external tool (git checkout, command-line edit, another editor, build
 * system) and notifies the File System Layer so the directory tree, caches, and
 * UI stay synchronized without polling.
 *
 * Security (CLAUDE.md §6): symlinks are never followed (`followSymlinks: false`),
 * the depth is bounded, and the same {@link IgnoreMatcher} the indexer uses keeps
 * heavy/ignored directories (node_modules, .git, …) out of the watch set so a
 * huge tree can never overwhelm the main process. Disposed on workspace switch.
 */
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { FS_LIMITS } from '@shared/constants';
import { logger } from '../../logger';
import type { IgnoreMatcher } from './ignore';

export interface WorkspaceWatcherOptions {
  root: string;
  matcher: IgnoreMatcher;
  /** Debounced callback fired after a burst of filesystem events settles. */
  onChange: () => void;
}

/**
 * A single chokidar watcher bound to one workspace root. Coalesces event bursts
 * (a branch switch can emit thousands) into one debounced `onChange` so the tree
 * is rebuilt/pushed at most once per settle window.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WorkspaceWatcherOptions) {}

  start(): void {
    if (this.watcher) return;
    const { root, matcher } = this.options;
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: FS_LIMITS.maxDepth,
      // Reuse the shared ignore matcher: chokidar passes absolute paths, so we
      // convert to a workspace-relative POSIX path before consulting it.
      ignored: (entry: string) => {
        const rel = path.relative(root, entry);
        if (!rel || rel.startsWith('..')) return false;
        return matcher.ignores(rel.split(path.sep).join('/'));
      },
      ignorePermissionErrors: true,
    });

    const schedule = () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        try {
          this.options.onChange();
        } catch (err) {
          logger.warn('workspace watcher onChange failed', err);
        }
      }, FS_LIMITS.watchDebounceMs);
    };

    this.watcher
      .on('add', schedule)
      .on('change', schedule)
      .on('unlink', schedule)
      .on('addDir', schedule)
      .on('unlinkDir', schedule)
      .on('error', (err) => logger.warn('workspace watcher error', err));
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      const w = this.watcher;
      this.watcher = null;
      try {
        await w.close();
      } catch (err) {
        logger.warn('workspace watcher close failed', err);
      }
    }
  }
}
