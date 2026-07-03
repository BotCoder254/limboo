/**
 * IPC handlers for the Worktree Manager. Registered through `handle()`, so every
 * call inherits sender-origin validation. Inputs are validated here in the main
 * process (CLAUDE.md §6): ids are type/length-checked before reaching the
 * manager; the manager itself sanitizes refs and guards every filesystem path.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SESSION_LIMITS } from '@shared/constants';
import type { RepoConfigState, Session, WorktreeInfo } from '@shared/types';
import { handle } from './registry';
import type { WorktreeManager } from '../managers/worktree/WorktreeManager';

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > SESSION_LIMITS.idMax) {
    throw new Error('worktree: invalid id');
  }
}

export function registerWorktreeHandlers(worktrees: WorktreeManager): void {
  handle<[string], WorktreeInfo[]>(IpcChannels.worktreeList, (_e, workspaceId) => {
    assertValidId(workspaceId);
    return worktrees.list(workspaceId);
  });

  handle<[string], boolean>(IpcChannels.worktreePrune, (_e, workspaceId) => {
    assertValidId(workspaceId);
    return worktrees.prune(workspaceId);
  });

  handle<[string], Session>(IpcChannels.worktreeRecreate, (_e, sessionId) => {
    assertValidId(sessionId);
    return worktrees.recreateForSession(sessionId);
  });

  handle<[string], Session>(IpcChannels.worktreeDetach, (_e, sessionId) => {
    assertValidId(sessionId);
    return worktrees.detachForSession(sessionId);
  });

  handle<[string], RepoConfigState>(IpcChannels.worktreeGetRepoConfig, (_e, sessionId) => {
    assertValidId(sessionId);
    return worktrees.getRepoConfigState(sessionId);
  });

  handle<[string, string], void>(IpcChannels.worktreeAckConfig, (_e, sessionId, ackHash) => {
    assertValidId(sessionId);
    assertValidAckHash(ackHash);
    worktrees.ackConfig(sessionId, ackHash);
  });

  handle<[string, string], void>(IpcChannels.worktreeRunSetup, (_e, sessionId, ackHash) => {
    assertValidId(sessionId);
    assertValidAckHash(ackHash);
    return worktrees.runSetup(sessionId, ackHash);
  });
}

function assertValidAckHash(ackHash: unknown): asserts ackHash is string {
  if (typeof ackHash !== 'string' || ackHash.length === 0 || ackHash.length > 128) {
    throw new Error('worktree: invalid acknowledgment hash');
  }
}
