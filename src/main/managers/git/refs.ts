/**
 * Shared git ref/revision sanitizer used by both the Git Manager and the
 * Worktree Manager, so every subsystem applies the identical guard.
 *
 * Security (CLAUDE.md §6): refs are always passed as a single argv element
 * (never through a shell), so this is defense in depth against
 * `--upload-pack=…`-style argument injection and ref metacharacter abuse.
 */
import { GIT_LIMITS } from '@shared/constants';

/**
 * Reject ref/revision strings that try to smuggle options (leading `-`) or
 * shell/ref metacharacters. Returns the ref unchanged when safe.
 */
export function sanitizeRef(ref: string): string {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > GIT_LIMITS.refNameMax) {
    throw new Error('git: invalid ref');
  }
  if (ref.startsWith('-') || /[\s~^:?*[\\\0]/.test(ref)) {
    throw new Error('git: unsafe ref');
  }
  return ref;
}
