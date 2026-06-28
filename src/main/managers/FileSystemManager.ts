/**
 * File System Manager — the single authoritative gateway through which every
 * workspace file operation passes (the File Explorer Service of CLAUDE.md §8).
 * Lives in the main process; the renderer and agent reach it only via IPC.
 *
 * Responsibilities (read + watch + index foundation): build & cache the directory
 * tree, read files through the centralized reader, watch the active workspace for
 * external changes, maintain per-workspace File History, and broadcast progress +
 * tree-changed events to every window. Mutating operations (write/create/delete/
 * rename/move/copy) are intentionally NOT implemented here yet — they are gated
 * behind the future Permission Engine.
 *
 * Security (CLAUDE.md §6): all path/boundary/symlink/ignore/cap enforcement lives
 * in the modules under `fs/`; this class never logs file contents and disposes
 * the watcher when the active workspace changes (no leaked watchers).
 */
import { BrowserWindow } from 'electron';
import { IpcEvents } from '@shared/ipc-channels';
import type {
  FileHistoryEntry,
  FileReadResult,
  FileTree,
  IndexProgress,
  Workspace,
} from '@shared/types';
import { logger } from '../logger';
import type { WorkspaceManager } from './WorkspaceManager';
import { buildIgnoreMatcher, type IgnoreMatcher } from './fs/ignore';
import { buildTree } from './fs/tree';
import { readWorkspaceFile } from './fs/reader';
import { FileHistory } from './fs/history';
import { WorkspaceWatcher } from './fs/watcher';

export class FileSystemManager {
  private readonly trees = new Map<string, FileTree>();
  private readonly histories = new Map<string, FileHistory>();
  private readonly indexing = new Set<string>();

  /** Exactly one watcher, bound to the currently active workspace. */
  private activeWatcher: WorkspaceWatcher | null = null;
  private activeWatchId: string | null = null;

  constructor(private readonly workspace: WorkspaceManager) {}

  /* ----------------------------------------------------------- reads */

  /** Last-built tree for a workspace, if any (no disk access). */
  getTree(workspaceId: string): FileTree | null {
    return this.trees.get(workspaceId) ?? null;
  }

  /** Read a workspace-relative file through the centralized, guarded reader. */
  readFile(workspaceId: string, relPath: string): FileReadResult {
    const ws = this.requireWorkspace(workspaceId);
    const result = readWorkspaceFile(ws.path, relPath);
    this.historyFor(workspaceId).record(result.path, 'read');
    return result;
  }

  /** Most-recent-first File History snapshot for a workspace. */
  getHistory(workspaceId: string): FileHistoryEntry[] {
    return this.histories.get(workspaceId)?.list() ?? [];
  }

  /* --------------------------------------------------------- indexing */

  /**
   * (Re)build the directory tree for a workspace, streaming progress and pushing
   * the finished tree to every window. Concurrent calls for the same workspace
   * are coalesced — the in-flight pass is returned/awaited instead of duplicated.
   */
  async index(workspaceId: string): Promise<FileTree> {
    const ws = this.requireWorkspace(workspaceId);
    if (this.indexing.has(workspaceId)) {
      return this.trees.get(workspaceId) ?? this.emptyTree(workspaceId);
    }
    this.indexing.add(workspaceId);
    const started = Date.now();
    try {
      const matcher = this.matcherFor(ws);
      this.historyFor(workspaceId).record('', 'index');
      const tree = await buildTree({
        workspaceId,
        root: ws.path,
        matcher,
        onProgress: (p) => this.broadcastProgress(p),
      });
      this.trees.set(workspaceId, tree);
      this.broadcastTree(tree);
      logger.info(
        `Workspace indexed: ${ws.name} — ${tree.nodeCount} nodes in ${Date.now() - started}ms` +
          (tree.truncated ? ' (truncated)' : ''),
      );
      return tree;
    } finally {
      this.indexing.delete(workspaceId);
    }
  }

  /* ------------------------------------------------ active workspace */

  /**
   * Point the File System Layer at the active workspace: dispose any prior
   * watcher, start watching the new root, and kick off a fresh index. Called
   * whenever the active workspace changes (open / switch / clear).
   */
  setActiveWorkspace(ws: Workspace | null): void {
    if (this.activeWatchId === (ws?.id ?? null)) return;
    void this.stopWatching();
    if (!ws) return;

    this.activeWatchId = ws.id;
    this.activeWatcher = new WorkspaceWatcher({
      root: ws.path,
      matcher: this.matcherFor(ws),
      onChange: () => this.onWatchedChange(ws.id),
    });
    this.activeWatcher.start();

    // Auto-index on activation (errors are logged, never thrown to the caller).
    void this.index(ws.id).catch((err) => logger.warn('auto-index failed', err));
  }

  /** Stop watching the active workspace (idempotent). */
  async stopWatching(): Promise<void> {
    this.activeWatchId = null;
    if (this.activeWatcher) {
      const w = this.activeWatcher;
      this.activeWatcher = null;
      await w.stop();
    }
  }

  /** Release all watchers/caches on shutdown. */
  async dispose(): Promise<void> {
    await this.stopWatching();
    this.trees.clear();
    this.histories.clear();
  }

  /* --------------------------------------------------------- internals */

  private onWatchedChange(workspaceId: string): void {
    this.historyFor(workspaceId).record('', 'change');
    // A change burst settled — rebuild and re-push the tree. Re-indexing also
    // re-emits progress, which the UI treats as a brief refresh.
    void this.index(workspaceId).catch((err) => logger.warn('reindex on change failed', err));
  }

  private matcherFor(ws: Workspace): IgnoreMatcher {
    return buildIgnoreMatcher(ws.path, ws.config);
  }

  private historyFor(workspaceId: string): FileHistory {
    let history = this.histories.get(workspaceId);
    if (!history) {
      history = new FileHistory();
      this.histories.set(workspaceId, history);
    }
    return history;
  }

  private requireWorkspace(workspaceId: string): Workspace {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
    return ws;
  }

  private emptyTree(workspaceId: string): FileTree {
    return {
      workspaceId,
      root: { path: '', name: '', type: 'dir', children: [] },
      nodeCount: 0,
      truncated: false,
      builtAt: Date.now(),
    };
  }

  private broadcastProgress(progress: IndexProgress): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.fsIndexProgress, progress);
    }
  }

  private broadcastTree(tree: FileTree): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.fsTreeChanged, tree);
    }
  }
}
