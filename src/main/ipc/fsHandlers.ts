/**
 * IPC handlers for the File System Manager. Registered through `handle()`, so
 * every call inherits sender-origin validation. Inputs are validated here in the
 * main process (CLAUDE.md §6): workspace ids are type/length-checked and the
 * `fs:readFile` relative path is constrained to a bounded, NUL-free, relative,
 * non-`..`-traversing string before it ever reaches the reader — so a malicious
 * renderer can never widen a read outside the workspace root.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { FS_LIMITS } from '@shared/constants';
import type { FileHistoryEntry, FileReadResult, FileTree } from '@shared/types';
import { handle } from './registry';
import type { FileSystemManager } from '../managers/FileSystemManager';
import { logger } from '../logger';

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('fs: invalid workspace id');
  }
}

/**
 * Validate a renderer-supplied relative file path before it is joined to a
 * workspace root and read. Mirrors the ignored-dirs guard in workspaceHandlers:
 * bounded, NUL-free, relative only, and no upward (`..`) traversal segment.
 */
function assertValidRelPath(p: unknown): asserts p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > FS_LIMITS.relPathMax) {
    throw new Error('fs:readFile invalid path');
  }
  if (p.includes('\0')) {
    throw new Error('fs:readFile path contains an invalid character');
  }
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new Error('fs:readFile path must be relative');
  }
  if (p.split(/[/\\]/).some((seg) => seg === '..')) {
    throw new Error('fs:readFile path must not traverse upward');
  }
}

export function registerFsHandlers(fs: FileSystemManager): void {
  handle<[string], FileTree>(IpcChannels.fsIndex, async (_e, id) => {
    assertValidId(id);
    try {
      return await fs.index(id);
    } catch (err) {
      logger.warn('fs:index failed', err);
      throw err;
    }
  });

  handle<[string], FileTree | null>(IpcChannels.fsGetTree, (_e, id) => {
    assertValidId(id);
    return fs.getTree(id);
  });

  handle<[string, string], FileReadResult>(IpcChannels.fsReadFile, (_e, id, relPath) => {
    assertValidId(id);
    assertValidRelPath(relPath);
    return fs.readFile(id, relPath);
  });

  handle<[string], FileHistoryEntry[]>(IpcChannels.fsGetHistory, (_e, id) => {
    assertValidId(id);
    return fs.getHistory(id);
  });
}
