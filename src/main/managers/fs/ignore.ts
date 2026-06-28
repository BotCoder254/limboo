/**
 * Centralized ignore handling for the File System Layer. Every subsystem (tree
 * indexer, watcher, reader) shares one matcher so they operate over an identical
 * view of the repository instead of each re-implementing exclusion logic.
 *
 * The matcher is built from three sources, in increasing specificity:
 *   1. {@link DEFAULT_IGNORED_DIRS} — the always-excluded heavy directories.
 *   2. the workspace's `config.ignoredDirs` (already validated to be relative,
 *      NUL-free, non-traversing in workspaceHandlers).
 *   3. the repo-root `.gitignore` / `.ignore` files, if present (size-capped).
 *
 * Security (CLAUDE.md §6): ignore files are read with a hard size cap and never
 * logged. Paths handed to {@link IgnoreMatcher.ignores} must be workspace-relative
 * POSIX paths — absolute paths are rejected by the underlying library.
 */
import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { DEFAULT_IGNORED_DIRS } from '@shared/constants';
import type { WorkspaceConfig } from '@shared/types';

/** Hard cap on how many bytes of an ignore file we will read. */
const MAX_IGNORE_FILE_BYTES = 256 * 1024;

const IGNORE_FILES = ['.gitignore', '.ignore'];

export interface IgnoreMatcher {
  /**
   * Whether a workspace-relative path is ignored. `relPath` must use POSIX
   * separators and must NOT be absolute. The empty string (root) is never
   * ignored.
   */
  ignores(relPath: string): boolean;
}

function safeRead(file: string): string {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_IGNORE_FILE_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Build a matcher for a workspace root. The default and configured directory
 * names are added as bare names so gitignore semantics match them at any depth
 * (e.g. `node_modules` excludes nested ones too).
 */
export function buildIgnoreMatcher(root: string, config: WorkspaceConfig): IgnoreMatcher {
  const ig: Ignore = ignore();

  // Always-ignored heavy dirs (incl. .git/.next/.cache/.venv) + the user's
  // configured exclusions. Other dotfiles/dot-dirs (.gitignore, .github, …) are
  // intentionally kept visible so the tree reads like a real file explorer.
  ig.add([...DEFAULT_IGNORED_DIRS]);
  ig.add(config.ignoredDirs);

  for (const name of IGNORE_FILES) {
    const content = safeRead(path.join(root, name));
    if (content) ig.add(content);
  }

  return {
    ignores(relPath: string): boolean {
      if (!relPath) return false;
      const normalized = relPath.split(path.sep).join('/');
      if (normalized === '' || normalized === '.') return false;
      return ig.ignores(normalized);
    },
  };
}
