/**
 * IPC handlers for the Session Manager. Registered through `handle()`, so every
 * call inherits sender-origin validation. Inputs are validated here in the main
 * process (CLAUDE.md §6): ids/titles are type- and length-checked and update
 * patches are scanned for prototype-pollution keys before reaching the manager.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SESSION_LIMITS, WORKTREE_LIMITS } from '@shared/constants';
import type {
  Session,
  SessionDeleteOptions,
  SessionDependencies,
  SessionTimelineEntry,
  SessionUpdate,
} from '@shared/types';
import { handle } from './registry';
import type { SessionManager } from '../managers/SessionManager';
import type { WorktreeManager } from '../managers/worktree/WorktreeManager';
import type { ServiceManager } from '../managers/services/ServiceManager';
import type { TerminalManager } from '../managers/TerminalManager';
import type { AttachmentManager } from '../managers/attachments/AttachmentManager';
import { logger } from '../logger';

/** Bounds for session organization inputs (folder / tags). */
const FOLDER_MAX = 64;
const TAG_MAX = 24;
const TAGS_MAX = 8;

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoPollutingKeys(value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`session:update rejected unsafe key: ${key}`);
    }
    assertNoPollutingKeys(value[key]);
  }
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > SESSION_LIMITS.idMax) {
    throw new Error('session: invalid id');
  }
}

function assertValidTitle(title: unknown): asserts title is string {
  if (typeof title !== 'string' || title.length === 0 || title.length > SESSION_LIMITS.titleMax) {
    throw new Error('session: invalid title');
  }
  if (title.includes('\0')) {
    throw new Error('session: title contains an invalid character');
  }
}

/** Validate an update patch: only the known keys, each of the right type/shape. */
function assertValidUpdate(patch: unknown): asserts patch is SessionUpdate {
  if (!isPlainObject(patch)) throw new Error('session:update expects an object patch');
  assertNoPollutingKeys(patch);
  if (patch.title !== undefined) assertValidTitle(patch.title);
  if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') {
    throw new Error('session:update pinned must be a boolean');
  }
  if (patch.archived !== undefined && typeof patch.archived !== 'boolean') {
    throw new Error('session:update archived must be a boolean');
  }
  if (patch.folder !== undefined && patch.folder !== null) {
    if (
      typeof patch.folder !== 'string' ||
      patch.folder.length > FOLDER_MAX ||
      patch.folder.includes('\0')
    ) {
      throw new Error('session:update invalid folder');
    }
  }
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags) || patch.tags.length > TAGS_MAX) {
      throw new Error('session:update invalid tags');
    }
    for (const tag of patch.tags) {
      if (typeof tag !== 'string' || tag.length === 0 || tag.length > TAG_MAX || /[\0\n\r]/.test(tag)) {
        throw new Error('session:update invalid tag');
      }
    }
  }
}

/** Validate delete options (booleans only; polluting keys rejected). */
function sanitizeDeleteOptions(raw: unknown): SessionDeleteOptions {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error('session:delete expects an options object');
  assertNoPollutingKeys(raw);
  return {
    removeWorktree: raw.removeWorktree === true,
    deleteBranch: raw.deleteBranch === true,
    force: raw.force === true,
  };
}

/** Validate worktree-create options (title / baseRef / branch, length-capped). */
function sanitizeWorktreeCreate(raw: unknown): { title?: string; baseRef?: string; branch?: string } {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error('session:createInWorktree expects an options object');
  assertNoPollutingKeys(raw);
  const out: { title?: string; baseRef?: string; branch?: string } = {};
  if (raw.title !== undefined) {
    assertValidTitle(raw.title);
    out.title = raw.title;
  }
  for (const key of ['baseRef', 'branch'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > WORKTREE_LIMITS.branchMax ||
      value.includes('\0')
    ) {
      throw new Error(`session:createInWorktree invalid ${key}`);
    }
    out[key] = value;
  }
  return out;
}

