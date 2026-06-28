/**
 * File System store — the renderer-side mirror of the main-process
 * FileSystemManager. Holds the per-workspace directory tree and the live index
 * progress, and exposes guarded reads. All work happens in main; this store only
 * reflects it. In a plain browser preview (no preload) it degrades to empty,
 * read-only state so the UI still renders.
 */
import { create } from 'zustand';
import type { FileReadResult, FileTree, IndexProgress } from '@shared/types';

interface FileSystemState {
  /** Latest directory tree per workspace id. */
  treeByWs: Record<string, FileTree>;
  /** Latest index progress per workspace id (cleared semantics via `phase`). */
  progressByWs: Record<string, IndexProgress>;
  hydrated: boolean;
  hydrate: () => void;
  /** Trigger a fresh index pass for a workspace (progress arrives via events). */
  reindex: (workspaceId: string) => Promise<void>;
  /** Read a workspace-relative file through the guarded main-process reader. */
  readFile: (workspaceId: string, relPath: string) => Promise<FileReadResult | null>;
}

function fsApi() {
  const api = window.limboo?.fs;
  if (!api && typeof console !== 'undefined') {
    console.warn('[limboo] window.limboo.fs is unavailable — the preload bridge did not load.');
  }
  return api;
}

export const useFileSystemStore = create<FileSystemState>((set, get) => ({
  treeByWs: {},
  progressByWs: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const api = window.limboo?.fs;
    if (!api) {
      set({ hydrated: true });
      return;
    }
    set({ hydrated: true });

    api.onIndexProgress((progress) =>
      set((s) => ({ progressByWs: { ...s.progressByWs, [progress.workspaceId]: progress } })),
    );
    api.onTreeChanged((tree) =>
      set((s) => ({ treeByWs: { ...s.treeByWs, [tree.workspaceId]: tree } })),
    );
  },

  reindex: async (workspaceId) => {
    const api = fsApi();
    if (!api) return;
    const tree = await api.index(workspaceId);
    // The broadcast normally delivers this; set optimistically so the UI updates
    // even if the `fs:tree-changed` push is missed or raced.
    set((s) => ({ treeByWs: { ...s.treeByWs, [workspaceId]: tree } }));
  },

  readFile: async (workspaceId, relPath) => {
    const api = fsApi();
    if (!api) return null;
    return api.readFile(workspaceId, relPath);
  },
}));
