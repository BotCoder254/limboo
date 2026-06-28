/**
 * Settings store — the renderer-side mirror of the main-process SettingsManager.
 *
 * On `hydrate()` it loads persisted settings through the preload bridge, applies
 * appearance side-effects to the document, seeds the layout store, and
 * subscribes to live changes. All writes go through `window.limboo.settings.set`
 * (write-through); the broadcast keeps every surface in sync.
 */
import { create } from 'zustand';
import type { AppSettings, DeepPartial } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { useLayoutStore } from './useLayoutStore';

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: DeepPartial<AppSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

let layoutSeeded = false;

function applyAppearance(appearance: AppSettings['appearance']): void {
  const root = document.documentElement;
  root.style.setProperty('--limboo-font-scale', String(appearance.fontScale));
  root.dataset.reducedMotion = String(appearance.reducedMotion);
  root.dataset.density = appearance.density;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const api = window.limboo?.settings;

    // Browser preview (no preload): fall back to defaults so the UI still runs.
    if (!api) {
      applyAppearance(DEFAULT_SETTINGS.appearance);
      useLayoutStore.getState().seed(DEFAULT_SETTINGS.layout);
      set({ hydrated: true });
      return;
    }

    const settings = await api.getAll();
    applyAppearance(settings.appearance);
    if (!layoutSeeded) {
      useLayoutStore.getState().seed(settings.layout);
      layoutSeeded = true;
    }
    set({ settings, hydrated: true });

    api.onChange((next) => {
      applyAppearance(next.appearance);
      set({ settings: next });
    });
  },

  update: async (patch) => {
    const api = window.limboo?.settings;
    if (!api) {
      // Optimistic local update in preview mode.
      set((s) => ({ settings: deepMergeLocal(s.settings, patch) }));
      applyAppearance(get().settings.appearance);
      return;
    }
    const next = await api.set(patch);
    set({ settings: next });
  },

  reset: async () => {
    const api = window.limboo?.settings;
    if (!api) {
      set({ settings: DEFAULT_SETTINGS });
      applyAppearance(DEFAULT_SETTINGS.appearance);
      useLayoutStore.getState().seed(DEFAULT_SETTINGS.layout);
      return;
    }
    const next = await api.reset();
    set({ settings: next });
    useLayoutStore.getState().seed(next.layout);
  },
}));

/** Shallow-ish local merge used only for browser-preview mode. */
function deepMergeLocal(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  return {
    ...base,
    ...patch,
    appearance: { ...base.appearance, ...patch.appearance },
    layout: { ...base.layout, ...patch.layout },
    behavior: { ...base.behavior, ...patch.behavior },
    agent: { ...base.agent, ...patch.agent },
  } as AppSettings;
}
