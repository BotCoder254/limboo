/**
 * Git store — the renderer-side mirror of the main-process GitManager. Holds the
 * active workspace's live status, history, branches, tags, the per-session
 * checkpoints, and a small diff cache. Subscribes to `git:changed` (working-tree
 * moved) and `git:checkpoints-changed` so the Git workspace stays live as the
 * developer and the agent work.
 *
 * Degrades to empty, read-only state in a plain browser preview (no preload).
 */
import { create } from 'zustand';
import type {
  GitBranch,
  GitCheckpoint,
  GitCommit,
  GitFileDiff,
  GitStatus,
  GitTag,
} from '@shared/types';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useSessionStore } from './useSessionStore';
import { useUIStore } from './useUIStore';

/** Which Git workspace sub-view is focused (also the activity-card jump target). */
export type GitView = 'status' | 'diff' | 'commit' | 'history' | 'checkpoints' | 'branches';

interface GitFocus {
  view: GitView;
  path?: string;
  staged?: boolean;
}

interface GitState {
  status: GitStatus | null;
  log: GitCommit[];
  branches: GitBranch[];
  tags: GitTag[];
  checkpoints: GitCheckpoint[];
  /** Diff cache keyed by `${staged ? 's' : 'w'}:${path}`. */
  diffs: Record<string, GitFileDiff>;
  loading: boolean;
  /** Drives which sub-view + file the GitPanel reveals (activity-card jumps). */
  focus: GitFocus | null;
  hydrated: boolean;
  /** The commit composer's draft (streams live during AI generation). */
  commitMessage: string;
  /** True while the commit-message sub-agent is streaming a proposal. */
  generatingMessage: boolean;

  hydrate: () => void;
  setCommitMessage: (text: string) => void;
  generateCommitMessage: () => Promise<void>;
  cancelCommitMessage: () => void;
  refresh: () => Promise<void>;
  loadDiff: (path: string, staged: boolean) => Promise<GitFileDiff | null>;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discard: (path: string) => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  loadHistory: () => Promise<void>;
  loadBranches: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadCheckpoints: () => Promise<void>;
  createCheckpoint: (label: string) => Promise<void>;
  restoreCheckpoint: (checkpointId: string) => Promise<void>;
  deleteCheckpoint: (checkpointId: string) => Promise<void>;
  checkout: (branch: string, force?: boolean) => Promise<import('@shared/types').GitCheckoutResult>;
  createBranch: (name: string) => Promise<void>;
  fetch: () => Promise<boolean>;
  push: (opts?: { setUpstream?: boolean; force?: boolean }) => Promise<boolean>;
  pull: (opts?: { rebase?: boolean }) => Promise<boolean>;
  init: () => Promise<void>;
  setFocus: (focus: GitFocus | null) => void;
}

function gitApi() {
  return window.limboo?.git;
}

function activeWs(): string | null {
  return useWorkspaceStore.getState().activeId;
}

function activeSession(): string | null {
  return useSessionStore.getState().selectedId;
}

/**
 * Generation-scoped bookkeeping (module-local, not store state): the user's
 * pre-generation draft — restored when a run errors/cancels before any text
 * arrived — and whether the in-flight run produced at least one delta.
 */
