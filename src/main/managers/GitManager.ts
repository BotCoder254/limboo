/**
 * Git Manager — the deep-git engine. Owns every git operation for the active
 * workspace and is the source of truth the renderer reads through IPC. Lives in
 * the main process only.
 *
 * Design (project.md / CLAUDE.md): git is treated as a *timeline of the work*, not
 * a bag of commands. This manager exposes status, diffs, staging, commits,
 * history, branches, tags, blame, and — its defining capability — lightweight
 * **checkpoints** stored as dedicated refs under `refs/limboo/checkpoints/*` so an
 * agent's work is always recoverable without polluting real history.
 *
 * Security: all git runs go through {@link runGit} (argv-only, fixed cwd, no
 * shell, bounded). Every renderer-supplied path is validated with
 * {@link assertInsideRepo}. Commit/branch/label inputs are length-capped by the
 * handlers. Checkpoints never touch a branch and are never pushed.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { GIT_LIMITS } from '@shared/constants';
import type {
  GitBlameLine,
  GitBranch,
  GitCheckoutResult,
  GitCheckpoint,
  GitCommit,
  GitCommitContext,
  GitCommitDetail,
  GitFileChange,
  GitFileDiff,
  GitPullResult,
  GitPushResult,
  GitStatus,
  GitTag,
} from '@shared/types';
import { getDb } from '../db/database';
import { logger } from '../logger';
import type { WorkspaceManager } from './WorkspaceManager';
import type { SettingsManager } from './SettingsManager';
import type { MemoryManager } from './memory/MemoryManager';
import { assertInsideRepo, gitText, runGit } from './git/exec';
import { sanitizeRef } from './git/refs';
import {
  LOG_FORMAT,
  parseBlame,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseStatus,
  parseUnifiedDiff,
} from './git/parse';

interface CheckpointRow {
  id: string;
  session_id: string;
  workspace_id: string;
  ref: string;
  commit_hash: string;
  label: string;
  auto: number;
  message_id: string | null;
  files: string;
  created_at: number;
}

export class GitManager {
  /** Cache of workspaceId -> repo root (rev-parse --show-toplevel). */
  private readonly rootCache = new Map<string, string | null>();
  /** Optional Local Memory System — commits become proposed memories. */
  private memory?: MemoryManager;
  /**
   * Resolves the workspace's *effective* root — the active session's worktree
   * when it owns one, else the workspace path. Injected by the composition
   * root; the root cache is invalidated there on every active-session change.
   */
  private activeRootResolver: ((workspaceId: string) => string | null) | null = null;

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly settings: SettingsManager,
  ) {}

  /** Wire the Memory Manager so finalized commits can propose new memories. */
  setMemoryManager(memory: MemoryManager): void {
    this.memory = memory;
  }

  /** Inject the active-root resolver (worktree-backed sessions). */
  setActiveRootResolver(resolve: (workspaceId: string) => string | null): void {
    this.activeRootResolver = resolve;
  }

  private get db(): Database.Database {
    return getDb();
  }

  /* ----------------------------------------------------------- repo root */

  /**
   * Resolve the git root every operation runs in. For a plain session this is
   * the workspace repo root; when the active session owns a worktree it is the
   * worktree checkout (rev-parse inside a linked worktree returns the worktree
   * path, and all 30+ git ops inherit it with no further changes). The cache is
   * invalidated on `init` and on every active-session change.
   */
  private async resolveRoot(workspaceId: string): Promise<string | null> {
    if (this.rootCache.has(workspaceId)) return this.rootCache.get(workspaceId) ?? null;
    const ws = this.workspace.getById(workspaceId);
    if (!ws) {
      this.rootCache.set(workspaceId, null);
      return null;
    }
    const base = this.activeRootResolver?.(workspaceId) ?? ws.path;
    const top = await gitText(base, ['rev-parse', '--show-toplevel']);
    const root = top ? path.normalize(top) : null;
    this.rootCache.set(workspaceId, root);
    return root;
  }

  private async requireRoot(workspaceId: string): Promise<string> {
    const root = await this.resolveRoot(workspaceId);
    if (!root) throw new Error('Not a git repository');
    return root;
  }

  /** Invalidate the cached root (e.g. after `init`). */
  invalidate(workspaceId: string): void {
    this.rootCache.delete(workspaceId);
  }

  /* ---------------------------------------------------------------- status */

  async status(workspaceId: string): Promise<GitStatus> {
    const root = await this.resolveRoot(workspaceId);
    if (!root) {
      return {
        isRepo: false,
        ahead: 0,
        behind: 0,
        hasRemote: false,
        detached: false,
        files: [],
        clean: true,
      };
    }
    const statusRes = await runGit(root, ['status', '--porcelain=v2', '--branch', '-z']);
    const parsed = parseStatus(statusRes.stdout);

    // Best-effort per-file line counts (unstaged + staged numstat).
    const [unstaged, staged] = await Promise.all([
      runGit(root, ['diff', '--numstat', '-z']),
      runGit(root, ['diff', '--cached', '--numstat', '-z']),
    ]);
    const counts = parseNumstat(unstaged.stdout);
    for (const [p, c] of parseNumstat(staged.stdout)) {
      const prev = counts.get(p);
      counts.set(p, { adds: (prev?.adds ?? 0) + c.adds, dels: (prev?.dels ?? 0) + c.dels });
    }
    for (const f of parsed.files) {
      const c = counts.get(f.path);
      if (c) {
        f.adds = c.adds;
        f.dels = c.dels;
      }
    }

    const remotes = await gitText(root, ['remote']);
    return {
      isRepo: true,
      branch: parsed.branch,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      hasRemote: !!remotes && remotes.length > 0,
      detached: parsed.detached,
      files: parsed.files,
      clean: parsed.files.length === 0,
    };
  }

  /* ------------------------------------------------------------------ diff */

  async diff(
    workspaceId: string,
    filePath: string,
    opts: { staged?: boolean; baseRef?: string } = {},
  ): Promise<GitFileDiff> {
    const root = await this.requireRoot(workspaceId);
    const rel = assertInsideRepo(root, filePath);
    const language = languageFor(rel);

    let args: string[];
    if (opts.baseRef) {
      args = ['diff', sanitizeRef(opts.baseRef), '--', rel];
    } else if (opts.staged) {
      args = ['diff', '--cached', '--', rel];
    } else {
      // Untracked files have no diff base — synthesize one against /dev/null.
      const tracked = await runGit(root, ['ls-files', '--error-unmatch', '--', rel]);
      args = tracked.ok
        ? ['diff', '--', rel]
        : ['diff', '--no-index', '--', '/dev/null', rel];
    }

    const res = await runGit(root, args, { maxBuffer: GIT_LIMITS.diffBytesMax + 1024 });
    const raw = res.stdout;
    const truncated = raw.length > GIT_LIMITS.diffBytesMax;
    const { binary, hunks } = parseUnifiedDiff(
      truncated ? raw.slice(0, GIT_LIMITS.diffBytesMax) : raw,
    );
    return { path: rel, binary, staged: !!opts.staged, hunks, language, truncated };
  }

  /* --------------------------------------------------------------- staging */

  async stage(workspaceId: string, filePath: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    const rel = assertInsideRepo(root, filePath);
    await runGit(root, ['add', '--', rel]);
    this.notifyChanged(workspaceId);
  }

  async unstage(workspaceId: string, filePath: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    const rel = assertInsideRepo(root, filePath);
    // `restore --staged` works whether or not HEAD exists (reset fallback for the
    // unborn-branch case).
    const res = await runGit(root, ['restore', '--staged', '--', rel]);
    if (!res.ok) await runGit(root, ['reset', '-q', 'HEAD', '--', rel]);
    this.notifyChanged(workspaceId);
  }

  async stageAll(workspaceId: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    await runGit(root, ['add', '-A']);
    this.notifyChanged(workspaceId);
  }

  async unstageAll(workspaceId: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    const res = await runGit(root, ['reset', '-q']);
    if (!res.ok) await runGit(root, ['rm', '-r', '--cached', '-q', '.']);
    this.notifyChanged(workspaceId);
  }

  /** Discard unstaged changes to a tracked file (or delete an untracked one). */
  async discard(workspaceId: string, filePath: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    const rel = assertInsideRepo(root, filePath);
    const tracked = await runGit(root, ['ls-files', '--error-unmatch', '--', rel]);
    if (tracked.ok) {
      const res = await runGit(root, ['restore', '--', rel]);
      if (!res.ok) await runGit(root, ['checkout', '--', rel]);
    } else {
      await runGit(root, ['clean', '-f', '--', rel]);
    }
    this.notifyChanged(workspaceId);
  }

  /* ---------------------------------------------------------------- commit */

  async commit(workspaceId: string, message: string): Promise<GitCommit | null> {
    const root = await this.requireRoot(workspaceId);
    const res = await runGit(root, ['commit', '-m', message, ...this.identityArgs()], {});
    if (!res.ok) throw new Error(res.stderr || 'git commit failed');
    this.notifyChanged(workspaceId);
    const log = await this.log(workspaceId, { limit: 1 });
    const commit = log[0] ?? null;
    // Offer the commit to the Local Memory System as a knowledge candidate
    // (fire-and-forget; respects the user's auto-capture policy).
    if (commit) {
      this.memory?.proposeFromCommit(workspaceId, {
        hash: commit.hash,
        subject: commit.subject,
        body: commit.body,
      });
    }
    return commit;
  }

  /**
   * Assemble the size-capped, redacted context the AI commit-message sub-agent
   * prompts with. Read-only: entirely `runGit` output, nothing renderer-supplied
   * beyond the workspace id, and no `notifyChanged`. Returns null for non-repos;
   * a repo with nothing staged returns `files: []` (the handler maps that to a
   * `no-staged` result before any model run starts).
   */
  async buildCommitContext(workspaceId: string): Promise<GitCommitContext | null> {
    const root = await this.resolveRoot(workspaceId);
    if (!root) return null;
    const caps = GIT_LIMITS.commitGen;

    const status = await this.status(workspaceId);
    const stagedFiles = status.files.filter((f) => f.staged).slice(0, caps.filesMax);
    if (stagedFiles.length === 0) {
      return { root, branch: status.branch, files: [], diff: '', diffTruncated: false, recentSubjects: [] };
    }

    // Binary detection: numstat prints `-` for binary files, which parseNumstat
    // skips — a staged file with zero adds+dels and a non-empty diff is binary
    // for our purposes; re-check via `--numstat` directly for accuracy.
    const numstat = await runGit(root, ['diff', '--cached', '--numstat', '-z']);
    const binaryPaths = new Set<string>();
    for (const entry of numstat.stdout.split('\0')) {
      const m = /^-\t-\t(.+)$/.exec(entry);
      if (m) binaryPaths.add(m[1]);
    }

    const diffRes = await runGit(root, ['diff', '--cached', '--no-color', '--no-ext-diff'], {
      maxBuffer: GIT_LIMITS.diffBytesMax + 1024,
    });
    const rawDiff = diffRes.stdout;
    const diffTruncated = rawDiff.length > caps.diffCharsMax;
    const diff = redactRemote(diffTruncated ? rawDiff.slice(0, caps.diffCharsMax) : rawDiff);

    // Recent subjects for style inference (unborn repo → empty list).
    const subjectsRes = await runGit(root, [
      'log',
      '-n',
      String(caps.subjectsMax),
      '--pretty=format:%s',
    ]);
    const recentSubjects = subjectsRes.ok
      ? subjectsRes.stdout
          .split('\n')
          .map((s) => redactRemote(s).trim())
          .filter(Boolean)
      : [];

    return {
      root,
      branch: status.branch,
      files: stagedFiles.map((f) => ({
        path: f.path,
        status: f.status,
        adds: f.adds,
        dels: f.dels,
        binary: binaryPaths.has(f.path) || undefined,
      })),
      diff,
      diffTruncated,
      recentSubjects,
    };
  }

  /** `-c user.name/email` overrides from settings (blank = inherit git config). */
  private identityArgs(): string[] {
    const g = this.settings.getAll().git;
    const args: string[] = [];
    if (g.userName.trim()) args.unshift('-c', `user.name=${g.userName.trim()}`);
    if (g.userEmail.trim()) args.unshift('-c', `user.email=${g.userEmail.trim()}`);
    return args;
  }

  /* --------------------------------------------------------------- history */

  async log(
    workspaceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<GitCommit[]> {
    const root = await this.requireRoot(workspaceId);
    const limit = Math.min(opts.limit ?? GIT_LIMITS.logPageSize, GIT_LIMITS.logPageSize);
    const args = [
      'log',
      `--pretty=format:${LOG_FORMAT}`,
      `-n`,
      String(limit),
      `--skip=${Math.max(0, opts.offset ?? 0)}`,
    ];
    const res = await runGit(root, args);
    return res.ok ? parseLog(res.stdout) : [];
  }

  async commitDetail(workspaceId: string, hash: string): Promise<GitCommitDetail | null> {
    const root = await this.requireRoot(workspaceId);
    const ref = sanitizeRef(hash);
    const meta = await runGit(root, ['log', '-1', `--pretty=format:${LOG_FORMAT}`, ref]);
    const [commit] = parseLog(meta.stdout);
    if (!commit) return null;
    const body = await gitText(root, ['log', '-1', '--pretty=format:%b', ref]);
    const files = await runGit(root, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-z',
      ref,
    ]);
    return { commit: { ...commit, body: body ?? undefined }, files: parseNameStatus(files.stdout) };
  }

  /* -------------------------------------------------------------- branches */

  async branches(workspaceId: string): Promise<GitBranch[]> {
    const root = await this.requireRoot(workspaceId);
    const res = await runGit(root, [
      'for-each-ref',
      '--format=%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)\x1f%(upstream:track)',
      'refs/heads',
    ]);
    if (!res.ok) return [];
    const out: GitBranch[] = [];
    for (const line of res.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, head, upstream, track] = line.split('\x1f');
      const ahead = /ahead (\d+)/.exec(track ?? '');
      const behind = /behind (\d+)/.exec(track ?? '');
      out.push({
        name,
        current: head === '*',
        upstream: upstream || undefined,
        ahead: ahead ? Number(ahead[1]) : 0,
        behind: behind ? Number(behind[1]) : 0,
      });
    }
    return out;
  }

  /** Guarded checkout — refuses on a dirty tree unless `force` is set. */
  async checkout(
    workspaceId: string,
    branch: string,
    opts: { force?: boolean } = {},
  ): Promise<GitCheckoutResult> {
    const root = await this.requireRoot(workspaceId);
    const ref = sanitizeRef(branch);
    if (!opts.force) {
      const dirty = await runGit(root, ['status', '--porcelain']);
      const changed = dirty.stdout.split('\n').filter((l) => l.trim()).length;
      if (changed > 0) {
        return { ok: false, blockedByDirty: true, changedFiles: changed };
      }
    }
    const res = await runGit(root, ['checkout', ref]);
    this.notifyChanged(workspaceId);
    return res.ok ? { ok: true } : { ok: false, error: res.stderr };
  }

  async createBranch(workspaceId: string, name: string, checkout = true): Promise<GitCheckoutResult> {
    const root = await this.requireRoot(workspaceId);
    const ref = sanitizeRef(name);
    const res = await runGit(root, checkout ? ['checkout', '-b', ref] : ['branch', ref]);
    this.notifyChanged(workspaceId);
    return res.ok ? { ok: true } : { ok: false, error: res.stderr };
  }

  /* ------------------------------------------------------------------ tags */

  async tags(workspaceId: string): Promise<GitTag[]> {
    const root = await this.requireRoot(workspaceId);
    const res = await runGit(root, [
      'for-each-ref',
      '--sort=-creatordate',
      '--format=%(refname:short)\x1f%(objectname:short)\x1f%(subject)',
      'refs/tags',
    ]);
    if (!res.ok) return [];
    return res.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const [name, hash, subject] = line.split('\x1f');
        return { name, hash, subject: subject || undefined };
      });
  }

  async createTag(workspaceId: string, name: string, message?: string): Promise<void> {
    const root = await this.requireRoot(workspaceId);
    const ref = sanitizeRef(name);
    const args = message ? ['tag', '-a', ref, '-m', message] : ['tag', ref];
    const res = await runGit(root, args);
    if (!res.ok) throw new Error(res.stderr || 'git tag failed');
    this.notifyChanged(workspaceId);
  }

  /* ----------------------------------------------------------------- blame */

  async blame(workspaceId: string, filePath: string): Promise<GitBlameLine[]> {
    const root = await this.requireRoot(workspaceId);
    const rel = assertInsideRepo(root, filePath);
    const res = await runGit(root, ['blame', '--porcelain', '--', rel]);
    return res.ok ? parseBlame(res.stdout) : [];
  }

  /* ------------------------------------------------------------- fetch/init */

  async fetch(workspaceId: string): Promise<boolean> {
    const root = await this.requireRoot(workspaceId);
    const res = await runGit(root, ['fetch', '--all', '--prune'], { timeout: 60_000 });
    this.notifyChanged(workspaceId);
    return res.ok;
  }

  /* ------------------------------------------------------------- push/pull */

  /**
   * Push the current branch to its remote. Never stores credentials — relies on
   * the user's git credential helper / SSH agent (env keeps the askpass stubbed,
   * so a missing credential fails fast instead of hanging). Decodes the common
   * git failures into structured flags so the UI can guide the next step.
   */
  async push(
    workspaceId: string,
    opts: { setUpstream?: boolean; force?: boolean } = {},
  ): Promise<GitPushResult> {
    const root = await this.requireRoot(workspaceId);
    const status = await this.status(workspaceId);

    if (!status.hasRemote) return { ok: false, noRemote: true };
    if (!status.branch || status.detached) {
      return { ok: false, error: 'Cannot push a detached HEAD — checkout a branch first.' };
    }

    const ahead = status.ahead;
    const gitCfg = this.settings.getAll().git;
    const hasUpstream = !!status.upstream;
    const wantUpstream = opts.setUpstream || (!hasUpstream && gitCfg.push.autoSetUpstream);

    if (!hasUpstream && !wantUpstream) {
      return { ok: false, noUpstream: true };
    }

    const branch = sanitizeRef(status.branch);
    const args = ['push'];
    if (opts.force) args.push('--force-with-lease');
    if (wantUpstream) args.push('-u', 'origin', branch);

    const res = await runGit(root, args, { timeout: GIT_LIMITS.networkTimeoutMs });
    this.notifyChanged(workspaceId);
    if (res.ok) {
      return { ok: true, setUpstream: wantUpstream || undefined, pushed: ahead || undefined };
    }
    return { ok: false, ...classifyPushError(res.stderr) };
  }

  /**
   * Integrate remote work into the current branch. `ff-only` (default) refuses a
   * non-fast-forward so history stays linear; `rebase` replays local commits on
   * top. Conflicts/divergence are returned as flags rather than thrown.
   */
  async pull(
    workspaceId: string,
    opts: { rebase?: boolean } = {},
  ): Promise<GitPullResult> {
    const root = await this.requireRoot(workspaceId);
    const status = await this.status(workspaceId);
    if (!status.hasRemote || !status.upstream) {
      return { ok: false, noUpstream: true };
    }

    const strategy = opts.rebase ? 'rebase' : this.settings.getAll().git.pull.strategy;
    const args =
      strategy === 'rebase'
        ? ['pull', '--rebase', ...this.identityArgs()]
        : ['pull', '--ff-only'];

    const res = await runGit(root, args, { timeout: GIT_LIMITS.networkTimeoutMs });
    this.notifyChanged(workspaceId);
    if (res.ok) {
      const upToDate = /already up to date/i.test(res.stdout) || /already up to date/i.test(res.stderr);
      return { ok: true, upToDate: upToDate || undefined, updated: !upToDate || undefined };
    }
    return { ok: false, ...classifyPullError(res.stderr || res.stdout) };
  }

  async init(workspaceId: string): Promise<boolean> {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) throw new Error('Workspace not found');
    const res = await runGit(ws.path, ['init']);
    this.invalidate(workspaceId);
    this.notifyChanged(workspaceId);
    return res.ok;
  }

  /* ------------------------------------------------------------ checkpoints */

  /**
   * Snapshot the working tree as a dedicated ref (no branch, never pushed). Uses
   * a throwaway temp index so the user's real index and worktree are untouched.
   */
  async createCheckpoint(
    workspaceId: string,
    sessionId: string,
    label: string,
    opts: { auto?: boolean; messageId?: string } = {},
  ): Promise<GitCheckpoint | null> {
    const root = await this.resolveRoot(workspaceId);
    if (!root) return null;

    const status = await this.status(workspaceId);
    const tmpIndex = path.join(os.tmpdir(), `limboo-ckpt-${crypto.randomUUID()}.index`);
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      const head = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
      if (head) await runGit(root, ['read-tree', 'HEAD'], { env });
      const add = await runGit(root, ['add', '-A'], { env });
      if (!add.ok) throw new Error(add.stderr || 'git add (checkpoint) failed');

      const treeRes = await runGit(root, ['write-tree'], { env });
      if (!treeRes.ok) throw new Error(treeRes.stderr || 'git write-tree failed');
      const tree = treeRes.stdout.trim();

      const commitArgs = ['commit-tree', tree, '-m', `[limboo checkpoint] ${label}`];
      if (head) commitArgs.push('-p', head);
      // Always supply an identity so commit-tree never fails on missing config.
      const g = this.settings.getAll().git;
      const identityEnv = {
        GIT_AUTHOR_NAME: g.userName.trim() || 'Limboo Checkpoint',
        GIT_AUTHOR_EMAIL: g.userEmail.trim() || 'checkpoint@limboo.local',
        GIT_COMMITTER_NAME: g.userName.trim() || 'Limboo Checkpoint',
        GIT_COMMITTER_EMAIL: g.userEmail.trim() || 'checkpoint@limboo.local',
      };
      const commitRes = await runGit(root, commitArgs, { env: { ...env, ...identityEnv } });
      if (!commitRes.ok) throw new Error(commitRes.stderr || 'git commit-tree failed');
      const commitHash = commitRes.stdout.trim();

      const ts = Date.now();
      const ref = `refs/limboo/checkpoints/${sessionId}/${ts}`;
      const upd = await runGit(root, ['update-ref', ref, commitHash]);
      if (!upd.ok) throw new Error(upd.stderr || 'git update-ref failed');

      const checkpoint: GitCheckpoint = {
        id: crypto.randomUUID(),
        sessionId,
        workspaceId,
        ref,
        commit: commitHash,
        label,
        auto: !!opts.auto,
        messageId: opts.messageId,
        files: status.files.map((f) => f.path),
        createdAt: ts,
      };
      this.db
        .prepare(
          `INSERT INTO git_checkpoints
            (id, session_id, workspace_id, ref, commit_hash, label, auto, message_id, files, created_at)
           VALUES (@id, @session_id, @workspace_id, @ref, @commit_hash, @label, @auto, @message_id, @files, @created_at)`,
        )
        .run({
          id: checkpoint.id,
          session_id: sessionId,
          workspace_id: workspaceId,
          ref,
          commit_hash: commitHash,
          label,
          auto: checkpoint.auto ? 1 : 0,
          message_id: opts.messageId ?? null,
          files: JSON.stringify(checkpoint.files),
          created_at: ts,
        });

      this.pruneCheckpoints(root, sessionId);
      this.notifyCheckpoints(sessionId);
      return checkpoint;
    } catch (err) {
      logger.warn('createCheckpoint failed', err);
      return null;
    } finally {
      try {
        if (fs.existsSync(tmpIndex)) fs.unlinkSync(tmpIndex);
      } catch {
        /* temp index cleanup is best-effort */
      }
    }
  }

  listCheckpoints(sessionId: string): GitCheckpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM git_checkpoints WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as CheckpointRow[];
    return rows.map(rowToCheckpoint);
  }

  /** Files changed between a checkpoint and the current working tree. */
  async diffCheckpoint(workspaceId: string, checkpointId: string): Promise<GitFileChange[]> {
    const root = await this.requireRoot(workspaceId);
    const cp = this.checkpointById(checkpointId);
    if (!cp) return [];
    const res = await runGit(root, ['diff', '--name-status', '-r', '-z', cp.commit]);
    return parseNameStatus(res.stdout).map((f) => ({ ...f, staged: false, unstaged: true }));
  }

  /**
   * Restore the working tree to a checkpoint. Auto-creates a safety checkpoint of
   * the current state first, so a restore is itself recoverable. Note: files
   * created *after* the checkpoint are not deleted (tracked files are reverted).
   */
  async restoreCheckpoint(workspaceId: string, checkpointId: string): Promise<boolean> {
    const root = await this.requireRoot(workspaceId);
    const cp = this.checkpointById(checkpointId);
    if (!cp) return false;
    await this.createCheckpoint(workspaceId, cp.sessionId, 'Before restore', { auto: true });
    const res = await runGit(root, ['restore', '--source', cp.commit, '--staged', '--worktree', '--', '.']);
    if (!res.ok) await runGit(root, ['checkout', cp.commit, '--', '.']);
    this.notifyChanged(workspaceId);
    this.notifyCheckpoints(cp.sessionId);
    return true;
  }

  async deleteCheckpoint(workspaceId: string, checkpointId: string): Promise<void> {
    const root = await this.resolveRoot(workspaceId);
    const cp = this.checkpointById(checkpointId);
    if (!cp) return;
    if (root) await runGit(root, ['update-ref', '-d', cp.ref]);
    this.db.prepare('DELETE FROM git_checkpoints WHERE id = ?').run(checkpointId);
    this.notifyCheckpoints(cp.sessionId);
  }

  private checkpointById(id: string): CheckpointRow | undefined {
    return this.db.prepare('SELECT * FROM git_checkpoints WHERE id = ?').get(id) as
      | CheckpointRow
      | undefined;
  }

  /** Drop the oldest checkpoints for a session beyond the configured cap. */
  private pruneCheckpoints(root: string, sessionId: string): void {
    const max = this.settings.getAll().git.maxCheckpoints;
    const rows = this.db
      .prepare(
        'SELECT id, ref FROM git_checkpoints WHERE session_id = ? ORDER BY created_at DESC',
      )
      .all(sessionId) as Array<{ id: string; ref: string }>;
    for (const stale of rows.slice(max)) {
      void runGit(root, ['update-ref', '-d', stale.ref]);
      this.db.prepare('DELETE FROM git_checkpoints WHERE id = ?').run(stale.id);
    }
  }

  /* ------------------------------------------------------------- broadcast */

  /** Called by the File System watcher and after any mutation. */
  notifyChanged(workspaceId: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.gitChanged, { workspaceId });
    }
  }

  private notifyCheckpoints(sessionId: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcEvents.gitCheckpointsChanged, { sessionId });
      }
    }
  }
}

