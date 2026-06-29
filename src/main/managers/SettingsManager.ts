/**
 * SettingsManager — the single owner of persistent user preferences.
 *
 * Settings are stored as JSON under `userData/settings.json`, deep-merged with
 * defaults on load (so new keys appear automatically), clamped to valid ranges,
 * and broadcast to all renderers whenever they change.
 */
import { BrowserWindow } from 'electron';
import type { AppSettings, DeepPartial } from '@shared/types';
import {
  AGENT_CONNECTION_LIMITS,
  AGENT_LIMITS,
  DEFAULT_SETTINGS,
  FONT_SCALE_LIMITS,
  GIT_LIMITS,
  LAYOUT_LIMITS,
  MEMORY_LIMITS,
  SETTINGS_VERSION,
  clamp,
} from '@shared/constants';
import { IpcEvents } from '@shared/ipc-channels';
import { readJson, writeJson } from '../storage';
import { logger } from '../logger';

const FILE = 'settings.json';

export class SettingsManager {
  private settings: AppSettings;
  /** In-process listeners (e.g. the AgentManager re-tuning its heartbeat). */
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor() {
    const stored = readJson<Partial<AppSettings>>(FILE, {});
    this.settings = this.normalize(stored);
    // Persist back so the file always reflects the current (migrated) shape.
    writeJson(FILE, this.settings);
  }

  getAll(): AppSettings {
    return this.settings;
  }

  /** Subscribe to in-process settings changes. Returns an unsubscribe fn. */
  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Replace settings with a deep-merged patch. Returns the full, normalized
   * settings object and notifies renderers.
   */
  update(patch: DeepPartial<AppSettings>): AppSettings {
    this.settings = this.normalize(deepMerge(this.settings, patch));
    writeJson(FILE, this.settings);
    this.broadcast();
    return this.settings;
  }

  reset(): AppSettings {
    this.settings = { ...DEFAULT_SETTINGS };
    writeJson(FILE, this.settings);
    this.broadcast();
    return this.settings;
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcEvents.settingsChanged, this.settings);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(this.settings);
      } catch {
        /* a listener failure must never break settings propagation */
      }
    }
  }

  /** Merge with defaults, run migrations, and clamp numeric ranges. */
  private normalize(input: Partial<AppSettings>): AppSettings {
    const merged = deepMerge(DEFAULT_SETTINGS, (input ?? {}) as DeepPartial<AppSettings>);

    if (merged.version !== SETTINGS_VERSION) {
      logger.info(`Migrating settings v${merged.version} -> v${SETTINGS_VERSION}`);
      merged.version = SETTINGS_VERSION;
    }

    merged.appearance.fontScale = clamp(
      merged.appearance.fontScale,
      FONT_SCALE_LIMITS.min,
      FONT_SCALE_LIMITS.max,
    );
    merged.layout.leftWidth = clamp(
      merged.layout.leftWidth,
      LAYOUT_LIMITS.left.min,
      LAYOUT_LIMITS.left.max,
    );
    merged.layout.rightWidth = clamp(
      merged.layout.rightWidth,
      LAYOUT_LIMITS.right.min,
      LAYOUT_LIMITS.right.max,
    );
    merged.agent.maxTurns = Math.round(
      clamp(merged.agent.maxTurns, AGENT_LIMITS.maxTurns.min, AGENT_LIMITS.maxTurns.max),
    );

    const c = merged.agent.connection;
    const L = AGENT_CONNECTION_LIMITS;
    c.heartbeatInterval = clamp(c.heartbeatInterval, L.heartbeatInterval.min, L.heartbeatInterval.max);
    c.reconnectDelay = clamp(c.reconnectDelay, L.reconnectDelay.min, L.reconnectDelay.max);
    c.maxRecoveryAttempts = Math.round(
      clamp(c.maxRecoveryAttempts, L.maxRecoveryAttempts.min, L.maxRecoveryAttempts.max),
    );
    c.heartbeatFailureThreshold = Math.round(
      clamp(c.heartbeatFailureThreshold, L.heartbeatFailureThreshold.min, L.heartbeatFailureThreshold.max),
    );
    c.idleTimeout = clamp(c.idleTimeout, L.idleTimeout.min, L.idleTimeout.max);

    merged.git.maxCheckpoints = Math.round(
      clamp(merged.git.maxCheckpoints, GIT_LIMITS.maxCheckpoints.min, GIT_LIMITS.maxCheckpoints.max),
    );
    if (!['destructive', 'all', 'none'].includes(merged.git.commandApproval)) {
      merged.git.commandApproval = 'destructive';
    }
    if (!['ff-only', 'rebase'].includes(merged.git.pull.strategy)) {
      merged.git.pull.strategy = 'ff-only';
    }

    const mem = merged.memory;
    if (!['propose', 'auto', 'off'].includes(mem.autoCapture)) {
      mem.autoCapture = 'propose';
    }
    mem.maxInjected = Math.round(
      clamp(mem.maxInjected, MEMORY_LIMITS.maxInjected.min, MEMORY_LIMITS.maxInjected.max),
    );
    mem.autoAcceptConfidence = clamp(
      mem.autoAcceptConfidence,
      MEMORY_LIMITS.autoAcceptConfidence.min,
      MEMORY_LIMITS.autoAcceptConfidence.max,
    );
    mem.expiry.staleDays = Math.round(
      clamp(mem.expiry.staleDays, MEMORY_LIMITS.staleDays.min, MEMORY_LIMITS.staleDays.max),
    );

    return merged;
  }
}

/* ------------------------------------------------------------------ */
/* Deep-merge helpers                                                  */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys that could pollute Object.prototype if copied during a merge. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch as object)) {
    // Never copy prototype-polluting keys, even though a renderer-supplied patch
    // should already have been rejected upstream (defense in depth).
    if (FORBIDDEN_KEYS.has(key)) continue;
    const patchVal = (patch as Record<string, unknown>)[key];
    const baseVal = (base as Record<string, unknown>)[key];
    if (patchVal === undefined) continue;
    out[key] =
      isPlainObject(baseVal) && isPlainObject(patchVal)
        ? deepMerge(baseVal, patchVal as DeepPartial<typeof baseVal>)
        : patchVal;
  }
  return out as T;
}
