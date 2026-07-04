/**
 * IPC handlers for the Git Manager. Registered through `handle()`, so every call
 * inherits sender-origin validation. All renderer input is validated here in the
 * main process (CLAUDE.md §6): ids are length-checked, messages/labels are capped,
 * and file paths are validated against the repo root inside the manager. Git is
 * always spawned argv-style (never a shell) by the manager.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { GIT_LIMITS } from '@shared/constants';
import type {
  GenerateCommitMessageResult,
  GitBlameLine,
  GitBranch,
  GitCheckoutResult,
  GitCheckpoint,
  GitCommit,
  GitCommitDetail,
  GitFileChange,
  GitFileDiff,
  GitPullResult,
  GitPushResult,
  GitStatus,
  GitTag,
} from '@shared/types';
import { handle } from './registry';
import type { GitManager } from '../managers/GitManager';
import type { AgentManager } from '../managers/AgentManager';

function assertId(id: unknown, label = 'id'): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error(`git: invalid ${label}`);
  }
}

/**
 * Validate a renderer-supplied options object: every value must be a boolean and
 * every key must be in the allow-list. Rejecting unknown keys / non-primitive
 * values is defense in depth against prototype pollution and argument smuggling.
 */
function assertBoolOpts(opts: unknown, allowed: string[], label: string): void {
  if (opts === undefined) return;
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    throw new Error(`git: invalid ${label}`);
  }
  for (const key of Object.keys(opts)) {
    if (!allowed.includes(key)) throw new Error(`git: unexpected ${label} key: ${key}`);
    const v = (opts as Record<string, unknown>)[key];
    if (v !== undefined && typeof v !== 'boolean') {
      throw new Error(`git: ${label}.${key} must be a boolean`);
    }
  }
}

function assertText(value: unknown, max: number, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`git: invalid ${label}`);
  }
}