/* ------------------------------------------------------------- helpers */

function rowToCheckpoint(row: CheckpointRow): GitCheckpoint {
  let files: string[] = [];
  try {
    files = JSON.parse(row.files) as string[];
  } catch {
    files = [];
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    ref: row.ref,
    commit: row.commit_hash,
    label: row.label,
    auto: row.auto === 1,
    messageId: row.message_id ?? undefined,
    files,
    createdAt: row.created_at,
  };
}

/**
 * Decode `git push` stderr into structured flags. Credentials are never stored
 * by Limboo, so an auth failure is surfaced as guidance to configure the system
 * credential helper / SSH agent rather than a raw error.
 */
function classifyPushError(stderr: string): Partial<GitPushResult> {
  const t = (stderr || '').toLowerCase();
  if (
    /could not read username/.test(t) ||
    /authentication failed/.test(t) ||
    /permission denied/.test(t) ||
    /no such identity/.test(t) ||
    /terminal prompts disabled/.test(t)
  ) {
    return { authFailed: true, error: redactRemote(stderr) };
  }
  if (/\(non-fast-forward\)/.test(t) || /\[rejected\]/.test(t) || /fetch first/.test(t) || /updates were rejected/.test(t)) {
    return { rejected: true, needsPull: true, error: redactRemote(stderr) };
  }
  return { error: redactRemote(stderr) || 'git push failed' };
}

/** Decode `git pull` stderr/stdout into structured flags. */
function classifyPullError(out: string): Partial<GitPullResult> {
  const t = (out || '').toLowerCase();
  if (
    /could not read username/.test(t) ||
    /authentication failed/.test(t) ||
    /permission denied/.test(t)
  ) {
    return { error: redactRemote(out) };
  }
  if (/not possible to fast-forward/.test(t) || /need to specify how to reconcile/.test(t) || /diverging/.test(t)) {
    return { notFastForward: true, error: redactRemote(out) };
  }
  if (/conflict/.test(t) || /merge conflict/.test(t) || /could not apply/.test(t)) {
    return { conflicts: true, error: redactRemote(out) };
  }
  return { error: redactRemote(out) || 'git pull failed' };
}

/** Strip any embedded credentials from a remote URL before it reaches the UI/log. */
export function redactRemote(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1');
}

/** Map a file extension to a highlight.js / shiki language id for the diff view. */
function languageFor(p: string): string | undefined {
  const ext = path.extname(p).slice(1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
  };
  return map[ext];
}
