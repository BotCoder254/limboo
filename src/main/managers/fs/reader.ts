/**
 * Centralized File Reader. The agent and the renderer never open files directly —
 * they request contents through this path so validation, boundary enforcement,
 * binary detection, size caps, and history recording all stay in one place.
 *
 * Security (CLAUDE.md §6):
 *   - the requested relative path is resolved against the workspace root and the
 *     result must stay inside it ({@link isInsideRoot});
 *   - symlinks are resolved with `realpath` and the REAL path is re-checked for
 *     containment, so a symlink can never read outside the workspace;
 *   - binary content (NUL sniff) is never returned as text;
 *   - reads above {@link FS_LIMITS.maxReadBytes} return a typed marker, not bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FS_LIMITS } from '@shared/constants';
import type { FileReadResult } from '@shared/types';
import { isInsideRoot } from '../workspace/validate';

/** Thrown when a read is rejected for a security/validation reason. */
export class FileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileReadError';
  }
}

/** NUL-byte sniff of the head of a buffer — the classic text/binary heuristic. */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, FS_LIMITS.binarySniffBytes);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Strip a leading UTF-8 BOM if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read a workspace-relative file. `relPath` is expected to already be a bounded,
 * NUL-free, relative, non-traversing string (validated at the IPC boundary); the
 * containment re-checks here are defense in depth.
 */
export function readWorkspaceFile(root: string, relPath: string): FileReadResult {
  const normalized = relPath.split('/').join(path.sep);
  const target = path.resolve(root, normalized);
  if (!isInsideRoot(root, target)) {
    throw new FileReadError('Path escapes the workspace root.');
  }

  // Resolve symlinks, then re-assert the REAL path is still inside the root.
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw new FileReadError('File does not exist or is not accessible.');
  }
  if (!isInsideRoot(root, real)) {
    throw new FileReadError('Resolved path escapes the workspace root.');
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    throw new FileReadError('Could not read that path.');
  }
  if (!stat.isFile()) {
    throw new FileReadError('Not a regular file.');
  }

  const size = stat.size;
  const posixPath = relPath.split(path.sep).join('/');

  if (size > FS_LIMITS.maxReadBytes) {
    return { path: posixPath, encoding: 'utf-8', isBinary: false, size, tooLarge: true };
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(real);
  } catch {
    throw new FileReadError('Could not read that file.');
  }

  if (looksBinary(buf)) {
    return { path: posixPath, encoding: 'utf-8', isBinary: true, size, tooLarge: false };
  }

  return {
    path: posixPath,
    content: stripBom(buf.toString('utf8')),
    encoding: 'utf-8',
    isBinary: false,
    size,
    tooLarge: false,
  };
}
