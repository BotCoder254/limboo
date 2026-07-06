/**
 * Resume store — the renderer-side mirror of the main-process ResumeManager.
 * Holds each session's live revalidation phase (checking / clean / delta) plus
 * the currently-viewed repository delta for the detail dialog. Subscribes once
 * to `resume:state-changed`; all data crosses via the validated IPC surface.
 *
 * Degrades to empty, read-only state in a plain browser preview (no preload).
 */
import { create } from 'zustand';
import type { RepoDelta, ResumeState } from '@shared/types';

interface ResumeStoreState {
  /** Live revalidation state per session (pushed from main). */
  bySession: Record<string, ResumeState>;
  /** The delta shown in the detail dialog (null = dialog closed). */
  delta: RepoDelta | null;
  detailOpen: boolean;
  hydrated: boolean;

  hydrate: () => void;
  /** Pull the current state for a session (on session open). */
  loadSession: (sessionId: string) => Promise<void>;
  openDetail: (sessionId: string) => Promise<void>;
  closeDetail: () => void;
  dismiss: (sessionId: string) => Promise<void>;
}

function resumeApi() {
  return window.limboo?.resume;
}

export const useResumeStore = create<ResumeStoreState>((set, get) => ({
  bySession: {},
  delta: null,
  detailOpen: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    resumeApi()?.onStateChanged((state) => {
      set((s) => ({ bySession: { ...s.bySession, [state.sessionId]: state } }));
    });
  },

  loadSession: async (sessionId) => {
    const api = resumeApi();
    if (!api) return;
    try {
      const state = await api.getState(sessionId);
      set((s) => ({ bySession: { ...s.bySession, [sessionId]: state } }));
    } catch {
      /* best-effort hydration — the push stream corrects it */
    }
  },

  openDetail: async (sessionId) => {
    const api = resumeApi();
    if (!api) return;
    try {
      const delta = await api.getDelta(sessionId);
      if (delta) set({ delta, detailOpen: true });
    } catch {
      /* no delta — nothing to show */
    }
  },

  closeDetail: () => set({ detailOpen: false, delta: null }),

  dismiss: async (sessionId) => {
    try {
      await resumeApi()?.dismiss(sessionId);
    } catch {
      /* the state push reflects whatever main decided */
    }
  },
}));