export function registerSessionHandlers(
  sessions: SessionManager,
  worktrees: WorktreeManager,
  services: ServiceManager,
  terminals: TerminalManager,
  attachments: AttachmentManager,
): void {
  handle<[string, boolean?], Session[]>(IpcChannels.sessionList, (_e, workspaceId, trash) => {
    assertValidId(workspaceId);
    return trash === true ? sessions.listTrash(workspaceId) : sessions.list(workspaceId);
  });

  handle<[], Session | null>(IpcChannels.sessionGetActive, () => sessions.getActive());

  handle<[string, string?], Session>(IpcChannels.sessionCreate, (_e, workspaceId, title) => {
    assertValidId(workspaceId);
    if (title !== undefined) assertValidTitle(title);
    return sessions.create(workspaceId, title);
  });

  handle<[string, SessionUpdate], Session>(IpcChannels.sessionUpdate, (_e, id, patch) => {
    assertValidId(id);
    assertValidUpdate(patch);
    const before = sessions.get(id);
    const updated = sessions.update(id, patch);
    // Archive transition drives the worktree lifecycle (teardown on archive /
    // recreate on restore) — fire-and-forget, the manager gates on settings.
    if (before && patch.archived !== undefined && before.archived !== updated.archived) {
      worktrees.onSessionArchivedChanged(id, updated.archived);
    }
    return updated;
  });

  handle<[string, { cloneWorktree?: boolean }?], Session>(
    IpcChannels.sessionDuplicate,
    async (_e, id, opts) => {
      assertValidId(id);
      const src = sessions.get(id);
      const copy = sessions.duplicate(id);
      // Optional worktree clone: a fresh, independent checkout from the same
      // base — two strategies can now diverge from the identical context.
      if (opts && isPlainObject(opts) && opts.cloneWorktree === true && src) {
        try {
          return await worktrees.createForSession(copy.id, {
            baseRef: src.worktreeBranch ?? src.baseRef ?? undefined,
          });
        } catch (err) {
          logger.warn('duplicate worktree clone failed', err);
        }
      }
      return copy;
    },
  );

  handle<[string, SessionDeleteOptions?], void>(IpcChannels.sessionDelete, async (_e, id, opts) => {
    assertValidId(id);
    const options = sanitizeDeleteOptions(opts);
    // A trashed session must not keep processes alive: stop its supervised
    // services and PTYs regardless of the worktree option (plain sessions can
    // own running services too). removeForSession also does this, but only
    // runs when the worktree is being removed.
    await services.stopForSession(id).catch(() => undefined);
    // Tear the worktree down BEFORE trashing so the directory (and optionally
    // its branch) is reclaimed while the session record survives in the trash.
    if (options.removeWorktree) {
      await worktrees.removeForSession(id, {
        force: options.force,
        deleteBranch: options.deleteBranch,
        preserveBranchMeta: !options.deleteBranch,
      });
    } else {
      terminals.disposeSession(id);
    }
    sessions.softDelete(id);
  });

  handle<[string], Session>(IpcChannels.sessionRestore, (_e, id) => {
    assertValidId(id);
    return sessions.restore(id);
  });

  handle<[string], void>(IpcChannels.sessionPurge, async (_e, id) => {
    assertValidId(id);
    // A purged session must not leak its worktree directory — force-remove it
    // (keeping the branch: permanent data loss stays a separate, explicit act).
    try {
      await worktrees.removeForSession(id, { force: true, deleteBranch: false });
    } catch (err) {
      logger.warn('session:purge worktree removal failed', err);
    }
    // Purge is permanent: delete the session's staged attachments too (trash
    // keeps them so a restored session still has its files).
    try {
      await attachments.purgeSession(id);
    } catch (err) {
      logger.warn('session:purge attachment cleanup failed', err);
    }
    sessions.purge(id);
  });

  handle<[string, { title?: string; baseRef?: string; branch?: string }?], Session>(
    IpcChannels.sessionCreateInWorktree,
    async (_e, workspaceId, opts) => {
      assertValidId(workspaceId);
      const options = sanitizeWorktreeCreate(opts);
      const session = sessions.create(workspaceId, options.title);
      // On worktree failure the session survives as a plain session — the
      // renderer surfaces the error as a toast against the created session.
      return worktrees.createForSession(session.id, {
        baseRef: options.baseRef,
        branch: options.branch,
      });
    },
  );

  handle<[string], SessionDependencies>(IpcChannels.sessionGetDependencies, (_e, id) => {
    assertValidId(id);
    return worktrees.getDependencies(id);
  });

  handle<[string, number?], SessionTimelineEntry[]>(
    IpcChannels.sessionTimeline,
    (_e, id, limit) => {
      assertValidId(id);
      const capped =
        typeof limit === 'number' && Number.isFinite(limit)
          ? Math.max(1, Math.min(500, Math.floor(limit)))
          : undefined;
      return sessions.getTimeline(id, capped);
    },
  );

  handle<[string], Session>(IpcChannels.sessionSetActive, (_e, id) => {
    assertValidId(id);
    return sessions.setActive(id);
  });
}
