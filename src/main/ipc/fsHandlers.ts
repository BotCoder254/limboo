/**
 * IPC handlers for the File System Manager. Registered through `handle()`, so
 * every call inherits sender-origin validation. Inputs are validated here in the
 * main process (CLAUDE.md §6): workspace ids are type/length-checked and every
 * relative path (read AND write, source AND destination) is constrained to a
 * bounded, NUL-free, relative, non-`..`-traversing string before it ever reaches
 * the reader/writer — so a malicious renderer can never widen an operation
 * outside the workspace root. Mutation options are re-built from known boolean
 * flags only (never spread) so renderer objects cannot smuggle keys.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { FS_LIMITS } from '@shared/constants';
import type {
  FileHistoryEntry,
  FileReadResult,
  FileTree,
  FileWriteResult,
  FsMutationOptions,
} from '@shared/types';
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
 * workspace root. Mirrors the ignored-dirs guard in workspaceHandlers:
 * bounded, NUL-free, relative only, and no upward (`..`) traversal segment.
 */
function assertValidRelPath(p: unknown): asserts p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > FS_LIMITS.relPathMax) {
    throw new Error('fs: invalid path');
  }
  if (p.includes('\0')) {
    throw new Error('fs: path contains an invalid character');
  }
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new Error('fs: path must be relative');
  }
  if (p.split(/[/\\]/).some((seg) => seg === '..')) {
    throw new Error('fs: path must not traverse upward');
  }
}

/** Validate write content: a string within the File Writer's byte cap. */
function assertValidContent(c: unknown): asserts c is string {
  if (typeof c !== 'string') throw new Error('fs: invalid content');
  if (Buffer.byteLength(c, 'utf8') > FS_LIMITS.maxWriteBytes) {
    throw new Error('fs: content too large');
  }
}

/**
 * Rebuild mutation options from known boolean flags ONLY — the renderer object
 * is never spread or merged (prototype-pollution guard, CLAUDE.md §6).
 */
function sanitizeOpts(o: unknown): FsMutationOptions {
  const v = (o ?? {}) as Record<string, unknown>;
  return { overwrite: v.overwrite === true, recursive: v.recursive === true };
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

  // Reveal the workspace root (no relPath) or a specific path in the OS file
  // manager. The relPath is validated like fs:readFile; the manager additionally
  // re-checks the resolved target stays inside the workspace root.
  handle<[string, string | undefined], void>(IpcChannels.fsReveal, async (_e, id, relPath) => {
    assertValidId(id);
    if (relPath !== undefined && relPath !== '') assertValidRelPath(relPath);
    await fs.reveal(id, relPath);
  });

  // --- File Writer mutations. Every path below is re-validated by the writer's
  // own containment/symlink/.git guards; this layer rejects malformed input
  // before it ever reaches the manager.

  handle<[string, string, string, unknown], FileWriteResult>(
    IpcChannels.fsWriteFile,
    async (_e, id, relPath, content, opts) => {
      assertValidId(id);
      assertValidRelPath(relPath);
      assertValidContent(content);
      return fs.writeFile(id, relPath, content, sanitizeOpts(opts));
    },
  );

  handle<[string, string], FileWriteResult>(
    IpcChannels.fsCreateFile,
    async (_e, id, relPath) => {
      assertValidId(id);
      assertValidRelPath(relPath);
      return fs.createFile(id, relPath);
    },
  );

  handle<[string, string], FileWriteResult>(
    IpcChannels.fsCreateDir,
    async (_e, id, relPath) => {
      assertValidId(id);
      assertValidRelPath(relPath);
      return fs.createDir(id, relPath);
    },
  );

  handle<[string, string, unknown], void>(
    IpcChannels.fsDelete,
    async (_e, id, relPath, opts) => {
      assertValidId(id);
      assertValidRelPath(relPath);
      await fs.deleteEntry(id, relPath, sanitizeOpts(opts));
    },
  );

  handle<[string, string, string, unknown], FileWriteResult>(
    IpcChannels.fsRename,
    async (_e, id, fromRel, toRel, opts) => {
      assertValidId(id);
      assertValidRelPath(fromRel);
      assertValidRelPath(toRel);
      return fs.rename(id, fromRel, toRel, sanitizeOpts(opts));
    },
  );

  handle<[string, string, string, unknown], FileWriteResult>(
    IpcChannels.fsCopy,
    async (_e, id, fromRel, toRel, opts) => {
      assertValidId(id);
      assertValidRelPath(fromRel);
      assertValidRelPath(toRel);
      return fs.copy(id, fromRel, toRel, sanitizeOpts(opts));
    },
  );
}
