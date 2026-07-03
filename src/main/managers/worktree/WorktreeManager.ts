/**
 * Worktree Manager — first-class git worktrees for the Session System.
 *
 * A worktree-backed session is an isolated engineering environment: its own
 * checkout directory + its own branch, provisioned via `git worktree add`, so
 * multiple sessions (and their agents, terminals, and services) can proceed in
 * parallel without contending for one working tree. This manager owns the
 * worktree lifecycle (create / remove / prune / recover) and is the single
 * resolver of a session's *effective execution root* — every other manager
 * (agent cwd, terminal cwd, git root, file watcher, search scope) asks
 * {@link resolveSessionRoot} / {@link resolveActiveRoot} instead of deriving
 * paths itself.
 *
 * Layout (Paseo-style): `{root}/{repoBucket}/{slug}` under a configurable root
 * (default `{userData}/worktrees`), branch `{prefix}/{slug}` unless the caller
 * names one. See `worktree/paths.ts` for the containment guards.
 *
 * Security (CLAUDE.md §6): all git runs go through {@link runGit} (argv-only,
 * fixed cwd, env-hardened, bounded). Branch/base refs pass {@link sanitizeRef};
 * slugs are generated main-side only; every created/removed path passes
 * {@link assertInsideWorktreeRoot} before the filesystem is touched — the
 * recursive-delete fallback can never run outside the worktree root.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { WORKTREE_LIMITS } from '@shared/constants';
import type {
  RepoConfigState,
  Session,
  SessionDependencies,
  TerminalSession,
  WorktreeInfo,
} from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SessionManager } from '../SessionManager';
import type { WorkspaceManager } from '../WorkspaceManager';
import type { SettingsManager } from '../SettingsManager';
import { gitText, runGit } from '../git/exec';
import { sanitizeRef } from '../git/refs';
import { assertInsideWorktreeRoot, newSlug, repoBucket, worktreeRootDir } from './paths';
import { hashRepoConfig, readRepoConfig } from './config';

/** Narrow view of the TerminalManager the worktree lifecycle needs. */
interface TerminalOwner {
  disposeSession(sessionId: string): void;
  countForSession(sessionId: string): number;
  kill(terminalId: string): void;
  createForCommand(opts: {
    workspaceId: string;
    sessionId: string;
    cwd: string;
    command: string;
    title: string;
    origin: 'hook' | 'service';
    env?: Record<string, string>;
    onExit?: (exitCode: number) => void;
  }): TerminalSession;
}

/** Narrow view of the ServiceManager (stop supervised services pre-removal). */
interface ServiceOwner {
  stopForSession(sessionId: string): Promise<void>;
}

export interface WorktreeCreateOptions {
  /** Ref the new branch starts from (default: the repo's current HEAD). */
  baseRef?: string;
  /** Explicit branch name (default: `{prefix}/{slug}`). */
  branch?: string;
}

export interface WorktreeRemoveOptions {
  /** Remove even when the worktree has uncommitted changes. */
  force?: boolean;
  /** Delete the worktree branch too (default: keep it). */
  deleteBranch?: boolean;
  /**
   * Keep `worktree_branch` + `base_ref` on the session after removal (archive
   * flow — restore can recreate the worktree from the same branch/base).
   */
  preserveBranchMeta?: boolean;
}