let draftBackup = '';
let sawDelta = false;

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  log: [],
  branches: [],
  tags: [],
  checkpoints: [],
  diffs: {},
  loading: false,
  focus: null,
  hydrated: false,
  commitMessage: '',
  generatingMessage: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    const api = gitApi();
    if (!api) return;

    api.onChanged(({ workspaceId }) => {
      if (workspaceId === activeWs()) {
        // The working tree moved — drop the diff cache and re-pull status.
        set({ diffs: {} });
        void get().refresh();
      }
    });
    api.onCheckpointsChanged(({ sessionId }) => {
      if (sessionId === activeSession()) void get().loadCheckpoints();
    });
    api.onCommitMessageStream?.((ev) => {
      if (ev.workspaceId !== activeWs()) return;
      if (ev.kind === 'delta') {
        sawDelta = true;
        set((s) => ({ commitMessage: s.commitMessage + (ev.text ?? '') }));
      } else if (ev.kind === 'done') {
        // The done frame carries the full authoritative message — replace.
        set({ commitMessage: ev.text ?? get().commitMessage, generatingMessage: false });
      } else {
        // error / canceled: a failed run must not eat the user's draft.
        set({
          generatingMessage: false,
          ...(sawDelta ? {} : { commitMessage: draftBackup }),
        });
      }
    });

    // Initial pull + follow active-workspace switches.
    void get().refresh();
    window.limboo?.workspace.onChanged(() => {
      get().cancelCommitMessage();
      set({ diffs: {}, log: [], branches: [], tags: [], commitMessage: '', generatingMessage: false });
      void get().refresh();
    });
  },

  setCommitMessage: (text) => set({ commitMessage: text }),

  generateCommitMessage: async () => {
    const api = gitApi();
    const wsId = activeWs();
    const toast = useUIStore.getState().addToast;
    if (!api?.generateCommitMessage || !wsId || get().generatingMessage) return;
    draftBackup = get().commitMessage;
    sawDelta = false;
    set({ generatingMessage: true, commitMessage: '' });
    try {
      const r = await api.generateCommitMessage(wsId);
      if (!r.ok && r.reason !== 'canceled') {
        if (r.reason === 'no-staged') {
          toast({ title: 'Nothing staged', description: 'Stage changes first.', tone: 'warning' });
        } else if (r.reason === 'agent-unavailable') {
          toast({
            title: 'Claude Code unavailable',
            description: r.error ?? 'Sign in to Claude Code to generate commit messages.',
            tone: 'danger',
          });
        } else if (r.reason === 'busy') {
          toast({ title: 'Already generating', description: 'A commit message is being generated.', tone: 'warning' });
        } else if (r.reason === 'rate-limited') {
          toast({ title: 'Rate limited', description: r.error, tone: 'warning' });
        } else {
          toast({ title: 'Generation failed', description: r.error, tone: 'danger' });
        }
      }
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      // Backstop — the stream's terminal frame normally clears this first; if it
      // never arrived (e.g. an early invoke error), restore the user's draft.
      if (get().generatingMessage) {
        set({
          generatingMessage: false,
          ...(sawDelta ? {} : { commitMessage: draftBackup }),
        });
      }
    }
  },

  cancelCommitMessage: () => {
    const wsId = activeWs();
    if (wsId && get().generatingMessage) void gitApi()?.cancelCommitMessage?.(wsId);
  },

  refresh: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) {
      set({ status: null });
      return;
    }
    set({ loading: true });
    try {
      const status = await api.status(wsId);
      set({ status });
    } finally {
      set({ loading: false });
    }
  },

  loadDiff: async (path, staged) => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return null;
    const diff = await api.diff(wsId, path, { staged });
    set((s) => ({ diffs: { ...s.diffs, [`${staged ? 's' : 'w'}:${path}`]: diff } }));
    return diff;
  },

  stage: async (path) => {
    const wsId = activeWs();
    if (wsId) await gitApi()?.stage(wsId, path);
  },
  unstage: async (path) => {
    const wsId = activeWs();
    if (wsId) await gitApi()?.unstage(wsId, path);
  },
  stageAll: async () => {
    const wsId = activeWs();
    if (wsId) await gitApi()?.stageAll(wsId);
  },
  unstageAll: async () => {
    const wsId = activeWs();
    if (wsId) await gitApi()?.unstageAll(wsId);
  },
  discard: async (path) => {
    const wsId = activeWs();
    if (wsId) await gitApi()?.discard(wsId, path);
  },

  commit: async (message) => {
    const wsId = activeWs();
    if (!wsId) return false;
    const result = await gitApi()?.commit(wsId, message);
    await get().refresh();
    await get().loadHistory();
    return !!result;
  },

  loadHistory: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    set({ log: await api.log(wsId, { limit: 100 }) });
  },
  loadBranches: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    set({ branches: await api.branches(wsId) });
  },
  loadTags: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    set({ tags: await api.tags(wsId) });
  },
  loadCheckpoints: async () => {
    const api = gitApi();
    const sid = activeSession();
    if (!api || !sid) {
      set({ checkpoints: [] });
      return;
    }
    set({ checkpoints: await api.checkpointList(sid) });
  },

  createCheckpoint: async (label) => {
    const api = gitApi();
    const wsId = activeWs();
    const sid = activeSession();
    if (!api || !wsId || !sid) return;
    await api.checkpointCreate(wsId, sid, label);
  },
  restoreCheckpoint: async (checkpointId) => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    await api.checkpointRestore(wsId, checkpointId);
    await get().refresh();
  },
  deleteCheckpoint: async (checkpointId) => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    await api.checkpointDelete(wsId, checkpointId);
  },

  checkout: async (branch, force) => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return { ok: false, error: 'No workspace' };
    const result = await api.checkout(wsId, branch, { force });
    if (result.ok) {
      await get().refresh();
      await get().loadBranches();
    }
    return result;
  },
  createBranch: async (name) => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    await api.createBranch(wsId, name, true);
    await get().refresh();
    await get().loadBranches();
  },
  fetch: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return false;
    const ok = await api.fetch(wsId);
    await get().refresh();
    return ok;
  },

  push: async (opts) => {
    const api = gitApi();
    const wsId = activeWs();
    const toast = useUIStore.getState().addToast;
    if (!api || !wsId) return false;
    try {
      const r = await api.push(wsId, opts);
      await get().refresh();
      if (r.ok) {
        toast({
          title: r.setUpstream ? 'Published branch' : 'Pushed to remote',
          description: r.pushed ? `${r.pushed} commit${r.pushed === 1 ? '' : 's'} pushed.` : undefined,
          tone: 'success',
        });
        return true;
      }
      if (r.noRemote) {
        toast({ title: 'No remote configured', description: 'Add a git remote to push.', tone: 'warning' });
      } else if (r.noUpstream) {
        toast({ title: 'Branch not published', description: 'Use Publish branch to set its upstream.', tone: 'warning' });
      } else if (r.authFailed) {
        toast({ title: 'No credentials for this remote', description: 'Configure your git credential helper or SSH key, then retry.', tone: 'danger' });
      } else if (r.rejected || r.needsPull) {
        toast({ title: 'Push rejected — pull first', description: 'The remote has new commits. Pull, then push again.', tone: 'danger' });
      } else {
        toast({ title: 'Push failed', description: r.error, tone: 'danger' });
      }
      return false;
    } catch (err) {
      toast({ title: 'Push failed', description: err instanceof Error ? err.message : String(err), tone: 'danger' });
      return false;
    }
  },

  pull: async (opts) => {
    const api = gitApi();
    const wsId = activeWs();
    const toast = useUIStore.getState().addToast;
    if (!api || !wsId) return false;
    try {
      const r = await api.pull(wsId, opts);
      set({ diffs: {} });
      await get().refresh();
      await get().loadHistory();
      if (r.ok) {
        toast({
          title: r.upToDate ? 'Already up to date' : 'Pulled from remote',
          tone: r.upToDate ? 'info' : 'success',
        });
        return true;
      }
      if (r.noUpstream) {
        toast({ title: 'Nothing to pull', description: 'This branch has no upstream.', tone: 'warning' });
      } else if (r.notFastForward) {
        toast({ title: 'Cannot fast-forward', description: 'Local and remote have diverged. Try a rebase pull.', tone: 'danger' });
      } else if (r.conflicts) {
        toast({ title: 'Pull stopped on conflicts', description: 'Resolve the conflicts in the changes list, then commit.', tone: 'danger' });
      } else {
        toast({ title: 'Pull failed', description: r.error, tone: 'danger' });
      }
      return false;
    } catch (err) {
      toast({ title: 'Pull failed', description: err instanceof Error ? err.message : String(err), tone: 'danger' });
      return false;
    }
  },
  init: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    await api.init(wsId);
    await get().refresh();
  },

  setFocus: (focus) => set({ focus }),
}));
