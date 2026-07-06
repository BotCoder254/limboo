/**
 * Resume Manager — the "continue exactly where you left off" orchestrator.
 *
 * The Claude Agent SDK resumes the *conversation* (via `options.resume`), but
 * conversation history says nothing about how the repository evolved while a
 * session was suspended. This manager closes that gap as a platform service
 * owned by the app (like Memory/Search): it records a repository anchor per
 * session (**snapshot**: HEAD + branch + a dirty-state hash) at meaningful
 * moments, **revalidates** the repo against that anchor on every session
 * activation (cheap short-circuit when nothing changed), computes a structured
 * **repository delta** when it diverged, and hands the AgentManager a one-shot
 * `<repository-delta>` block for the next prompt.
 *
 * Never blocks session switching: revalidation is async, deadline-bounded, and
 * best-effort — any failure degrades to "no delta". Security (CLAUDE.md §6):
 * argv-only git through the shared runner, parameterized SQL only, lstat calls
 * guarded by `isInsideRoot`, and no commit subjects/paths in the logs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { FS_LIMITS, RESUME_LIMITS } from '@shared/constants';
import type { RepoDelta, ResumeState, Session } from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { SessionManager } from '../SessionManager';
import type { WorkspaceManager } from '../WorkspaceManager';
import { gitText, runGit } from '../git/exec';
import { isInsideRoot } from '../workspace/validate';
import {
  computeRepoDelta,
  parsePorcelainZ,
  renderDeltaBlock,
  summarizeDelta,
  type DirtyEntry,
  type RepoAnchor,
} from './delta';

interface SnapshotRow {
  session_id: string;
  workspace_id: string;
  root: string;
  head: string | null;
  branch: string | null;
  dirty_hash: string;
  dirty_files: string;
  reason: string;
  created_at: number;
  updated_at: number;
}

interface DeltaRow {
  session_id: string;
  status: string;
  delta: string;
  created_at: number;
}

/**
 * The subset of the Search Engine the resume delta uses for code-intelligence
 * enrichment. A minimal interface keeps this manager decoupled from the full
 * SearchManager surface (and off any import cycle).
 */
interface SearchIndex {
  indexFiles(workspaceId: string, relPaths: string[]): Promise<void>;
  symbolIdentitiesForPath(workspaceId: string, relPath: string): Set<string>;
  importerCount(workspaceId: string, refPath: string): number;
}

/**
 * The subset of the Memory System the resume delta uses: downgrade memories
 * whose linked files vanished, restore them when the files return.
 */
interface MemoryRevalidation {
  downgradeForMissingFiles(
    workspaceId: string | null,
    paths: string[],
  ): { id: string; title: string }[];
  restoreForPresentFiles(workspaceId: string | null, paths: string[]): void;
}

/** Files whose symbols/imports we bother to diff (skip generated noise). */
const INDEXABLE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|scala|cs|c|cc|cpp|h|hpp)$/i;

/** `kind:name` symbol identity → bare name for display. */
function nameOf(identity: string): string {
  const colon = identity.indexOf(':');
  return colon >= 0 ? identity.slice(colon + 1) : identity;
}