export class WorktreeManager {
  private terminals?: TerminalOwner;
  /**
   * Called just before a worktree directory is removed so the composition root
   * can retarget the file watcher / search index away from it (open handles
   * inside the tree make `git worktree remove` fail with EBUSY on Windows).
   */
  private releaseRoot?: (session: Session) => Promise<void> | void;

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly sessions: SessionManager,
    private readonly settings: SettingsManager,
  ) {}

  setTerminalManager(terminals: TerminalOwner): void {
    this.terminals = terminals;
  }

  private services?: ServiceOwner;

  setServiceManager(services: ServiceOwner): void {
    this.services = services;
  }

  setReleaseRootHook(cb: (session: Session) => Promise<void> | void): void {
    this.releaseRoot = cb;
  }

  private get db(): Database.Database {
    return getDb();
  }

  /* -------------------------------------------------------- root resolution */

  /**
   * The session's effective execution root: its worktree when it owns a healthy
   * one, otherwise the owning workspace's path. Null when the session (or its
   * workspace) is unknown.
   */
  resolveSessionRoot(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.worktreePath && session.worktreeStatus === 'ready') {
      if (safeIsDir(session.worktreePath)) return session.worktreePath;
      // Directory vanished underneath us — flag it so the UI can offer recovery.
      this.markMissing(session.id);
    }
    return this.workspace.getById(session.workspaceId)?.path ?? null;
  }

  /**
   * The effective root for a workspace right now: the active session's worktree
   * when the active session belongs to this workspace and is worktree-backed,
   * else the workspace path. Null when the workspace is unknown.
   */
  resolveActiveRoot(workspaceId: string): string | null {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) return null;
    const active = this.sessions.getActive();
    if (active && active.workspaceId === workspaceId && active.worktreePath) {
      if (active.worktreeStatus === 'ready' && safeIsDir(active.worktreePath)) {
        return active.worktreePath;
      }
      if (active.worktreeStatus === 'ready') this.markMissing(active.id);
    }
    return ws.path;
  }

  /* --------------------------------------------------------------- create */

  /** Provision a dedicated worktree (directory + branch) for a session. */
  async createForSession(sessionId: string, opts: WorktreeCreateOptions = {}): Promise<Session> {
    const settings = this.settings.getAll();
    if (!settings.git.worktrees.enabled) throw new Error('Worktrees are disabled in Settings › Git');

    const session = this.sessions.get(sessionId);
    if (!session || session.deletedAt !== null) throw new Error('Session not found');
    if (session.worktreePath) throw new Error('Session already owns a worktree');

    const repoRoot = await this.repoRootFor(session.workspaceId);
    if (!repoRoot) throw new Error('The workspace is not a git repository');

    const owned = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ? AND worktree_path IS NOT NULL',
      )
      .get(session.workspaceId) as { n: number };
    if (owned.n >= WORKTREE_LIMITS.maxPerRepo) {
      throw new Error(`Worktree limit reached (${WORKTREE_LIMITS.maxPerRepo} per repository)`);
    }

    const root = worktreeRootDir(settings);
    const bucket = path.join(root, repoBucket(repoRoot));
    const slug = newSlug();
    const target = assertInsideWorktreeRoot(root, path.join(bucket, slug));
    fs.mkdirSync(bucket, { recursive: true });

    const prefix = settings.git.worktrees.branchPrefix;
    const branch = sanitizeRef(opts.branch?.trim() || `${prefix}/${slug}`);
    const baseRef = opts.baseRef?.trim() ? sanitizeRef(opts.baseRef.trim()) : null;

    this.sessions.setWorktree(sessionId, {
      worktreePath: target,
      worktreeBranch: branch,
      worktreeStatus: 'creating',
      baseRef,
    });

    const args = ['worktree', 'add', '-b', branch, target];
    if (baseRef) args.push(baseRef);
    const res = await runGit(repoRoot, args, { timeout: WORKTREE_LIMITS.gitTimeoutMs });

    if (!res.ok) {
      // Roll the session back to a plain (non-worktree) session — creation is
      // atomic from the user's perspective.
      this.sessions.setWorktree(sessionId, {
        worktreePath: null,
        worktreeBranch: null,
        worktreeStatus: 'none',
        baseRef: null,
      });
      throw new Error(classifyWorktreeAddError(res.stderr, branch));
    }

    const updated = this.sessions.setWorktree(sessionId, {
      worktreePath: target,
      worktreeBranch: branch,
      worktreeStatus: 'ready',
      baseRef,
    });
    logger.info(`Worktree created for session ${sessionId}: ${path.basename(target)} (${branch})`);
    this.broadcast();
    return updated;
  }

  /* --------------------------------------------------------------- remove */

  /**
   * Tear down a session's worktree. Windows-safe order: kill the session's
   * PTYs → retarget any watcher off the directory → `git worktree remove` →
   * retry once on a busy tree → guarded `fs.rm` fallback → optional branch
   * delete → clear the session's worktree columns.
   */
  async removeForSession(sessionId: string, opts: WorktreeRemoveOptions = {}): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.worktreePath) return;
    const target = session.worktreePath;
    const branch = session.worktreeBranch;
    const repoRoot = await this.repoRootFor(session.workspaceId);

    this.sessions.setWorktree(sessionId, {
      worktreePath: target,
      worktreeBranch: branch,
      worktreeStatus: 'removing',
    });

    try {
      // Supervised services + PTYs first — open handles inside the worktree
      // keep `git worktree remove` failing with EBUSY on Windows.
      await this.services?.stopForSession(sessionId).catch(() => undefined);
      // Teardown hooks run best-effort while the directory still exists — but
      // ONLY when the workspace has acknowledged this exact repo config.
      await this.runTeardownIfAcked(sessionId).catch((err) =>
        logger.warn('worktree teardown hooks failed', err),
      );
      this.terminals?.disposeSession(sessionId);
      await this.releaseRoot?.(session);

      if (repoRoot) {
        const args = ['worktree', 'remove'];
        if (opts.force) args.push('--force');
        args.push(target);
        let res = await runGit(repoRoot, args, { timeout: WORKTREE_LIMITS.gitTimeoutMs });
        if (!res.ok && isBusy(res.stderr)) {
          await delay(250);
          res = await runGit(repoRoot, args, { timeout: WORKTREE_LIMITS.gitTimeoutMs });
        }
        if (!res.ok) {
          if (/contains modified or untracked files/i.test(res.stderr) && !opts.force) {
            // Surface the dirty tree instead of silently forcing.
            this.sessions.setWorktree(sessionId, {
              worktreePath: target,
              worktreeBranch: branch,
              worktreeStatus: 'ready',
            });
            throw new Error('Worktree has uncommitted changes — confirm removal to discard them');
          }
          // Fall back: prune the admin files, then delete the directory — but
          // only after the containment guard re-validates the target.
          await runGit(repoRoot, ['worktree', 'prune'], { timeout: WORKTREE_LIMITS.gitTimeoutMs });
          const settings = this.settings.getAll();
          const guarded = assertInsideWorktreeRoot(worktreeRootDir(settings), target);
          fs.rmSync(guarded, { recursive: true, force: true, maxRetries: 2 });
          await runGit(repoRoot, ['worktree', 'prune'], { timeout: WORKTREE_LIMITS.gitTimeoutMs });
        }

        if (opts.deleteBranch && branch) {
          try {
            const del = await runGit(repoRoot, ['branch', '-D', sanitizeRef(branch)]);
            if (!del.ok) logger.warn(`Worktree branch delete failed: ${del.stderr.slice(0, 200)}`);
          } catch (err) {
            logger.warn('Worktree branch delete failed', err);
          }
        }
      } else if (safeIsDir(target)) {
        // Repo itself is gone; still reclaim the directory (guarded).
        const guarded = assertInsideWorktreeRoot(worktreeRootDir(this.settings.getAll()), target);
        fs.rmSync(guarded, { recursive: true, force: true, maxRetries: 2 });
      }

      this.sessions.setWorktree(sessionId, {
        worktreePath: null,
        worktreeBranch: opts.preserveBranchMeta && !opts.deleteBranch ? branch : null,
        worktreeStatus: 'none',
        baseRef: opts.preserveBranchMeta ? undefined : null,
      });
      logger.info(`Worktree removed for session ${sessionId}`);
      this.broadcast();
    } catch (err) {
      // Leave the session in a recoverable state on unexpected failure.
      const current = this.sessions.get(sessionId);
      if (current?.worktreeStatus === 'removing') {
        this.sessions.setWorktree(sessionId, {
          worktreePath: target,
          worktreeBranch: branch,
          worktreeStatus: safeIsDir(target) ? 'ready' : 'missing',
        });
      }
      throw err;
    }
  }

  /* ------------------------------------------------------------ list/prune */

  /** All worktrees of the workspace's repo, joined to the sessions owning them. */
  async list(workspaceId: string): Promise<WorktreeInfo[]> {
    const repoRoot = await this.repoRootFor(workspaceId);
    if (!repoRoot) return [];
    const res = await runGit(repoRoot, ['worktree', 'list', '--porcelain'], {
      timeout: WORKTREE_LIMITS.gitTimeoutMs,
    });
    if (!res.ok) return [];
    const infos = parseWorktreeList(res.stdout);

    const rows = this.db
      .prepare(
        'SELECT id, title, worktree_path FROM sessions WHERE workspace_id = ? AND worktree_path IS NOT NULL',
      )
      .all(workspaceId) as Array<{ id: string; title: string; worktree_path: string }>;
    const byPath = new Map(rows.map((r) => [path.normalize(r.worktree_path), r]));
    for (const info of infos) {
      const owner = byPath.get(path.normalize(info.path));
      if (owner) {
        info.sessionId = owner.id;
        info.sessionTitle = owner.title;
      }
    }
    return infos;
  }

  /** Drop stale worktree metadata (deleted directories) from the repo. */
  async prune(workspaceId: string): Promise<boolean> {
    const repoRoot = await this.repoRootFor(workspaceId);
    if (!repoRoot) return false;
    const res = await runGit(repoRoot, ['worktree', 'prune'], {
      timeout: WORKTREE_LIMITS.gitTimeoutMs,
    });
    if (res.ok) this.broadcast();
    return res.ok;
  }

  /* -------------------------------------------------------------- recovery */

  /**
   * Boot-time recovery: verify every recorded worktree still exists (flagging
   * `missing` ones for the UI's recreate/detach affordance), and run
   * `git worktree repair` + `prune` once per distinct repository. Best-effort;
   * never throws.
   */
  async recover(): Promise<void> {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, workspace_id, worktree_path, worktree_status FROM sessions
            WHERE worktree_path IS NOT NULL`,
        )
        .all() as Array<{
        id: string;
        workspace_id: string;
        worktree_path: string;
        worktree_status: string;
      }>;
      if (rows.length === 0) return;

      for (const row of rows) {
        const exists = safeIsDir(row.worktree_path);
        if (!exists && (row.worktree_status === 'ready' || row.worktree_status === 'creating')) {
          this.markMissing(row.id);
        } else if (exists && row.worktree_status === 'missing') {
          this.db
            .prepare("UPDATE sessions SET worktree_status = 'ready' WHERE id = ?")
            .run(row.id);
        }
      }

      const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
      for (const wsId of workspaceIds) {
        const repoRoot = await this.repoRootFor(wsId);
        if (!repoRoot) continue;
        await runGit(repoRoot, ['worktree', 'repair'], { timeout: WORKTREE_LIMITS.gitTimeoutMs });
        await runGit(repoRoot, ['worktree', 'prune'], { timeout: WORKTREE_LIMITS.gitTimeoutMs });
      }
      this.broadcast();
    } catch (err) {
      logger.warn('Worktree recovery failed', err);
    }
  }

  /**
   * Recreate a `missing` session worktree at a fresh path from its recorded
   * branch (if it still exists) or its base ref.
   */
  async recreateForSession(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.worktreeStatus !== 'missing' && session.worktreePath) {
      throw new Error('Session worktree is not missing');
    }
    const repoRoot = await this.repoRootFor(session.workspaceId);
    if (!repoRoot) throw new Error('The workspace is not a git repository');

    const branch = session.worktreeBranch;
    let branchExists = false;
    if (branch) {
      const check = await runGit(repoRoot, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${sanitizeRef(branch)}`,
      ]);
      branchExists = check.ok;
    }

    // Clear the stale association, prune admin files, then re-provision. The
    // prior metadata is restored on failure so Recreate stays retryable — a
    // lost branch/base association would orphan the branch's work.
    const prior = {
      worktreePath: session.worktreePath,
      worktreeBranch: session.worktreeBranch,
      worktreeStatus: session.worktreeStatus,
      baseRef: session.baseRef,
    };
    this.sessions.setWorktree(sessionId, {
      worktreePath: null,
      worktreeBranch: null,
      worktreeStatus: 'none',
    });
    await runGit(repoRoot, ['worktree', 'prune'], { timeout: WORKTREE_LIMITS.gitTimeoutMs });

    try {
      if (branch && branchExists) {
        // Re-attach to the surviving branch: create at a fresh slug path with
        // the branch checked out (no -b; the branch already exists).
        const settings = this.settings.getAll();
        const root = worktreeRootDir(settings);
        const bucket = path.join(root, repoBucket(repoRoot));
        const target = assertInsideWorktreeRoot(root, path.join(bucket, newSlug()));
        fs.mkdirSync(bucket, { recursive: true });
        const res = await runGit(repoRoot, ['worktree', 'add', target, sanitizeRef(branch)], {
          timeout: WORKTREE_LIMITS.gitTimeoutMs,
        });
        if (!res.ok) throw new Error(classifyWorktreeAddError(res.stderr, branch));
        const updated = this.sessions.setWorktree(sessionId, {
          worktreePath: target,
          worktreeBranch: branch,
          worktreeStatus: 'ready',
          baseRef: session.baseRef,
        });
        this.broadcast();
        return updated;
      }

      return await this.createForSession(sessionId, {
        baseRef: session.baseRef ?? undefined,
        branch: branch ?? undefined,
      });
    } catch (err) {
      this.sessions.setWorktree(sessionId, prior);
      throw err;
    }
  }

  /** Detach a `missing` worktree association, reverting to a plain session. */
  detachForSession(sessionId: string): Session {
    const updated = this.sessions.setWorktree(sessionId, {
      worktreePath: null,
      worktreeBranch: null,
      worktreeStatus: 'none',
      baseRef: null,
    });
    this.broadcast();
    return updated;
  }

  /* ---------------------------------------------------------- dependencies */

  /** Everything the session owns — shown before permanent deletion. */
  async getDependencies(sessionId: string): Promise<SessionDependencies> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const count = (sql: string): number =>
      (this.db.prepare(sql).get(sessionId) as { n: number }).n;
    const checkpoints = count('SELECT COUNT(*) AS n FROM git_checkpoints WHERE session_id = ?');
    const memoryLinks = count('SELECT COUNT(*) AS n FROM memories WHERE session_id = ?');
    const hasPlan = !!this.db
      .prepare('SELECT 1 AS one FROM agent_plans WHERE session_id = ?')
      .get(sessionId);
    const terminals = this.terminals?.countForSession(sessionId) ?? 0;

    let worktree: SessionDependencies['worktree'] = null;
    if (session.worktreePath) {
      const exists = safeIsDir(session.worktreePath);
      let dirty = false;
      if (exists) {
        const res = await runGit(session.worktreePath, ['status', '--porcelain']);
        dirty = res.ok && res.stdout.trim().length > 0;
      }
      worktree = { path: session.worktreePath, exists, dirty };
    }

    let branch: SessionDependencies['branch'] = null;
    if (session.worktreeBranch) {
      let exists = false;
      const repoRoot = await this.repoRootFor(session.workspaceId);
      if (repoRoot) {
        try {
          const check = await runGit(repoRoot, [
            'rev-parse',
            '--verify',
            '--quiet',
            `refs/heads/${sanitizeRef(session.worktreeBranch)}`,
          ]);
          exists = check.ok;
        } catch {
          exists = false;
        }
      }
      branch = { name: session.worktreeBranch, exists };
    }

    return { worktree, branch, terminals, checkpoints, memoryLinks, hasPlan };
  }

  /* ------------------------------------------------------- hooks + config */

  /**
   * The repo's `limboo.json` (hooks / scripts / services) read from the
   * session's effective root, plus its hash and whether this workspace has
   * already acknowledged it. Repo config is untrusted until acknowledged.
   */
  getRepoConfigState(sessionId: string): RepoConfigState {
    const session = this.sessions.get(sessionId);
    const root = sessionId ? this.resolveSessionRoot(sessionId) : null;
    const config = root ? readRepoConfig(root) : null;
    const hash = hashRepoConfig(config);
    const ws = session ? this.workspace.getById(session.workspaceId) : null;
    const acked = !!hash && ws?.config.hooksAckHash === hash;
    return { config, hash, acked };
  }

  /**
   * Persist the user's acknowledgment of the CURRENT repo config for this
   * session's workspace. `ackHash` must equal the hash of the config the
   * renderer displayed (the confirmation acknowledges those exact commands —
   * an edited limboo.json between display and ack fails closed). Trusting the
   * config is independent of setup hooks: a repo declaring only scripts or
   * services (no setup) is acknowledged the same way, and plain (non-worktree)
   * sessions can ack too.
   */
  ackConfig(sessionId: string, ackHash: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    const state = this.getRepoConfigState(sessionId);
    if (!state.config || !state.hash) throw new Error('No limboo.json in this session');
    if (!ackHash || ackHash !== state.hash) {
      throw new Error('Repo commands changed since they were displayed — review and confirm again');
    }
    this.workspace.updateConfig(session.workspaceId, { hooksAckHash: state.hash });
  }

  /**
   * Acknowledge the repo config, then run its setup hooks in the session's
   * worktree. The ack persists per workspace (via {@link ackConfig}) even when
   * `setup` is empty, so teardown/scripts/services unlock in the same step.
   * (`git.worktrees.autoSetup` only gates the renderer's auto-offer, not this
   * explicit, user-confirmed run.)
   */
  async runSetup(sessionId: string, ackHash: string): Promise<void> {
    const settings = this.settings.getAll();
    if (!settings.git.worktrees.enabled) {
      throw new Error('Worktrees are disabled in Settings › Git');
    }
    const session = this.sessions.get(sessionId);
    if (!session?.worktreePath || session.worktreeStatus !== 'ready') {
      throw new Error('Session has no ready worktree');
    }
    const state = this.getRepoConfigState(sessionId);
    if (!state.config) return;
    this.ackConfig(sessionId, ackHash);
    if (state.config.setup.length === 0) return;
    await this.runHookCommands(session, state.config.setup, 'setup');
  }

  /**
   * Run teardown hooks IFF this workspace previously acknowledged the current
   * repo config — never executes unreviewed repo-authored commands. Best-effort.
   */
  private async runTeardownIfAcked(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.worktreePath || !safeIsDir(session.worktreePath)) return;
    const state = this.getRepoConfigState(sessionId);
    if (!state.config || state.config.teardown.length === 0) return;
    if (!state.acked) {
      this.diagnostic(sessionId, 'warning', 'Teardown hooks skipped', 'Repo hooks not acknowledged');
      return;
    }
    await this.runHookCommands(session, state.config.teardown, 'teardown');
  }

  /** Archive flow: teardown + remove the directory, keeping branch metadata. */
  async archiveTeardown(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.worktreePath) return;
    await this.removeForSession(sessionId, {
      force: true,
      deleteBranch: false,
      preserveBranchMeta: true,
    });
  }

  /**
   * Session archived/unarchived hook (called by the session IPC layer).
   * Archiving with `teardownOnArchive` reclaims the worktree directory (hooks
   * + services stop first); the branch + base ref survive so unarchiving can
   * recreate the environment from the same point.
   */
  onSessionArchivedChanged(sessionId: string, archived: boolean): void {
    const settings = this.settings.getAll();
    if (!settings.git.worktrees.enabled) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (archived && session.worktreePath && settings.git.worktrees.teardownOnArchive) {
      void this.archiveTeardown(sessionId).catch((err) =>
        logger.warn('archive teardown failed', err),
      );
    } else if (!archived && !session.worktreePath && session.worktreeBranch) {
      // Restore-from-archive: recreate the worktree from the kept metadata.
      void this.recreateForSession(sessionId).catch((err) =>
        logger.warn('archive restore recreate failed', err),
      );
    }
  }

  /** Sequential, streamed hook execution — each command is a visible terminal. */
  private async runHookCommands(
    session: Session,
    commands: string[],
    phase: 'setup' | 'teardown',
  ): Promise<void> {
    if (!this.terminals) throw new Error('Terminal manager unavailable');
    const ws = this.workspace.getById(session.workspaceId);
    if (!ws) throw new Error('Workspace not found');
    const cwd = session.worktreePath;
    if (!cwd || !safeIsDir(cwd)) throw new Error('Worktree directory missing');

    // Paseo-parity environment: hooks can copy ignored files (e.g. .env) from
    // the source checkout and brand their output per branch.
    const env: Record<string, string> = {
      LIMBOO_WORKTREE: '1',
      LIMBOO_SOURCE_ROOT: ws.path,
      LIMBOO_BRANCH: session.worktreeBranch ?? '',
      LIMBOO_SESSION_ID: session.id,
    };

    for (let i = 0; i < commands.length; i += 1) {
      const command = commands[i];
      const title = `${phase} ${i + 1}/${commands.length}`;
      this.diagnostic(session.id, 'info', `Worktree ${title}`, command.slice(0, 200));
      const exitCode = await this.runOneCommand(session, cwd, command, title, env);
      if (exitCode !== 0) {
        this.diagnostic(
          session.id,
          'error',
          `Worktree ${phase} failed`,
          `step ${i + 1} exited ${exitCode}`,
        );
        throw new Error(`Worktree ${phase} step ${i + 1} exited with code ${exitCode}`);
      }
    }
    this.diagnostic(session.id, 'info', `Worktree ${phase} complete`, `${commands.length} step(s)`);
  }

  /** One hook command in a PTY, resolved on exit (bounded by the hook timeout). */
  private runOneCommand(
    session: Session,
    cwd: string,
    command: string,
    title: string,
    env: Record<string, string>,
  ): Promise<number> {
    const terminals = this.terminals;
    if (!terminals) return Promise.resolve(127);
    return new Promise<number>((resolve) => {
      let settled = false;
      let termId: string | null = null;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Reap the hung PTY — otherwise it lives (and counts against the
          // per-workspace terminal cap) until app quit.
          if (termId) terminals.kill(termId);
          resolve(124); // conventional timeout exit code
        }
      }, WORKTREE_LIMITS.hookTimeoutMs);
      try {
        const term = terminals.createForCommand({
          workspaceId: session.workspaceId,
          sessionId: session.id,
          cwd,
          command,
          title: `Worktree ${title}`,
          origin: 'hook',
          env,
          onExit: (exitCode) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(exitCode);
          },
        });
        termId = term.id;
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        logger.warn('hook command spawn failed', err);
        resolve(127);
      }
    });
  }

  /** Structured diagnostics row — feeds the console AND the session timeline. */
  private diagnostic(
    sessionId: string,
    severity: 'info' | 'warning' | 'error',
    label: string,
    detail?: string,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO agent_diagnostics (id, session_id, severity, category, label, detail, created_at)
             VALUES (?, ?, ?, 'worktree', ?, ?, ?)`,
        )
        .run(crypto.randomUUID(), sessionId, severity, label, detail ?? null, Date.now());
    } catch (err) {
      logger.warn('worktree diagnostic write failed', err);
    }
  }

  /* ------------------------------------------------------------- internals */

  private async repoRootFor(workspaceId: string): Promise<string | null> {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) return null;
    const top = await gitText(ws.path, ['rev-parse', '--show-toplevel']);
    return top ? path.normalize(top) : null;
  }

  private markMissing(sessionId: string): void {
    const info = this.db
      .prepare("UPDATE sessions SET worktree_status = 'missing' WHERE id = ? AND worktree_status != 'missing'")
      .run(sessionId);
    if (info.changes > 0) {
      logger.warn(`Worktree missing for session ${sessionId}`);
      this.broadcast();
    }
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IpcEvents.worktreesUpdated);
      // Session rows carry the worktree fields — refresh those too.
      win.webContents.send(IpcEvents.sessionsUpdated);
    }
  }
}

/* -------------------------------------------------------------- helpers */

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusy(stderr: string): boolean {
  return /EBUSY|resource busy|being used by another process|Permission denied/i.test(stderr || '');
}

/** Map `git worktree add` failures to actionable, credential-free messages. */
function classifyWorktreeAddError(stderr: string, branch: string): string {
  const t = (stderr || '').toLowerCase();
  if (t.includes('already checked out')) {
    return `Branch '${branch}' is already checked out in another worktree`;
  }
  if (t.includes('already exists')) {
    return `Branch or path for '${branch}' already exists — pick a different branch name`;
  }
  if (t.includes('invalid reference') || t.includes('not a valid ref')) {
    return 'The base ref does not exist in this repository';
  }
  const firstLine = (stderr || '').split('\n').find((l) => l.trim()) ?? 'git worktree add failed';
  return firstLine.slice(0, 300);
}

/** Parse `git worktree list --porcelain` output into structured entries. */
function parseWorktreeList(stdout: string): WorktreeInfo[] {
  const infos: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (current) infos.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) infos.push(current);
      current = {
        path: line.slice('worktree '.length),
        detached: false,
        locked: false,
        prunable: false,
      };
    } else if (!current) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line.startsWith('locked')) {
      current.locked = true;
    } else if (line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  if (current) infos.push(current);
  return infos;
}
