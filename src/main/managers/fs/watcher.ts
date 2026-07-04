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

/** One settled burst of filesystem events, batched for incremental indexing. */
export interface WatchBatch {
  /** Workspace-relative POSIX file paths touched in the settle window. */
  paths: string[];
  /**
   * True when a directory-level event (addDir/unlinkDir) occurred or the batch
   * overflowed {@link FS_LIMITS.watchBatchMax} — callers should do a full pass.
   */
  structural: boolean;
}

export interface WorkspaceWatcherOptions {
  root: string;
  matcher: IgnoreMatcher;
  /** Debounced callback fired after a burst of filesystem events settles. */
  onChange: (batch: WatchBatch) => void;
}

/**
 * A single chokidar watcher bound to one workspace root. Coalesces event bursts
 * (a branch switch can emit thousands) into one debounced `onChange` so the tree
 * is rebuilt/pushed at most once per settle window.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Distinct rel-POSIX file paths accumulated in the current settle window. */
  private pending = new Set<string>();
  /** Set on dir-level events / overflow — the batch needs a full pass. */
  private structural = false;

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
        const batch = { paths: [...this.pending], structural: this.structural };
        this.pending.clear();
        this.structural = false;
        try {
          this.options.onChange(batch);
        } catch (err) {
          logger.warn('workspace watcher onChange failed', err);
        }
      }, FS_LIMITS.watchDebounceMs);
    };

    // Accumulate the workspace-relative POSIX path of a file-level event; past
    // the batch cap the window degrades to a structural (full-pass) signal.
    const collect = (entry: string) => {
      const rel = path.relative(root, entry);
      if (!rel || rel.startsWith('..')) {
        this.structural = true;
      } else if (this.pending.size >= FS_LIMITS.watchBatchMax) {
        this.structural = true;
      } else {
        this.pending.add(rel.split(path.sep).join('/'));
      }
      schedule();
    };
    const collectStructural = () => {
      this.structural = true;
      schedule();
    };

    this.watcher
      .on('add', collect)
      .on('change', collect)
      .on('unlink', collect)
      .on('addDir', collectStructural)
      .on('unlinkDir', collectStructural)
      .on('error', (err) => logger.warn('workspace watcher error', err));
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.structural = false;
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
