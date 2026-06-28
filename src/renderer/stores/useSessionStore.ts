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
import type { Session, SessionSort } from '@shared/types';
import { useWorkspaceStore } from './useWorkspaceStore';

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

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  createSession: (title?: string) => Promise<string | null>;
  selectSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  archiveDone: () => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;

  setFilter: (filter: string) => void;
  setSort: (sort: SessionSort) => void;
  toggleArchived: () => void;
  toggleTrash: () => void;
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

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  trash: [],
  selectedId: null,
  hydrated: false,

  filter: '',
  sort: 'recent',
  showArchived: false,
  showTrash: false,

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

  selectSession: async (id) => {
    set({ selectedId: id }); // optimistic; the broadcast confirms
    await sessionApi()?.setActive(id);
  },

  removeSession: async (id) => {
    await sessionApi()?.delete(id);
  },

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

  duplicate: async (id) => {
    await sessionApi()?.duplicate(id);
  },

  restore: async (id) => {
    await sessionApi()?.restore(id);
  },

  purge: async (id) => {
    await sessionApi()?.purge(id);
  },

  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  toggleArchived: () => set((s) => ({ showArchived: !s.showArchived })),
  toggleTrash: () => {
    set((s) => ({ showTrash: !s.showTrash }));
    void get().refresh();
  },
}));
