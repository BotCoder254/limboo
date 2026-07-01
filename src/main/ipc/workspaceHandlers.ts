/**
 * IPC handlers for the Workspace Manager. Registered through `handle()`, so every
 * call inherits sender-origin validation. Inputs are validated here in the main
 * process (CLAUDE.md §6): ids/paths are type- and length-checked, and config
 * patches are scanned for prototype-pollution keys before they reach the manager.
 */
import { BrowserWindow, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import { WORKSPACE_LIMITS } from '@shared/constants';
import type { DeepPartial, Workspace, WorkspaceConfig, WorkspaceStats } from '@shared/types';
import { handle } from './registry';
import { WorkspaceManager, WorkspaceValidationError } from '../managers/WorkspaceManager';
import { logger } from '../logger';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoPollutingKeys(value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`workspace:updateConfig rejected unsafe key: ${key}`);
    }
    assertNoPollutingKeys(value[key]);
  }
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('workspace: invalid id');
  }
}

function assertValidPath(p: unknown): asserts p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > WORKSPACE_LIMITS.pathMax) {
    throw new Error('workspace: invalid path');
  }
  if (p.includes('\0')) {
    throw new Error('workspace: path contains an invalid character');
  }
}

/** Characters never allowed in a new workspace folder name: Windows reserved
 *  filename characters plus ASCII control codes. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
/** Reserved device names Windows forbids as a directory name (case-insensitive). */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Validate a renderer-supplied name for a *new* workspace folder. Rejects path
 * separators, traversal, illegal characters, reserved Windows device names, and
 * over-long input before the main process ever calls `mkdir`. The name must be a
 * single folder segment — the parent location is validated separately.
 */
function assertValidWorkspaceName(name: unknown): asserts name is string {
  if (typeof name !== 'string') {
    throw new Error('workspace:createNew name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > WORKSPACE_LIMITS.nameMax) {
    throw new Error('workspace:createNew name is empty or too long');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('workspace:createNew name is not a valid folder name');
  }
  if (ILLEGAL_NAME_CHARS.test(trimmed)) {
    throw new Error('workspace:createNew name contains characters that are not allowed');
  }
  // Trailing dots/spaces are stripped by Windows and cause surprising folder names.
  if (/[. ]$/.test(trimmed)) {
    throw new Error('workspace:createNew name may not end with a space or dot');
  }
  if (RESERVED_NAMES.test(trimmed)) {
    throw new Error('workspace:createNew name is a reserved system name');
  }
}

/** Cap on how many ignored-dir entries a config patch may carry. */
const MAX_IGNORED_DIRS = 200;
/** Per-entry length cap for an ignored-dir glob/name. */
const MAX_IGNORED_DIR_LEN = 256;

/**
 * Validate a renderer-supplied `ignoredDirs` array before it is persisted and
 * later used to bound filesystem walks. Each entry must be a plain, bounded
 * string with no NUL, no absolute path, and no `..` traversal segment — so a
 * malicious or malformed config can never widen a walk outside the repo root.
 */
function assertValidIgnoredDirs(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error('workspace:updateConfig ignoredDirs must be an array');
  }
  if (value.length > MAX_IGNORED_DIRS) {
    throw new Error('workspace:updateConfig ignoredDirs has too many entries');
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_IGNORED_DIR_LEN) {
      throw new Error('workspace:updateConfig ignoredDirs entry is invalid');
    }
    if (entry.includes('\0')) {
      throw new Error('workspace:updateConfig ignoredDirs entry contains an invalid character');
    }
    if (entry.startsWith('/') || entry.startsWith('\\') || /^[a-zA-Z]:/.test(entry)) {
      throw new Error('workspace:updateConfig ignoredDirs entry must be relative');
    }
    if (entry.split(/[/\\]/).some((seg) => seg === '..')) {
      throw new Error('workspace:updateConfig ignoredDirs entry must not traverse upward');
    }
  }
}

/** Surface validation diagnostics to the renderer as a structured error message. */
function rethrow(err: unknown): never {
  if (err instanceof WorkspaceValidationError) {
    throw new Error(err.validation.errors.join('\n') || 'Workspace validation failed.');
  }
  throw err;
}

