/**
 * Service store — the renderer-side mirror of the main-process ServiceManager
 * (Scripts & Services). Holds per-session service lists and mirrors live
 * `services:updated` pushes. All mutations go through `window.limboo.services`;
 * in a plain browser preview (no preload) it degrades to empty state.
 */
import { create } from 'zustand';
import type { ServiceInfo } from '@shared/types';
import { useUIStore } from './useUIStore';

/** Slim per-session view of limboo.json driving the strip (scripts + trust). */
export interface SessionRepoSummary {
  /** Declared on-demand script names (commands stay main-side). */
  scripts: string[];
  /** Whether the workspace acknowledged this exact config (trust gate). */
  acked: boolean;
}

interface ServiceState {
  bySession: Record<string, ServiceInfo[]>;
  configBySession: Record<string, SessionRepoSummary>;
  hydrated: boolean;

  hydrate: () => void;
  load: (sessionId: string) => Promise<void>;
  start: (sessionId: string, name: string) => Promise<void>;
  stop: (sessionId: string, name: string) => Promise<void>;
  restart: (sessionId: string, name: string) => Promise<void>;
  runScript: (sessionId: string, name: string) => Promise<void>;
}

function svcApi() {
  return window.limboo?.services;
}

function toastError(title: string, err: unknown): void {
  useUIStore.getState().addToast({
    title,
    description: err instanceof Error ? err.message : String(err),
    tone: 'danger',
  });
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  bySession: {},
  configBySession: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    svcApi()?.onUpdated(({ sessionId, services }) => {
      set((s) => ({ bySession: { ...s.bySession, [sessionId]: services } }));
    });
  },

  load: async (sessionId) => {
    const api = svcApi();
    if (!api) return;
    try {
      const services = await api.list(sessionId);
      set((s) => ({ bySession: { ...s.bySession, [sessionId]: services } }));
    } catch {
      /* session without a workspace / config — leave empty */
    }
    // The scripts + trust state ride along so the strip can offer script runs
    // and the "Review commands…" (re-)acknowledgment affordance.
    try {
      const state = await window.limboo?.worktree.getRepoConfig(sessionId);
      if (!state) return;
      const summary: SessionRepoSummary = {
        scripts: Object.keys(state.config?.scripts ?? {}),
        acked: state.acked,
      };
      set((s) => ({ configBySession: { ...s.configBySession, [sessionId]: summary } }));
    } catch {
      /* no repo config readable — leave the summary absent */
    }
  },

  start: async (sessionId, name) => {
    try {
      await svcApi()?.start(sessionId, name);
    } catch (err) {
      toastError(`Could not start ${name}`, err);
    }
  },

  stop: async (sessionId, name) => {
    try {
      await svcApi()?.stop(sessionId, name);
    } catch (err) {
      toastError(`Could not stop ${name}`, err);
    }
  },

  restart: async (sessionId, name) => {
    try {
      await svcApi()?.restart(sessionId, name);
    } catch (err) {
      toastError(`Could not restart ${name}`, err);
    }
  },

  runScript: async (sessionId, name) => {
    try {
      await svcApi()?.runScript(sessionId, name);
    } catch (err) {
      toastError(`Could not run ${name}`, err);
    }
  },
}));
