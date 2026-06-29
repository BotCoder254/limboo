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

    // Optimistically apply the patch locally so the control flips instantly —
    // toggles/segments reflect the new state on the same frame as the click,
    // independent of the IPC round-trip.
    const previous = get().settings;
    const optimistic = deepMergeLocal(previous, patch);
    set({ settings: optimistic });
    applyAppearance(optimistic.appearance);

    if (!api) return;

    try {
      // Reconcile with the main process truth (clamped / migrated / normalized).
      const next = await api.set(patch);
      set({ settings: next });
      applyAppearance(next.appearance);
    } catch (err) {
      // Roll back to the pre-patch state on failure.
      set({ settings: previous });
      applyAppearance(previous.appearance);
      throw err;
    }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursive deep merge used for the optimistic local update (and browser-preview
 * mode). Mirrors the main-process `deepMerge` semantics: nested objects merge,
 * scalars/arrays replace. Mutation never escapes the new object.
 */
function deepMergeLocal<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? deepMergeLocal(current, value as DeepPartial<typeof current>)
        : value;
  }
  return out as T;
}
