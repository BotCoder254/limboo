/**
 * IPC handlers for native OS integrations: desktop notifications, opening
 * external links in the OS browser, clipboard read/write, and app metadata.
 * Reached from the renderer through `window.limboo.system.*` and
 * `window.limboo.app.*`.
 */
import { app, clipboard, shell } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { AppInfo } from '@shared/types';
import type { NotificationManager, NotifyOptions } from '../managers/NotificationManager';
import { handle } from './registry';
import { logger } from '../logger';

// Input limits to keep a compromised renderer from abusing native integrations.
const MAX_URL_LENGTH = 2048;
const MAX_CLIPBOARD_LENGTH = 1_000_000; // ~1MB of text
const MAX_NOTIFY_TITLE = 256;
const MAX_NOTIFY_BODY = 2000;

export function registerSystemHandlers(notifications: NotificationManager): void {
  handle<[NotifyOptions], void>(IpcChannels.systemNotify, (_event, options) => {
    if (!options || typeof options.title !== 'string') {
      throw new Error('system:notify expects { title: string }');
    }
    notifications.notify({
      ...options,
      title: options.title.slice(0, MAX_NOTIFY_TITLE),
      body: typeof options.body === 'string' ? options.body.slice(0, MAX_NOTIFY_BODY) : options.body,
    });
  });

  handle<[string], void>(IpcChannels.systemOpenExternal, async (_event, url) => {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url)) {
      logger.warn('Blocked openExternal for invalid url', url);
      return;
    }
    // Reject embedded credentials (user:pass@host) — a phishing/SSRF vector.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      logger.warn('Blocked openExternal for unparseable url', url);
      return;
    }
    if (parsed.username || parsed.password) {
      logger.warn('Blocked openExternal for url with embedded credentials');
      return;
    }
    await shell.openExternal(url);
  });

  handle<[string], void>(IpcChannels.systemClipboardWrite, (_event, text) => {
    const value = typeof text === 'string' ? text : String(text);
    clipboard.writeText(value.slice(0, MAX_CLIPBOARD_LENGTH));
  });

  handle(IpcChannels.systemClipboardRead, () => clipboard.readText());

  handle<[], AppInfo>(IpcChannels.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));
}