export class ResumeManager {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly sessions: SessionManager,
    private readonly settings: SettingsManager,
  ) {}

  private get db(): Database.Database {
    return getDb();
  }

  /* --------------------------------------------------------------- wiring */

  /** Session → effective execution root (worktree-aware), injected at boot. */
  private resolveSessionRoot: ((sessionId: string) => string | null) | null = null;

  setSessionRootResolver(resolve: (sessionId: string) => string | null): void {
    this.resolveSessionRoot = resolve;
  }

  /**
   * Timeline recorder (AgentManager.recordStatus), injected at boot so
   * revalidation results land in the session's activity feed without this
   * manager depending on the AgentManager type.
   */
  private recordStatus: ((sessionId: string, label: string, detail?: string) => void) | null =
    null;

  setStatusRecorder(record: (sessionId: string, label: string, detail?: string) => void): void {
    this.recordStatus = record;
  }

  /** Search Engine, injected at boot (symbol/reference delta enrichment). */
  private search: SearchIndex | null = null;

  setSearchManager(search: SearchIndex): void {
    this.search = search;
  }

  /** Memory System, injected at boot (confidence downgrade/restore). */
  private memory: MemoryRevalidation | null = null;

  setMemoryManager(memory: MemoryRevalidation): void {
    this.memory = memory;
  }

  /* ---------------------------------------------------------------- state */

  /** Live revalidation phase per session (in-memory; deltas persist in SQLite). */
  private readonly states = new Map<string, ResumeState>();
  private prevActiveId: string | null = null;

  getState(sessionId: string): ResumeState {
    return this.states.get(sessionId) ?? { sessionId, phase: 'idle' };
  }

  /** The persisted delta (pending OR injected) so the detail view keeps working. */
  getDelta(sessionId: string): RepoDelta | null {
    const row = this.db
      .prepare(`SELECT * FROM resume_deltas WHERE session_id = ? AND status IN ('pending','injected')`)
      .get(sessionId) as DeltaRow | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.delta) as RepoDelta;
    } catch {
      return null;
    }
  }

  /** User dismissed the banner — the pending delta will not be injected. */
  dismiss(sessionId: string): void {
    this.db
      .prepare(`UPDATE resume_deltas SET status = 'dismissed' WHERE session_id = ? AND status = 'pending'`)
      .run(sessionId);
    this.setState({ sessionId, phase: 'clean' });
  }

  private setState(state: ResumeState): void {
    this.states.set(state.sessionId, state);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.resumeStateChanged, state);
    }
  }

  /* ---------------------------------------------------------- entry points */

  /** Boot: revalidate the session that comes back active (after worktree recovery). */
  onBoot(): void {
    const active = this.sessions.getActive();
    this.prevActiveId = active?.id ?? null;
    if (active) void this.revalidate(active.id);
  }

  /**
   * Session switch: anchor the session we're leaving, then revalidate the one
   * we're entering. Fire-and-forget — never blocks the switch.
   */
  onActiveSessionChanged(active: Session | null): void {
    const prev = this.prevActiveId;
    this.prevActiveId = active?.id ?? null;
    if (prev && prev !== active?.id) void this.captureSnapshot(prev, 'deactivate');
    if (active && prev !== active.id) void this.revalidate(active.id);
  }

  /** End of an agent run: refresh the anchor (the agent may have changed the repo). */
  onRunFinished(sessionId: string): void {
    void this.captureSnapshot(sessionId, 'run-end');
  }

  /** A checkpoint was created: the working tree is a state worth anchoring. */
  onCheckpointCreated(sessionId: string): void {
    void this.captureSnapshot(sessionId, 'checkpoint');
  }

  /* ------------------------------------------------------------- snapshots */

  /** Read the repo's current anchor (head + branch + dirty hash) at `root`. */
  private async readAnchor(root: string): Promise<RepoAnchor> {
    const head = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
    const branchRaw = await gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : null;
    let dirtyEntries: DirtyEntry[] = [];
    let dirtyHash = '';
    if (head) {
      const status = await runGit(root, ['status', '--porcelain=v1', '-z']);
      if (status.ok) {
        const all = parsePorcelainZ(status.stdout, RESUME_LIMITS.maxDirtyEntries + 1);
        const overflowed = all.length > RESUME_LIMITS.maxDirtyEntries;
        dirtyEntries = all.slice(0, RESUME_LIMITS.maxDirtyEntries);
        dirtyHash = this.hashDirty(root, dirtyEntries, overflowed ? all.length : undefined);
      }
    }
    return { head: head || null, branch, dirtyHash, dirtyEntries };
  }

  /**
   * A cheap content-drift detector for an already-dirty tree: sha256 over the
   * sorted `status\0path\0size\0mtimeMs` lines. No file contents are read;
   * every lstat target is validated inside the root first.
   */
  private hashDirty(root: string, entries: DirtyEntry[], overflowCount?: number): string {
    if (entries.length === 0 && !overflowCount) return '';
    const lines: string[] = [];
    for (const e of entries) {
      let size = 0;
      let mtime = 0;
      const abs = path.resolve(root, e.path);
      if (isInsideRoot(root, abs)) {
        try {
          const st = fs.lstatSync(abs);
          size = st.size;
          mtime = st.mtimeMs;
        } catch {
          /* deleted / unreadable — the zero entry still contributes */
        }
      }
      lines.push(`${e.status}\0${e.path}\0${size}\0${mtime}`);
    }
    lines.sort();
    if (overflowCount) lines.push(`overflow:${overflowCount}`);
    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  }

  /** Record the session's repository anchor. Best-effort — never throws. */
  async captureSnapshot(sessionId: string, reason: string): Promise<void> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const root = this.resolveSessionRoot?.(sessionId) ?? this.workspaceRoot(session.workspaceId);
      if (!root) return;
      const anchor = await this.readAnchor(root);
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO session_snapshots
             (session_id, workspace_id, root, head, branch, dirty_hash, dirty_files, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             root = excluded.root,
             head = excluded.head,
             branch = excluded.branch,
             dirty_hash = excluded.dirty_hash,
             dirty_files = excluded.dirty_files,
             reason = excluded.reason,
             updated_at = excluded.updated_at`,
        )
        .run(
          sessionId,
          session.workspaceId,
          root,
          anchor.head,
          anchor.branch,
          anchor.dirtyHash,
          JSON.stringify(
            anchor.dirtyEntries
              .slice(0, RESUME_LIMITS.maxDirtyFilesStored)
              .map((e) => ({ path: e.path, status: e.status })),
          ),
          reason,
          now,
          now,
        );
    } catch (err) {
      logger.warn('resume: snapshot capture failed', err);
    }
  }

  private workspaceRoot(workspaceId: string): string | null {
    const ws = this.workspace.getById(workspaceId);
    return ws?.path ?? null;
  }

  /* ----------------------------------------------------------- revalidation */

  /**
   * Compare the repo against the session's snapshot; publish a delta when they
   * diverged. Deadline-bounded and best-effort: a timeout or git failure lands
   * on phase 'idle' — never an error surface, never a blocked switch.
   */
  async revalidate(sessionId: string): Promise<void> {
    const cfg = this.settings.getAll().resume;
    if (!cfg.enabled) return;
    try {
      await Promise.race([
        this.revalidateInner(sessionId, cfg.maxCommitsInDelta, cfg.staleThresholdDays),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('revalidate timeout')), RESUME_LIMITS.revalidateTimeoutMs),
        ),
      ]);
    } catch (err) {
      logger.warn('resume: revalidation degraded to no-delta', err);
      this.setState({ sessionId, phase: 'idle' });
    }
  }

  private async revalidateInner(
    sessionId: string,
    maxCommits: number,
    staleThresholdDays: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const root = this.resolveSessionRoot?.(sessionId) ?? this.workspaceRoot(session.workspaceId);
    if (!root) return;

    const snap = this.db
      .prepare('SELECT * FROM session_snapshots WHERE session_id = ?')
      .get(sessionId) as SnapshotRow | undefined;

    // First-ever activation: bootstrap an anchor, nothing to compare against.
    if (!snap) {
      await this.captureSnapshot(sessionId, 'activate');
      this.setState({ sessionId, phase: 'clean' });
      return;
    }

    // Optional freshness skip (0 = always revalidate).
    if (
      staleThresholdDays > 0 &&
      Date.now() - snap.updated_at < staleThresholdDays * 86_400_000
    ) {
      this.setState({ sessionId, phase: 'clean' });
      return;
    }

    this.setState({ sessionId, phase: 'checking' });

    // Root moved (worktree recreated/detached): the ranges are meaningless.
    if (path.resolve(root) !== path.resolve(snap.root)) {
      const anchor = await this.readAnchor(root);
      const delta = await computeRepoDelta(
        root,
        sessionId,
        { head: null, branch: snap.branch, dirtyHash: snap.dirty_hash, dirtyEntries: [], at: snap.updated_at },
        anchor,
        maxCommits,
      );
      delta.rootChanged = true;
      await this.publishDelta(sessionId, delta);
      await this.captureSnapshot(sessionId, 'revalidate');
      return;
    }

    const current = await this.readAnchor(root);

    // Cheap short-circuit: nothing moved — the overwhelmingly common case.
    if (
      current.head === snap.head &&
      current.branch === snap.branch &&
      current.dirtyHash === snap.dirty_hash
    ) {
      this.db
        .prepare(`DELETE FROM resume_deltas WHERE session_id = ? AND status = 'pending'`)
        .run(sessionId);
      this.setState({ sessionId, phase: 'clean' });
      return;
    }

    // Non-git root (or unborn HEAD) never produces a delta.
    if (!current.head && !snap.head) {
      this.setState({ sessionId, phase: 'clean' });
      return;
    }

    const delta = await computeRepoDelta(
      root,
      sessionId,
      {
        head: snap.head,
        branch: snap.branch,
        dirtyHash: snap.dirty_hash,
        dirtyEntries: [],
        at: snap.updated_at,
      },
      current,
      maxCommits,
    );

    // A dirty-hash-only wobble with no visible change isn't worth surfacing.
    if (
      !delta.headMoved &&
      !delta.branchChanged &&
      !delta.historyRewritten &&
      delta.filesTotal === 0
    ) {
      this.setState({ sessionId, phase: 'clean' });
      await this.captureSnapshot(sessionId, 'revalidate');
      return;
    }

    await this.enrichDelta(session.workspaceId, delta);
    await this.publishDelta(sessionId, delta);
    // Refresh the anchor so the delta is one-shot: the next activation
    // short-circuits clean while the pending row waits for the first prompt.
    await this.captureSnapshot(sessionId, 'revalidate');
  }

  /**
   * Code-intelligence enrichment (Phase B): per-file symbol adds/removes and
   * importer counts for the changed source files. Best-effort — a failure or a
   * disabled search index leaves the delta unenriched. Bounded by the same
   * incremental cap the indexer uses, and only when search is enabled.
   */
  private async enrichDelta(workspaceId: string, delta: RepoDelta): Promise<void> {
    if (!this.search || !this.settings.getAll().search.enabled) return;
    if (delta.rootChanged) return; // no meaningful per-file diff across roots
    try {
      const changed = delta.files
        .filter((f) => f.status !== 'deleted' && INDEXABLE.test(f.path))
        .map((f) => f.path);
      const deleted = delta.files.filter((f) => f.status === 'deleted').map((f) => f.path);

      // Memory revalidation: linked-file memories whose file vanished get their
      // confidence downgraded; a file that reappeared restores its memories.
      if (this.memory) {
        if (deleted.length > 0) {
          const downgraded = this.memory.downgradeForMissingFiles(workspaceId, deleted);
          if (downgraded.length > 0) delta.downgradedMemories = downgraded.slice(0, 20);
        }
        const present = delta.files
          .filter((f) => f.status === 'added' || f.status === 'modified')
          .map((f) => f.path);
        if (present.length > 0) this.memory.restoreForPresentFiles(workspaceId, present);
      }

      // Importer counts work regardless of index timing (current ref graph).
      const refImpacts: NonNullable<RepoDelta['refImpacts']> = [];
      for (const f of [...changed, ...deleted]) {
        const importers = this.search.importerCount(workspaceId, f);
        if (importers > 0) refImpacts.push({ path: f, importers });
      }
      if (refImpacts.length > 0) {
        refImpacts.sort((a, b) => b.importers - a.importers);
        delta.refImpacts = refImpacts.slice(0, 20);
      }

      // Symbol delta: capture BEFORE from the index, reindex, capture AFTER.
      // Only worthwhile when the changed set is small enough for the indexer.
      if (changed.length === 0 || changed.length > FS_LIMITS.incrementalIndexMax) return;
      const before = new Map<string, Set<string>>();
      for (const p of changed) before.set(p, this.search.symbolIdentitiesForPath(workspaceId, p));
      await this.search.indexFiles(workspaceId, changed);

      const symbols: NonNullable<RepoDelta['symbols']> = [];
      for (const p of changed) {
        const after = this.search.symbolIdentitiesForPath(workspaceId, p);
        const prev = before.get(p) ?? new Set<string>();
        const added = [...after].filter((s) => !prev.has(s)).map(nameOf).slice(0, 40);
        const removed = [...prev].filter((s) => !after.has(s)).map(nameOf).slice(0, 40);
        if (added.length > 0 || removed.length > 0) symbols.push({ path: p, added, removed });
      }
      if (symbols.length > 0) delta.symbols = symbols;
    } catch (err) {
      logger.warn('resume: delta enrichment failed', err);
    }
  }

  private async publishDelta(sessionId: string, delta: RepoDelta): Promise<void> {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO resume_deltas (session_id, status, delta, created_at)
         VALUES (?, 'pending', ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           status = 'pending', delta = excluded.delta, created_at = excluded.created_at`,
      )
      .run(sessionId, JSON.stringify(delta), now);
    const summary = summarizeDelta(delta);
    this.setState({ sessionId, phase: 'delta', summary, deltaAt: now });
    // Counts only — never commit subjects or paths in the log.
    logger.info(
      `resume: delta for session ${sessionId} (${delta.commitsAhead} ahead, ${delta.filesTotal} files)`,
    );
    try {
      this.recordStatus?.(sessionId, 'Repository changed since last visit', summary);
    } catch {
      /* timeline is decoration — never fail revalidation over it */
    }
  }

  /* -------------------------------------------------------------- injection */

  /**
   * Consume the pending delta for a prompt: render the `<repository-delta>`
   * block and mark the row injected (one delta, one block). The AgentManager
   * caches the rendered block on the in-flight run so recovery retries re-use
   * it instead of losing it.
   */
  consumePendingDelta(sessionId: string): string | undefined {
    try {
      const row = this.db
        .prepare(`SELECT * FROM resume_deltas WHERE session_id = ? AND status = 'pending'`)
        .get(sessionId) as DeltaRow | undefined;
      if (!row) return undefined;
      const delta = JSON.parse(row.delta) as RepoDelta;
      const block = renderDeltaBlock(delta);
      this.db
        .prepare(`UPDATE resume_deltas SET status = 'injected' WHERE session_id = ?`)
        .run(sessionId);
      this.setState({ sessionId, phase: 'clean' });
      return block;
    } catch (err) {
      logger.warn('resume: delta consumption failed', err);
      return undefined;
    }
  }
}
