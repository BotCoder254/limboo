/**
 * Session store — the renderer-side mirror of the main-process SessionManager.
 *
 * `hydrate()` loads the sessions for the active workspace through the preload
 * bridge and subscribes to live changes (`onUpdated` / `onActiveChanged`). It
 * also follows the active workspace: switching workspaces re-fetches the list.
 * All mutations go through `window.limboo.session.*`; the broadcast keeps every
 * surface in sync. In a plain browser preview (no preload) it degrades to an
 * empty, read-only list so the UI still renders.
 *
 * View state (search filter, sort order, show archived / trash) lives here too
 * since it is purely presentational and shared across the sidebar surfaces.
 */
import { create } from 'zustand';
import type { RepoConfig, Session, SessionDeleteOptions, SessionSort } from '@shared/types';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useSettingsStore } from './useSettingsStore';
import { useServiceStore } from './useServiceStore';
import { useUIStore } from './useUIStore';

interface SessionState {
  sessions: Session[];
  trash: Session[];
  selectedId: string | null;
  hydrated: boolean;

  // View state (presentational, not persisted).
  filter: string;
  sort: SessionSort;
  showArchived: boolean;
  showTrash: boolean;
  /** Group the sidebar's session list by user-defined folders. */
  groupByFolder: boolean;
  /** Session awaiting delete confirmation (worktree-backed sessions only). */
  deleteDialogId: string | null;
  /** Pending repo-config confirmation (repo-authored commands shown verbatim). */
  hooksPrompt: { sessionId: string; config: RepoConfig; hash: string } | null;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  createSession: (title?: string) => Promise<string | null>;
  /** Create a session that owns a dedicated git worktree (isolated checkout). */
  createSessionInWorktree: (title?: string) => Promise<string | null>;
  selectSession: (id: string) => Promise<void>;
  /** Cycle the active session through the worktree tab strip (Ctrl+Tab). */
  cycleWorktreeTab: (direction: 1 | -1) => Promise<void>;
  removeSession: (id: string, opts?: SessionDeleteOptions) => Promise<void>;
  /**
   * Entry point for the sidebar's Delete action: worktree-backed sessions get
   * the dependency-summary dialog; plain sessions keep the one-click fast path.
   */
  requestDelete: (id: string) => Promise<void>;
  closeDeleteDialog: () => void;
  /** Offer/run setup hooks for a freshly provisioned worktree session. */
  maybePromptSetup: (sessionId: string) => Promise<void>;
  /** Explicitly open the repo-config review dialog (ServicesStrip affordance). */
  promptRepoConfig: (sessionId: string) => Promise<void>;
  /** Confirm / dismiss the pending repo-config prompt. */
  confirmSetupHooks: () => Promise<void>;
  dismissSetupHooks: () => void;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  archiveDone: () => Promise<void>;
  duplicate: (id: string, cloneWorktree?: boolean) => Promise<void>;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;

  setFolder: (id: string, folder: string | null) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;

  setFilter: (filter: string) => void;
  setSort: (sort: SessionSort) => void;
  toggleArchived: () => void;
  toggleTrash: () => void;
  toggleGroupByFolder: () => void;
}

/** Resolve the session bridge, warning (dev) when it is unexpectedly absent. */
function sessionApi() {
  const api = window.limboo?.session;
  if (!api && typeof console !== 'undefined') {
    console.warn('[limboo] window.limboo.session is unavailable — the preload bridge did not load.');
  }
  return api;
}

function activeWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeId;
}

/** Human-readable message from an IPC rejection (strips the Electron prefix). */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

