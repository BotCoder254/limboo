/**
 * Workspace store — the renderer-side mirror of the main-process WorkspaceManager.
 *
 * `hydrate()` loads the registered workspaces + the active one through the preload
 * bridge and subscribes to live changes. All mutations go through
 * `window.limboo.workspace.*`; the broadcast keeps every surface in sync. In a
 * plain browser preview (no preload) it degrades to an empty, read-only list so
 * the UI still renders.
 */
import { create } from 'zustand';
import type { Workspace, WorkspaceConfig, WorkspaceStats, DeepPartial } from '@shared/types';

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  hydrated: boolean;
  /** True while a native directory picker is open (mirrors the main-process guard). */
  picking: boolean;
  /** Lazily-loaded per-workspace statistics, memoized by id (each entry is one
   *  bounded filesystem walk, so we fetch on demand — not eagerly for every card). */
  statsById: Record<string, WorkspaceStats>;
  hydrate: () => Promise<void>;
  pickDirectory: () => Promise<string | null>;
  open: (path: string) => Promise<Workspace | null>;
  openPath: (path: string) => Promise<Workspace | null>;
  create: (path: string) => Promise<Workspace | null>;
  switchTo: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  updateConfig: (id: string, patch: DeepPartial<WorkspaceConfig>) => Promise<void>;
  rescan: (id: string) => Promise<void>;
  /** Fetch + cache stats for one workspace (no-op if already loaded). */
  loadStats: (id: string) => Promise<void>;
}

/** Resolve the workspace bridge, warning (dev) when it is unexpectedly absent so a
 *  missing preload surfaces in the console instead of silently no-op-ing. */
function workspaceApi() {
  const api = window.limboo?.workspace;
  if (!api && typeof console !== 'undefined') {
    console.warn('[limboo] window.limboo.workspace is unavailable — the preload bridge did not load.');
  }
  return api;
}

/** Insert-or-replace a workspace in the list, keeping it deduped by id. */
function mergeWorkspace(list: Workspace[], ws: Workspace): Workspace[] {
  const rest = list.filter((w) => w.id !== ws.id);
  return [ws, ...rest];
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeId: null,
  hydrated: false,
  picking: false,
  statsById: {},

  hydrate: async () => {
    if (get().hydrated) return;
    const api = window.limboo?.workspace;
    if (!api) {
      set({ hydrated: true });
      return;
    }
    const [workspaces, active] = await Promise.all([api.list(), api.getActive()]);
    set({ workspaces, activeId: active?.id ?? null, hydrated: true });

    api.onUpdated((next) => set({ workspaces: next }));
    api.onChanged((next) => set({ activeId: next?.id ?? null }));
  },

  pickDirectory: async () => {
    const api = workspaceApi();
    if (!api) return null;
    // Defensive renderer-side guard so a second click is a no-op while the dialog
    // is open; the main-process guard is authoritative.
    if (get().picking) return null;
    set({ picking: true });
    try {
      return await api.pickDirectory();
    } finally {
      set({ picking: false });
    }
  },

  open: async (path) => {
    const api = workspaceApi();
    if (!api) return null;
    const ws = await api.open(path);
    // Optimistically reflect the result so the UI updates immediately even if the
    // `workspaces:updated` broadcast is missed or raced; the broadcast reconciles.
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws), activeId: ws.id }));
    return ws;
  },

  /**
   * Open a folder by an already-resolved absolute path (e.g. from a drag-and-drop
   * drop). Reuses the validated `workspace:open` IPC so a dropped path gets the
   * exact same checks as the native picker (realpath, directory, forbidden roots,
   * permissions, duplicates).
   */
  openPath: async (path) => {
    const api = workspaceApi();
    if (!api) return null;
    const ws = await api.open(path);
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws), activeId: ws.id }));
    return ws;
  },

  create: async (path) => {
    const api = workspaceApi();
    if (!api) return null;
    const ws = await api.create(path);
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws), activeId: ws.id }));
    return ws;
  },

  switchTo: async (id) => {
    const api = workspaceApi();
    if (!api) return;
    const ws = await api.switch(id);
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws), activeId: ws.id }));
  },

  remove: async (id) => {
    const api = workspaceApi();
    if (!api) return;
    await api.remove(id);
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id);
      const statsById = { ...s.statsById };
      delete statsById[id];
      return { workspaces, statsById, activeId: s.activeId === id ? null : s.activeId };
    });
  },

  toggleFavorite: async (id) => {
    const api = workspaceApi();
    if (!api) return;
    const ws = await api.toggleFavorite(id);
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws) }));
  },

  updateConfig: async (id, patch) => {
    const api = workspaceApi();
    if (!api) return;
    const ws = await api.updateConfig(id, patch);
    set((s) => ({ workspaces: mergeWorkspace(s.workspaces, ws) }));
  },

  rescan: async (id) => {
    const api = workspaceApi();
    if (!api) return;
    const ws = await api.rescan(id);
    // A rescan re-walks the project, so drop the cached stats and let the next
    // view re-request fresh numbers.
    set((s) => {
      const statsById = { ...s.statsById };
      delete statsById[id];
      return { workspaces: mergeWorkspace(s.workspaces, ws), statsById };
    });
  },

  loadStats: async (id) => {
    if (get().statsById[id]) return;
    const api = workspaceApi();
    if (!api) return;
    const stats = await api.getStats(id);
    if (!stats) return;
    set((s) => ({ statsById: { ...s.statsById, [id]: stats } }));
  },
}));
