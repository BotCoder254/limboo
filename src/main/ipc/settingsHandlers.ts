/**
 * IPC handlers for persistent settings. The renderer reaches these through
 * `window.limboo.settings.*`. Input is validated to be a plain object before it
 * reaches the manager.
 */
import { IpcChannels } from '@shared/ipc-channels';
import type { AppSettings, DeepPartial } from '@shared/types';
import type { SettingsManager } from '../managers/SettingsManager';
import { handle } from './registry';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys that could pollute Object.prototype if merged into the settings object. */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Recursively reject any prototype-polluting key in a renderer-supplied patch. */
function assertNoPollutingKeys(value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`settings:set rejected unsafe key: ${key}`);
    }
    assertNoPollutingKeys(value[key]);
  }
}

export function registerSettingsHandlers(settings: SettingsManager): void {
  handle(IpcChannels.settingsGetAll, () => settings.getAll());

  handle<[DeepPartial<AppSettings>], AppSettings>(
    IpcChannels.settingsSet,
    (_event, patch) => {
      if (!isPlainObject(patch)) {
        throw new Error('settings:set expects an object patch');
      }
      assertNoPollutingKeys(patch);
      return settings.update(patch);
    },
  );

  handle(IpcChannels.settingsReset, () => settings.reset());
}
