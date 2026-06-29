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

  hydrate: () => void;
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

    // Initial pull + follow active-workspace switches.
    void get().refresh();
    window.limboo?.workspace.onChanged(() => {
      set({ diffs: {}, log: [], branches: [], tags: [] });
      void get().refresh();
    });
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
  init: async () => {
    const api = gitApi();
    const wsId = activeWs();
    if (!api || !wsId) return;
    await api.init(wsId);
    await get().refresh();
  },

  setFocus: (focus) => set({ focus }),
}));
