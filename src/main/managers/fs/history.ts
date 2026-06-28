/**
 * File History — a bounded, in-memory record of app-level interactions with a
 * workspace's files (reads, index passes, on-disk changes). Distinct from git
 * history (committed changes); this powers "recently touched" style surfaces and
 * future activity insights. Cleared when the workspace is no longer active.
 *
 * Security (CLAUDE.md §6): paths only — no file contents are ever retained here.
 */
import { FS_LIMITS } from '@shared/constants';
import type { FileHistoryEntry } from '@shared/types';

export class FileHistory {
  private entries: FileHistoryEntry[] = [];

  /** Record an interaction, evicting the oldest entry past the ring cap. */
  record(path: string, action: FileHistoryEntry['action']): void {
    this.entries.push({ path, action, at: Date.now() });
    if (this.entries.length > FS_LIMITS.historyMax) {
      this.entries.splice(0, this.entries.length - FS_LIMITS.historyMax);
    }
  }

  /** Most-recent-first snapshot. */
  list(): FileHistoryEntry[] {
    return [...this.entries].reverse();
  }

  clear(): void {
    this.entries = [];
  }
}
