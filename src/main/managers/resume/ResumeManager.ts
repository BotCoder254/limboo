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
import type { RepoDelta, RepoDeltaFile, ResumeState, Session } from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { SessionManager } from '../SessionManager';
import type { WorkspaceManager } from '../WorkspaceManager';
import { gitText, runGit } from '../git/exec';
import { isInsideRoot } from '../workspace/validate';
import { readWorkspaceFile } from '../fs/reader';
import { extractSymbols, type ExtractedSymbol } from '../search/symbols';
import { langForPath } from '../search/query';
import {
  computeRepoDelta,
  isValidHead,
  parsePorcelainZ,
  renderDeltaBlock,
  summarizeDelta,
  type DirtyEntry,
  type PlanItemsContext,
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
  symbolExists(workspaceId: string, relPath: string, name: string): boolean;
  importerCount(workspaceId: string, refPath: string): number;
}

/**
 * The subset of the Memory System the resume delta uses: downgrade memories
 * whose linked files/symbols vanished, restore them when the referents return.
 */
interface MemoryRevalidation {
  downgradeForMissingFiles(
    workspaceId: string | null,
    paths: string[],
  ): { id: string; title: string }[];
  restoreForPresentFiles(workspaceId: string | null, paths: string[]): void;
  listSymbolRefs(workspaceId: string | null): { memoryId: string; ref: string }[];
  downgradeForMissingSymbols(
    workspaceId: string | null,
    refs: string[],
  ): { id: string; title: string }[];
  restoreForPresentSymbols(workspaceId: string | null, refs: string[]): void;
}

/** Files whose symbols/imports we bother to diff (skip generated noise). */
const INDEXABLE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|scala|cs|c|cc|cpp|h|hpp)$/i;

/** `kind:name` symbol identity → bare name for display. */
function nameOf(identity: string): string {
  const colon = identity.indexOf(':');
  return colon >= 0 ? identity.slice(colon + 1) : identity;
}

