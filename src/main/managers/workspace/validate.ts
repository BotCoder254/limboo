/**
 * Workspace validation pipeline. Runs before a directory is registered as a
 * workspace. Returns structured diagnostics rather than throwing so the UI can
 * explain exactly what went wrong (CLAUDE.md: no silent failures).
 *
 * Security (CLAUDE.md §6): rejects forbidden system roots, the home directory
 * itself, and confirms the resolved (symlink-followed) real path is a readable,
 * writable directory before anything else touches it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FORBIDDEN_WORKSPACE_PATHS } from '@shared/constants';
import type { WorkspaceValidationResult } from '@shared/types';

export interface ValidationContext {
  /** Absolute paths already registered, to reject duplicates. */
  existingPaths: string[];
}

/**
 * Validate a candidate directory. Returns the canonical (real) path alongside
 * the result so the caller stores a single normalized form.
 */
export function validateWorkspacePath(
  input: string,
  ctx: ValidationContext,
): { result: WorkspaceValidationResult; realPath: string } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'string' || input.trim() === '') {
    return { result: { ok: false, errors: ['No directory was provided.'], warnings }, realPath: '' };
  }
  if (input.includes('\0')) {
    return { result: { ok: false, errors: ['Path contains an invalid character.'], warnings }, realPath: '' };
  }

  // Resolve symlinks to the canonical path so all checks act on the real target.
  let realPath: string;
  try {
    realPath = fs.realpathSync(path.resolve(input));
  } catch {
    return {
      result: { ok: false, errors: ['That directory does not exist or is not accessible.'], warnings },
      realPath: '',
    };
  }

  // Must be a directory.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { result: { ok: false, errors: ['Could not read that path.'], warnings }, realPath };
  }
  if (!stat.isDirectory()) {
    errors.push('The selected path is not a directory.');
  }

  // Forbidden system roots + the home directory itself.
  const normalized = realPath.replace(/\/+$/, '') || '/';
  if (FORBIDDEN_WORKSPACE_PATHS.includes(normalized as (typeof FORBIDDEN_WORKSPACE_PATHS)[number])) {
    errors.push('That system directory cannot be used as a workspace.');
  }
  if (normalized === os.homedir().replace(/\/+$/, '')) {
    errors.push('Your home directory itself cannot be a workspace — pick a project folder inside it.');
  }

  // Permissions: must be readable and writable.
  try {
    fs.accessSync(realPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    errors.push('You do not have read/write permission for that directory.');
  }

  // Duplicate registration.
  if (ctx.existingPaths.some((p) => p === realPath)) {
    errors.push('This folder is already registered as a workspace.');
  }

  return { result: { ok: errors.length === 0, errors, warnings }, realPath };
}

/**
 * Guard that a path stays inside a workspace root (path-traversal protection).
 * Used before any fs walk/stat the manager performs on a workspace.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
