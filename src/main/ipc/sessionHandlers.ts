/**
 * IPC handlers for the Session Manager. Registered through `handle()`, so every
 * call inherits sender-origin validation. Inputs are validated here in the main
 * process (CLAUDE.md §6): ids/titles are type- and length-checked and update
 * patches are scanned for prototype-pollution keys before reaching the manager.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SESSION_LIMITS } from '@shared/constants';
import type { Session, SessionUpdate } from '@shared/types';
import { handle } from './registry';
import type { SessionManager } from '../managers/SessionManager';

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
}

export function registerSessionHandlers(sessions: SessionManager): void {
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
    return sessions.update(id, patch);
  });

  handle<[string], Session>(IpcChannels.sessionDuplicate, (_e, id) => {
    assertValidId(id);
    return sessions.duplicate(id);
  });

  handle<[string], void>(IpcChannels.sessionDelete, (_e, id) => {
    assertValidId(id);
    sessions.softDelete(id);
  });

  handle<[string], Session>(IpcChannels.sessionRestore, (_e, id) => {
    assertValidId(id);
    return sessions.restore(id);
  });

  handle<[string], void>(IpcChannels.sessionPurge, (_e, id) => {
    assertValidId(id);
    sessions.purge(id);
  });

  handle<[string], Session>(IpcChannels.sessionSetActive, (_e, id) => {
    assertValidId(id);
    return sessions.setActive(id);
  });
}
