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
import path from 'node:path';
import { BrowserWindow, shell } from 'electron';
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
import type { SessionManager } from './SessionManager';
import { buildIgnoreMatcher, type IgnoreMatcher } from './fs/ignore';
import { buildTree } from './fs/tree';
import { readWorkspaceFile } from './fs/reader';
import { FileHistory } from './fs/history';
import { WorkspaceWatcher } from './fs/watcher';
import { gitStatus } from './git/status';
import type { GitManager } from './GitManager';
import type { SearchManager } from './search/SearchManager';
import { isInsideRoot } from './workspace/validate';

export class FileSystemManager {
  private readonly trees = new Map<string, FileTree>();
  private readonly histories = new Map<string, FileHistory>();
  /** In-flight index passes, keyed by workspace id — concurrent callers await this. */
  private readonly indexing = new Map<string, Promise<FileTree>>();

  /** Exactly one watcher, bound to the currently active workspace. */
  private activeWatcher: WorkspaceWatcher | null = null;
  private activeWatchId: string | null = null;

  /** Sessions sink for live git status; wired after construction. */
  private sessions: SessionManager | null = null;
  /** Git Manager to notify (git workspace refresh) on working-tree changes. */
  private git: GitManager | null = null;
  /** Search Manager to (re)index as the working tree changes. */
  private search: SearchManager | null = null;
  /** Last broadcast git key per workspace, so unchanged status is a no-op. */
  private readonly lastGitKey = new Map<string, string>();

  constructor(private readonly workspace: WorkspaceManager) {}

  /** Inject the Session Manager that mirrors live git status into session rows. */
  setSessionManager(sessions: SessionManager): void {
    this.sessions = sessions;
  }

  /** Inject the Git Manager so the watcher can refresh the Git workspace live. */
  setGitManager(git: GitManager): void {
    this.git = git;
  }

  /** Inject the Search Manager so the index is rebuilt as the tree changes. */
  setSearchManager(search: SearchManager): void {
    this.search = search;
  }

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

  /**
   * Reveal a workspace path in the OS file manager. With no `relPath` (or an empty
   * one) the workspace root folder is opened; otherwise the target file/dir is
   * highlighted. The resolved path is guarded to stay inside the workspace root
   * (CLAUDE.md §6 path-traversal rule) before any shell call.
   */
  async reveal(workspaceId: string, relPath?: string): Promise<void> {
    const ws = this.requireWorkspace(workspaceId);
    const rel = (relPath ?? '').trim();
    if (!rel) {
      await shell.openPath(ws.path);
      return;
    }
    const target = path.resolve(ws.path, rel);
    if (!isInsideRoot(ws.path, target)) {
      throw new Error('fs:reveal target is outside the workspace');
    }
    shell.showItemInFolder(target);
  }

  /* --------------------------------------------------------- indexing */

  /**
   * (Re)build the directory tree for a workspace, streaming progress and pushing
   * the finished tree to every window. Concurrent calls for the same workspace
   * are coalesced — the in-flight pass is returned/awaited instead of duplicated.
   */
  async index(workspaceId: string): Promise<FileTree> {
    // Resolve the workspace up front so a bad id throws to the direct caller
    // before any promise is registered.
    const ws = this.requireWorkspace(workspaceId);

    // Coalesce concurrent calls onto the SAME in-flight pass, so every caller
    // awaits — and receives — the identical fresh tree (never a stale cache).
    const inFlight = this.indexing.get(workspaceId);
    if (inFlight) return inFlight;

    const run = this.runIndex(ws, workspaceId);
    this.indexing.set(workspaceId, run);
    try {
      return await run;
    } finally {
      this.indexing.delete(workspaceId);
    }
  }

  /** The actual index pass; only ever invoked through {@link index}'s coalescer. */
  private async runIndex(ws: Workspace, workspaceId: string): Promise<FileTree> {
    const started = Date.now();
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
    // Seed the live git status (branch + diff) for the sidebar.
    this.refreshGitStatus(ws);
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
    // Recompute live git status (branch may have switched; diff counts moved).
    const ws = this.workspace.getById(workspaceId);
    if (ws) this.refreshGitStatus(ws);
    // Refresh the Git workspace (status/diff lists) live as the tree changes.
    this.git?.notifyChanged(workspaceId);
    // Rebuild the search index (coalesced; off the hot path — errors are logged).
    void this.search?.indexWorkspace(workspaceId).catch((err) =>
      logger.warn('search reindex on change failed', err),
    );
  }

  /**
   * Compute the workspace's git status and push it into its session rows. Deduped
   * against the last broadcast so a watcher burst that didn't move git is a no-op.
   */
  private refreshGitStatus(ws: Workspace): void {
    if (!this.sessions) return;
    try {
      const status = gitStatus(ws.path);
      const key = `${status.branch ?? ''}|${status.adds}|${status.dels}`;
      if (this.lastGitKey.get(ws.id) === key) return;
      this.lastGitKey.set(ws.id, key);
      this.sessions.applyGitStatus(ws.id, status);
    } catch (err) {
      logger.warn('git status refresh failed', err);
    }
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