export function registerGitHandlers(git: GitManager, agent: AgentManager): void {
  handle<[string], GitStatus>(IpcChannels.gitStatus, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.status(wsId);
  });

  handle<[string, string, { staged?: boolean; baseRef?: string }?], GitFileDiff>(
    IpcChannels.gitDiff,
    (_e, wsId, path, opts) => {
      assertId(wsId, 'workspaceId');
      return git.diff(wsId, path, opts ?? {});
    },
  );

  handle<[string, string], void>(IpcChannels.gitStage, (_e, wsId, path) => {
    assertId(wsId, 'workspaceId');
    return git.stage(wsId, path);
  });

  handle<[string, string], void>(IpcChannels.gitUnstage, (_e, wsId, path) => {
    assertId(wsId, 'workspaceId');
    return git.unstage(wsId, path);
  });

  handle<[string], void>(IpcChannels.gitStageAll, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.stageAll(wsId);
  });

  handle<[string], void>(IpcChannels.gitUnstageAll, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.unstageAll(wsId);
  });

  handle<[string, string], void>(IpcChannels.gitDiscard, (_e, wsId, path) => {
    assertId(wsId, 'workspaceId');
    return git.discard(wsId, path);
  });

  handle<[string, string], GitCommit | null>(IpcChannels.gitCommit, (_e, wsId, message) => {
    assertId(wsId, 'workspaceId');
    assertText(message, GIT_LIMITS.commitMessageMax, 'commit message');
    return git.commit(wsId, message);
  });

  // AI commit-message generation: the ONLY renderer input is the workspace id —
  // all git context (status / staged diff / recent subjects) is assembled in the
  // main process by GitManager and size-capped by GIT_LIMITS.commitGen. The
  // sub-agent run is tool-less and only proposes text; it never commits.
  handle<[string], GenerateCommitMessageResult>(
    IpcChannels.gitCommitMessageGenerate,
    async (_e, wsId) => {
      assertId(wsId, 'workspaceId');
      const ctx = await git.buildCommitContext(wsId);
      if (!ctx) return { ok: false, reason: 'error', error: 'Not a git repository' };
      if (ctx.files.length === 0) return { ok: false, reason: 'no-staged' };
      return agent.generateCommitMessage(wsId, ctx);
    },
  );

  handle<[string], void>(IpcChannels.gitCommitMessageCancel, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    agent.cancelCommitMessage(wsId);
  });

  handle<[string, { limit?: number; offset?: number }?], GitCommit[]>(
    IpcChannels.gitLog,
    (_e, wsId, opts) => {
      assertId(wsId, 'workspaceId');
      return git.log(wsId, opts ?? {});
    },
  );

  handle<[string, string], GitCommitDetail | null>(
    IpcChannels.gitCommitDetail,
    (_e, wsId, hash) => {
      assertId(wsId, 'workspaceId');
      assertText(hash, GIT_LIMITS.refNameMax, 'commit hash');
      return git.commitDetail(wsId, hash);
    },
  );

  handle<[string], GitBranch[]>(IpcChannels.gitBranches, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.branches(wsId);
  });

  handle<[string, string, { force?: boolean }?], GitCheckoutResult>(
    IpcChannels.gitCheckout,
    (_e, wsId, branch, opts) => {
      assertId(wsId, 'workspaceId');
      assertText(branch, GIT_LIMITS.refNameMax, 'branch');
      return git.checkout(wsId, branch, opts ?? {});
    },
  );

  handle<[string, string, boolean?], GitCheckoutResult>(
    IpcChannels.gitCreateBranch,
    (_e, wsId, name, checkout) => {
      assertId(wsId, 'workspaceId');
      assertText(name, GIT_LIMITS.refNameMax, 'branch name');
      return git.createBranch(wsId, name, checkout !== false);
    },
  );

  handle<[string], GitTag[]>(IpcChannels.gitTags, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.tags(wsId);
  });

  handle<[string, string, string?], void>(IpcChannels.gitCreateTag, (_e, wsId, name, message) => {
    assertId(wsId, 'workspaceId');
    assertText(name, GIT_LIMITS.refNameMax, 'tag name');
    if (message !== undefined && (typeof message !== 'string' || message.length > GIT_LIMITS.commitMessageMax)) {
      throw new Error('git: invalid tag message');
    }
    return git.createTag(wsId, name, message);
  });

  handle<[string, string], GitBlameLine[]>(IpcChannels.gitBlame, (_e, wsId, path) => {
    assertId(wsId, 'workspaceId');
    return git.blame(wsId, path);
  });

  handle<[string], boolean>(IpcChannels.gitFetch, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.fetch(wsId);
  });

  handle<[string, { setUpstream?: boolean; force?: boolean }?], GitPushResult>(
    IpcChannels.gitPush,
    (_e, wsId, opts) => {
      assertId(wsId, 'workspaceId');
      assertBoolOpts(opts, ['setUpstream', 'force'], 'push options');
      return git.push(wsId, opts ?? {});
    },
  );

  handle<[string, { rebase?: boolean }?], GitPullResult>(
    IpcChannels.gitPull,
    (_e, wsId, opts) => {
      assertId(wsId, 'workspaceId');
      assertBoolOpts(opts, ['rebase'], 'pull options');
      return git.pull(wsId, opts ?? {});
    },
  );

  handle<[string], boolean>(IpcChannels.gitInit, (_e, wsId) => {
    assertId(wsId, 'workspaceId');
    return git.init(wsId);
  });

  handle<[string, string, string, { messageId?: string }?], GitCheckpoint | null>(
    IpcChannels.gitCheckpointCreate,
    (_e, wsId, sessionId, label, opts) => {
      assertId(wsId, 'workspaceId');
      assertId(sessionId, 'sessionId');
      assertText(label, GIT_LIMITS.refNameMax, 'checkpoint label');
      return git.createCheckpoint(wsId, sessionId, label, { ...opts });
    },
  );

  handle<[string], GitCheckpoint[]>(IpcChannels.gitCheckpointList, (_e, sessionId) => {
    assertId(sessionId, 'sessionId');
    return git.listCheckpoints(sessionId);
  });

  handle<[string, string], GitFileChange[]>(
    IpcChannels.gitCheckpointDiff,
    (_e, wsId, checkpointId) => {
      assertId(wsId, 'workspaceId');
      assertId(checkpointId, 'checkpointId');
      return git.diffCheckpoint(wsId, checkpointId);
    },
  );

  handle<[string, string], boolean>(
    IpcChannels.gitCheckpointRestore,
    (_e, wsId, checkpointId) => {
      assertId(wsId, 'workspaceId');
      assertId(checkpointId, 'checkpointId');
      return git.restoreCheckpoint(wsId, checkpointId);
    },
  );

  handle<[string, string], void>(IpcChannels.gitCheckpointDelete, (_e, wsId, checkpointId) => {
    assertId(wsId, 'workspaceId');
    assertId(checkpointId, 'checkpointId');
    return git.deleteCheckpoint(wsId, checkpointId);
  });
}