/** Whether the repo config declares anything executable (worth confirming). */
function declaresCommands(config: RepoConfig): boolean {
  return (
    config.setup.length > 0 ||
    config.teardown.length > 0 ||
    Object.keys(config.scripts).length > 0 ||
    Object.keys(config.services).length > 0
  );
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  trash: [],
  selectedId: null,
  hydrated: false,

  filter: '',
  sort: 'recent',
  showArchived: false,
  showTrash: false,
  groupByFolder: true,
  deleteDialogId: null,
  hooksPrompt: null,

  hydrate: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    const api = window.limboo?.session;
    if (!api) return;

    api.onUpdated(() => void get().refresh());
    api.onActiveChanged((session) => set({ selectedId: session?.id ?? null }));
    // Follow the active workspace: a switch re-scopes the session list.
    useWorkspaceStore.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) void get().refresh();
    });

    await get().refresh();
  },

  refresh: async () => {
    const api = sessionApi();
    const wsId = activeWorkspaceId();
    if (!api || !wsId) {
      set({ sessions: [], trash: [], selectedId: null });
      return;
    }
    const [sessions, trash, active] = await Promise.all([
      api.list(wsId),
      get().showTrash ? api.list(wsId, true) : Promise.resolve([] as Session[]),
      api.getActive(),
    ]);
    // Keep the active selection only if it belongs to this workspace; otherwise
    // fall back to the most recent session so the center column always has one.
    const selectedId =
      active && sessions.some((s) => s.id === active.id)
        ? active.id
        : (sessions[0]?.id ?? null);
    set({ sessions, trash, selectedId });
  },

  createSession: async (title) => {
    const api = sessionApi();
    const wsId = activeWorkspaceId();
    if (!api || !wsId) return null;
    const session = await api.create(wsId, title);
    return session.id;
  },

  createSessionInWorktree: async (title) => {
    const api = sessionApi();
    const wsId = activeWorkspaceId();
    if (!api || !wsId) return null;
    try {
      const session = await api.createInWorktree(wsId, title ? { title } : undefined);
      // Fresh worktrees start without deps/ignored files — offer the repo's
      // setup hooks (confirm-gated; repo config is untrusted until acked).
      void get().maybePromptSetup(session.id);
      return session.id;
    } catch (err) {
      // The session survives as a plain session when worktree provisioning
      // fails — surface why so the user can retry or fix the repo state.
      useUIStore.getState().addToast({
        tone: 'danger',
        title: 'Worktree creation failed',
        description: errorMessage(err),
      });
      return null;
    }
  },

  selectSession: async (id) => {
    set({ selectedId: id }); // optimistic; the broadcast confirms
    await sessionApi()?.setActive(id);
  },

  cycleWorktreeTab: async (direction) => {
    const { sessions, selectedId } = get();
    // The tab strip = every worktree-backed session plus the active session.
    const tabs = sessions.filter((s) => s.worktreePath || s.id === selectedId);
    if (tabs.length < 2) return;
    const index = tabs.findIndex((s) => s.id === selectedId);
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next && next.id !== selectedId) await get().selectSession(next.id);
  },

  removeSession: async (id, opts) => {
    try {
      await sessionApi()?.delete(id, opts);
    } catch (err) {
      useUIStore.getState().addToast({
        tone: 'danger',
        title: 'Delete failed',
        description: errorMessage(err),
      });
    }
  },

  requestDelete: async (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (session && (session.worktreePath || session.worktreeBranch)) {
      set({ deleteDialogId: id });
      return;
    }
    await get().removeSession(id);
  },

  closeDeleteDialog: () => set({ deleteDialogId: null }),

  /**
   * After a worktree is provisioned: run setup hooks directly when the config
   * is already acknowledged (and confirmation is off), otherwise surface the
   * confirm dialog listing the exact repo-authored commands. The prompt covers
   * the WHOLE executable config — a repo declaring only scripts/services (no
   * setup hooks) still needs the acknowledgment before anything can run.
   */
  maybePromptSetup: async (sessionId: string) => {
    const wt = window.limboo?.worktree;
    if (!wt) return;
    const prefs = useSettingsStore.getState().settings.git.worktrees;
    if (!prefs.autoSetup) return;
    try {
      const state = await wt.getRepoConfig(sessionId);
      if (!state.config || !declaresCommands(state.config)) return;
      if (state.acked) {
        if (!prefs.confirmHooks) {
          if (state.config.setup.length > 0) await wt.runSetup(sessionId, state.hash);
          return;
        }
        // Already trusted and nothing to run — don't re-prompt for nothing.
        if (state.config.setup.length === 0) return;
      }
      set({ hooksPrompt: { sessionId, config: state.config, hash: state.hash } });
    } catch (err) {
      useUIStore.getState().addToast({
        title: 'Worktree setup failed',
        description: errorMessage(err),
        tone: 'danger',
      });
    }
  },

  /**
   * Explicit "Review commands…" entry point (ServicesStrip): always shows the
   * dialog when the config declares anything executable, regardless of the
   * autoSetup preference (that pref only gates the auto-offer on creation).
   */
  promptRepoConfig: async (sessionId: string) => {
    const wt = window.limboo?.worktree;
    if (!wt) return;
    try {
      const state = await wt.getRepoConfig(sessionId);
      if (!state.config || !declaresCommands(state.config)) return;
      set({ hooksPrompt: { sessionId, config: state.config, hash: state.hash } });
    } catch (err) {
      useUIStore.getState().addToast({
        title: 'Could not read limboo.json',
        description: errorMessage(err),
        tone: 'danger',
      });
    }
  },

  confirmSetupHooks: async () => {
    const prompt = get().hooksPrompt;
    if (!prompt) return;
    set({ hooksPrompt: null });
    const wt = window.limboo?.worktree;
    if (!wt) return;
    try {
      // Trust first (unlocks scripts/services/teardown even with no setup
      // hooks), then run setup only where a ready worktree exists to run in.
      await wt.ackConfig(prompt.sessionId, prompt.hash);
      const session = get().sessions.find((s) => s.id === prompt.sessionId);
      if (
        prompt.config.setup.length > 0 &&
        session?.worktreePath &&
        session.worktreeStatus === 'ready'
      ) {
        await wt.runSetup(prompt.sessionId, prompt.hash);
      }
    } catch (err) {
      useUIStore.getState().addToast({
        title: 'Worktree setup failed',
        description: errorMessage(err),
        tone: 'danger',
      });
    } finally {
      // The strip gates its controls on `acked` — refresh it either way.
      void useServiceStore.getState().load(prompt.sessionId);
    }
  },

  dismissSetupHooks: () => set({ hooksPrompt: null }),

  rename: async (id, title) => {
    const next = title.trim();
    if (!next) return;
    await sessionApi()?.update(id, { title: next });
  },

  togglePin: async (id, pinned) => {
    await sessionApi()?.update(id, { pinned });
  },

  setArchived: async (id, archived) => {
    await sessionApi()?.update(id, { archived });
  },

  archiveDone: async () => {
    const api = sessionApi();
    if (!api) return;
    const done = get().sessions.filter((s) => s.status === 'done' && !s.archived);
    await Promise.all(done.map((s) => api.update(s.id, { archived: true })));
  },

  duplicate: async (id, cloneWorktree) => {
    const copy = await sessionApi()?.duplicate(id, cloneWorktree ? { cloneWorktree } : undefined);
    // A cloned worktree is fresh (no deps) — offer setup like a new one.
    if (copy && cloneWorktree) void get().maybePromptSetup(copy.id);
  },

  restore: async (id) => {
    await sessionApi()?.restore(id);
  },

  purge: async (id) => {
    await sessionApi()?.purge(id);
  },

  setFolder: async (id, folder) => {
    await sessionApi()?.update(id, { folder });
  },

  setTags: async (id, tags) => {
    await sessionApi()?.update(id, { tags });
  },

  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  toggleGroupByFolder: () => set((s) => ({ groupByFolder: !s.groupByFolder })),
  toggleArchived: () => set((s) => ({ showArchived: !s.showArchived })),
  toggleTrash: () => {
    set((s) => ({ showTrash: !s.showTrash }));
    void get().refresh();
  },
}));