/** Symbols → `kind:name` → whitespace-normalized signature (first wins). */
function symbolMap(list: ExtractedSymbol[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of list) {
    const key = `${s.kind}:${s.name}`;
    if (!map.has(key)) map.set(key, s.signature.replace(/\s+/g, ' ').trim());
  }
  return map;
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

  /**
   * Unfinished plan/task provider (AgentManager), injected at boot so the
   * injected delta block can carry the session's outstanding checklist.
   */
  private planItemsFor: ((sessionId: string) => PlanItemsContext | null) | null = null;

  setPlanItemsProvider(provide: (sessionId: string) => PlanItemsContext | null): void {
    this.planItemsFor = provide;
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

    await this.enrichDelta(session.workspaceId, root, snap.head, delta);
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
  private async enrichDelta(
    workspaceId: string,
    root: string,
    snapHead: string | null,
    delta: RepoDelta,
  ): Promise<void> {
    if (!this.search || !this.settings.getAll().search.enabled) return;
    if (delta.rootChanged) return; // no meaningful per-file diff across roots
    try {
      const changed = delta.files
        .filter((f) => f.status !== 'deleted' && INDEXABLE.test(f.path))
        .map((f) => f.path);
      const deleted = delta.files.filter((f) => f.status === 'deleted').map((f) => f.path);

      // Reindex the changed set first (bounded like the watcher's incremental
      // pass) so importer counts and symbol-link checks see the current tree.
      const canReindex = changed.length > 0 && changed.length <= FS_LIMITS.incrementalIndexMax;
      if (canReindex) await this.search.indexFiles(workspaceId, changed);

      // Memory revalidation: linked-file memories whose file vanished get their
      // confidence downgraded; a file that reappeared restores its memories.
      const downgraded = new Map<string, { id: string; title: string }>();
      if (this.memory) {
        if (deleted.length > 0) {
          for (const m of this.memory.downgradeForMissingFiles(workspaceId, deleted)) {
            downgraded.set(m.id, m);
          }
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

      // Symbol delta: OLD symbols come from the blob at the snapshot HEAD, NEW
      // symbols from the working tree — deterministic regardless of index
      // timing (the watcher usually reindexed long before revalidation runs).
      const symbols: NonNullable<RepoDelta['symbols']> = [];
      const candidates = delta.files
        .filter((f) => INDEXABLE.test(f.path))
        .slice(0, RESUME_LIMITS.maxSymbolDeltaFiles);
      for (const file of candidates) {
        const diff = await this.symbolDiffForFile(root, snapHead, file);
        if (diff) symbols.push(diff);
      }
      if (symbols.length > 0) delta.symbols = symbols;

      // Symbol-linked memories: right after a fresh reindex, a linked symbol
      // with no index row in its (still-present) file is genuinely gone. A
      // stale index would false-downgrade, so skip when the reindex was.
      if (this.memory && canReindex) {
        const touched = new Set([...changed, ...deleted]);
        const deletedSet = new Set(deleted);
        const missing: string[] = [];
        const present: string[] = [];
        for (const link of this.memory.listSymbolRefs(workspaceId)) {
          const hash = link.ref.lastIndexOf('#');
          if (hash <= 0) continue;
          const file = link.ref.slice(0, hash);
          if (!touched.has(file)) continue;
          const name = link.ref.slice(hash + 1);
          const exists =
            !deletedSet.has(file) && this.search.symbolExists(workspaceId, file, name);
          (exists ? present : missing).push(link.ref);
        }
        if (missing.length > 0) {
          for (const m of this.memory.downgradeForMissingSymbols(workspaceId, missing)) {
            downgraded.set(m.id, m);
          }
        }
        if (present.length > 0) this.memory.restoreForPresentSymbols(workspaceId, present);
      }
      if (downgraded.size > 0) {
        delta.downgradedMemories = [...downgraded.values()].slice(0, 20);
      }
    } catch (err) {
      logger.warn('resume: delta enrichment failed', err);
    }
  }

  /**
   * Blob-vs-worktree symbol diff for one changed file. Best-effort: any
   * unreadable side (gc'd snapshot commit, binary, oversize, vanished file)
   * skips the file rather than emitting a noisy all-added/all-removed diff.
   */
  private async symbolDiffForFile(
    root: string,
    snapHead: string | null,
    file: RepoDeltaFile,
  ): Promise<{ path: string; added: string[]; removed: string[]; changed?: string[] } | null> {
    const lang = langForPath(file.path);

    // OLD side: the blob at the snapshot HEAD (a newly added file has none).
    let oldContent = '';
    if (file.status !== 'added') {
      const blob = await this.oldBlobText(root, snapHead, file.oldPath ?? file.path);
      if (blob === null) return null;
      oldContent = blob;
    }

    // NEW side: the working tree via the guarded reader (empty when deleted).
    let newContent = '';
    if (file.status !== 'deleted') {
      try {
        const read = readWorkspaceFile(root, file.path);
        if (read.isBinary || read.tooLarge || typeof read.content !== 'string') return null;
        if (read.content.length > RESUME_LIMITS.maxSymbolFileBytes) return null;
        newContent = read.content;
      } catch {
        return null; // vanished since the range diff — skip
      }
    }

    const before = symbolMap(extractSymbols(oldContent, lang));
    const after = symbolMap(extractSymbols(newContent, lang));
    const cap = RESUME_LIMITS.maxSymbolsPerFile;
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const [key, sig] of after) {
      if (!before.has(key)) {
        if (added.length < cap) added.push(nameOf(key));
      } else if (before.get(key) !== sig && changed.length < cap) {
        changed.push(nameOf(key));
      }
    }
    for (const key of before.keys()) {
      if (!after.has(key) && removed.length < cap) removed.push(nameOf(key));
    }
    if (added.length === 0 && removed.length === 0 && changed.length === 0) return null;
    return {
      path: file.path,
      added,
      removed,
      changed: changed.length > 0 ? changed : undefined,
    };
  }

  /**
   * Read a file's content as it was at the snapshot HEAD (`git show hash:path`,
   * argv-only). The hash is regex-validated and the path re-guarded (bounded,
   * relative, no traversal, no leading `-`) before either enters the argv;
   * `maxBuffer` doubles as the size cap. Returns null on any failure — a gc'd
   * snapshot commit, a path absent at that commit, binary, or oversize.
   */
  private async oldBlobText(
    root: string,
    snapHead: string | null,
    relPath: string,
  ): Promise<string | null> {
    if (!isValidHead(snapHead)) return null;
    if (
      typeof relPath !== 'string' ||
      relPath.length === 0 ||
      relPath.length > 4096 ||
      relPath.startsWith('-') ||
      relPath.includes('\0') ||
      path.isAbsolute(relPath) ||
      relPath.split('/').includes('..')
    ) {
      return null;
    }
    const r = await runGit(root, ['show', `${snapHead}:${relPath}`], {
      maxBuffer: RESUME_LIMITS.maxSymbolFileBytes,
    });
    if (!r.ok) return null;
    if (r.stdout.slice(0, 8000).includes('\0')) return null; // binary sniff
    return r.stdout;
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
      let planItems: PlanItemsContext | null = null;
      try {
        planItems = this.planItemsFor?.(sessionId) ?? null;
      } catch {
        /* plan context is decoration — never lose the delta over it */
      }
      const block = renderDeltaBlock(delta, planItems);
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