/** True while a native directory picker is open (see the pickDirectory handler). */
let pickerOpen = false;

export function registerWorkspaceHandlers(workspace: WorkspaceManager): void {
  handle<[], Workspace[]>(IpcChannels.workspaceList, () => workspace.list());

  handle<[], Workspace | null>(IpcChannels.workspaceGet, () => workspace.getActive());

  handle<[], string | null>(IpcChannels.workspacePickDirectory, async (event: IpcMainInvokeEvent) => {
    // Re-entrancy guard: while one native dialog is open, ignore further picks.
    // On Linux each portal request emits benign `dbus/xdg` ERROR log lines, and a
    // rapid double-click would otherwise spawn several overlapping portal
    // requests (the source of the repeated noise). One dialog at a time.
    if (pickerOpen) return null;
    pickerOpen = true;
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const opts = {
        title: 'Select a project folder',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    } finally {
      pickerOpen = false;
    }
  });

  handle<[string], Workspace>(IpcChannels.workspaceCreate, (_e, p) => {
    assertValidPath(p);
    try {
      return workspace.create(p);
    } catch (err) {
      logger.warn('workspace:create failed', err);
      return rethrow(err);
    }
  });

  handle<[{ name: string; parentPath: string; initGit: boolean }], Workspace>(
    IpcChannels.workspaceCreateNew,
    (_e, input) => {
      if (!isPlainObject(input)) {
        throw new Error('workspace:createNew expects an object payload');
      }
      // Keep the prototype-pollution guard consistent with updateConfig.
      assertNoPollutingKeys(input);
      assertValidWorkspaceName((input as { name?: unknown }).name);
      assertValidPath((input as { parentPath?: unknown }).parentPath);
      const initGit = (input as { initGit?: unknown }).initGit;
      if (typeof initGit !== 'boolean') {
        throw new Error('workspace:createNew initGit must be a boolean');
      }
      try {
        return workspace.createNew({
          name: (input as { name: string }).name.trim(),
          parentPath: (input as { parentPath: string }).parentPath,
          initGit,
        });
      } catch (err) {
        // Log the failure without the raw path (redaction: id/paths stay out of logs).
        logger.warn('workspace:createNew failed');
        return rethrow(err);
      }
    },
  );

  handle<[string], Workspace>(IpcChannels.workspaceOpen, (_e, p) => {
    assertValidPath(p);
    try {
      return workspace.open(p);
    } catch (err) {
      logger.warn('workspace:open failed', err);
      return rethrow(err);
    }
  });

  handle<[string], Workspace>(IpcChannels.workspaceSwitch, (_e, id) => {
    assertValidId(id);
    return workspace.switch(id);
  });

  handle<[string, boolean?], void>(IpcChannels.workspaceRemove, (_e, id, deleteFiles) => {
    assertValidId(id);
    workspace.remove(id, deleteFiles === true);
  });

  handle<[string], Workspace>(IpcChannels.workspaceToggleFavorite, (_e, id) => {
    assertValidId(id);
    return workspace.toggleFavorite(id);
  });

  handle<[string, DeepPartial<WorkspaceConfig>], Workspace>(
    IpcChannels.workspaceUpdateConfig,
    (_e, id, patch) => {
      assertValidId(id);
      if (!isPlainObject(patch)) throw new Error('workspace:updateConfig expects an object patch');
      assertNoPollutingKeys(patch);
      assertValidIgnoredDirs((patch as { ignoredDirs?: unknown }).ignoredDirs);
      return workspace.updateConfig(id, patch);
    },
  );

  handle<[string], WorkspaceStats | null>(IpcChannels.workspaceGetStats, (_e, id) => {
    assertValidId(id);
    return workspace.getStats(id);
  });

  handle<[string], Workspace>(IpcChannels.workspaceRescan, (_e, id) => {
    assertValidId(id);
    try {
      return workspace.rescan(id);
    } catch (err) {
      logger.warn('workspace:rescan failed', err);
      return rethrow(err);
    }
  });
}
