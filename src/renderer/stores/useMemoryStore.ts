/**
 * Memory store — the renderer-side mirror of the main-process MemoryManager.
 * Holds the active workspace's memories, pending proposals, and the current
 * search results. Subscribes to `memory:changed` and follows active-workspace
 * switches so the Memory panel stays live as the developer and agent work.
 *
 * Degrades to empty, read-only state in a plain browser preview (no preload).
 */
import { create } from 'zustand';
import type {
  Memory,
  MemoryCreateInput,
  MemoryHit,
  MemoryTier,
  MemoryUpdateInput,
} from '@shared/types';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useUIStore } from './useUIStore';

interface MemoryState {
  memories: Memory[];
  proposals: Memory[];
  results: MemoryHit[];
  query: string;
  tierFilter: MemoryTier | null;
  loading: boolean;
  hydrated: boolean;

  hydrate: () => void;
  refresh: () => Promise<void>;
  setQuery: (q: string) => void;
  setTierFilter: (tier: MemoryTier | null) => void;
  search: (q: string) => Promise<void>;
  create: (input: Omit<MemoryCreateInput, 'workspaceId'> & { global?: boolean }) => Promise<void>;
  update: (id: string, patch: MemoryUpdateInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  pin: (id: string, pinned: boolean) => Promise<void>;
  acceptProposal: (id: string) => Promise<void>;
  rejectProposal: (id: string) => Promise<void>;
}

function api() {
  return window.limboo?.memory;
}

function activeWs(): string | null {
  return useWorkspaceStore.getState().activeId;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  proposals: [],
  results: [],
  query: '',
  tierFilter: null,
  loading: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    const m = api();
    if (!m) return;

    m.onChanged(() => void get().refresh());
    void get().refresh();
    window.limboo?.workspace.onChanged(() => {
      set({ query: '', results: [], tierFilter: null });
      void get().refresh();
    });
  },

  refresh: async () => {
    const m = api();
    if (!m) return;
    const wsId = activeWs();
    set({ loading: true });
    try {
      const [memories, proposals] = await Promise.all([
        m.list({ workspaceId: wsId }),
        m.listProposals(wsId),
      ]);
      set({ memories, proposals });
      // Keep the live search results fresh if a query is active.
      if (get().query.trim()) await get().search(get().query);
    } finally {
      set({ loading: false });
    }
  },

  setQuery: (q) => set({ query: q }),
  setTierFilter: (tier) => set({ tierFilter: tier }),

  search: async (q) => {
    const m = api();
    if (!m) return;
    const query = q.trim();
    if (!query) {
      set({ results: [] });
      return;
    }
    const results = await m.search(query, { workspaceId: activeWs() });
    set({ results });
  },

  create: async (input) => {
    const m = api();
    if (!m) return;
    const toast = useUIStore.getState().addToast;
    try {
      await m.create({
        workspaceId: input.global ? null : activeWs(),
        tier: input.tier,
        title: input.title,
        body: input.body,
        pinned: input.pinned,
      });
      toast({ title: 'Memory saved', tone: 'success' });
      await get().refresh();
    } catch (err) {
      toast({ title: 'Could not save memory', description: err instanceof Error ? err.message : String(err), tone: 'danger' });
    }
  },

  update: async (id, patch) => {
    await api()?.update(id, patch);
    await get().refresh();
  },
  remove: async (id) => {
    await api()?.remove(id);
    await get().refresh();
  },
  archive: async (id, archived) => {
    await api()?.archive(id, archived);
    await get().refresh();
  },
  pin: async (id, pinned) => {
    await api()?.pin(id, pinned);
    await get().refresh();
  },
  acceptProposal: async (id) => {
    await api()?.acceptProposal(id);
    useUIStore.getState().addToast({ title: 'Memory added', tone: 'success' });
    await get().refresh();
  },
  rejectProposal: async (id) => {
    await api()?.rejectProposal(id);
    await get().refresh();
  },
}));
