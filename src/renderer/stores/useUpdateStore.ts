/**
 * Update store — the renderer-side mirror of the main-process AutoUpdateManager.
 * Holds the latest {@link UpdateStatus} and exposes the user-driven actions
 * (check / download / install). Subscribes to `update:status` so the banner and
 * the Settings panel stay live through the whole update lifecycle.
 *
 * Degrades to a quiet `disabled` state in a plain browser preview (no preload)
 * and in dev builds (where the main manager reports `disabled`).
 */
import { create } from 'zustand';
import type { UpdateStatus } from '@shared/types';

interface UpdateState {
  status: UpdateStatus;
  hydrated: boolean;
  /** True while a user-initiated check/download is in flight (for button state). */
  busy: boolean;

  hydrate: () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  /** Dismiss the banner for the current offered version (renderer-only). */
  dismiss: () => void;
}

const INITIAL: UpdateStatus = { stage: 'idle', currentVersion: '' };

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: INITIAL,
  hydrated: false,
  busy: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ hydrated: true });
    const api = window.limboo?.updates;
    if (!api) {
      set({ status: { stage: 'disabled', currentVersion: '' } });
      return;
    }
    void api.getState().then((status) => set({ status }));
    api.onStatus((status) => set({ status, busy: false }));
  },

  check: async () => {
    const api = window.limboo?.updates;
    if (!api) return;
    set({ busy: true });
    try {
      await api.check();
    } finally {
      set({ busy: false });
    }
  },

  download: async () => {
    const api = window.limboo?.updates;
    if (!api) return;
    set({ busy: true });
    await api.download();
  },

  install: async () => {
    await window.limboo?.updates?.install();
  },

  dismiss: () => set({ status: { ...get().status, stage: 'idle' } }),
}));
