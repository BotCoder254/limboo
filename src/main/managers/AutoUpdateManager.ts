/**
 * AutoUpdateManager — the in-app updater, owned by the app (not the agent).
 *
 * Wraps `electron-updater` against this repo's GitHub Releases. electron-builder
 * publishes the per-platform `latest*.yml` metadata + signed installers; this
 * manager fetches that feed over HTTPS, surfaces every lifecycle transition to
 * the renderer as a single {@link UpdateStatus}, and applies the update on the
 * user's command. Limboo stores no update credentials — the feed is public.
 *
 * Hardening / boundaries:
 * - Active ONLY in a packaged build. In dev electron-updater has no
 *   `app-update.yml`, so we report `disabled` and never touch the network.
 * - Linux self-update only works for the AppImage build; for deb/rpm installs we
 *   report `disabled` (the OS package manager owns updates there).
 * - The GitHub feed is HTTPS-only and host-fixed (no renderer-supplied URLs), so
 *   there is no SSRF surface to allowlist here.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import type { SettingsManager } from './SettingsManager';
import type { NotificationManager } from './NotificationManager';
import type { AppSettings, UpdateStatus } from '@shared/types';
import { IpcEvents } from '@shared/ipc-channels';
import { logger } from '../logger';

// electron-updater is CommonJS; the named `autoUpdater` rides on the default export.
const { autoUpdater } = electronUpdater;

/** The GitHub project that serves releases — must match electron-builder.yml. */
const FEED = { provider: 'github', owner: 'BotCoder254', repo: 'limboo' } as const;

/** Re-check cadence once the app has settled (ms). */
const POLL_INTERVAL = 60 * 60 * 1000; // hourly
const INITIAL_DELAY = 8_000; // let the window finish hydrating first

export class AutoUpdateManager {
  private status: UpdateStatus;
  private readonly enabled: boolean;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private initialTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly settings: SettingsManager,
    private readonly notifications: NotificationManager,
  ) {
    this.status = { stage: 'idle', currentVersion: app.getVersion() };
    this.enabled = this.computeEnabled();

    if (!this.enabled) {
      this.status = { stage: 'disabled', currentVersion: app.getVersion() };
      return;
    }

    autoUpdater.logger = {
      info: (m: unknown) => logger.info('[updater]', m),
      warn: (m: unknown) => logger.warn('[updater]', m),
      error: (m: unknown) => logger.error('[updater]', m),
      // Drop verbose debug chatter (electron-updater calls this a lot).
      debug: (m: unknown) => void m,
    };
    autoUpdater.autoDownload = this.settings.getAll().updates.autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL(FEED);

    this.wireEvents();

    // Re-tune auto-download live as the user flips the preference.
    this.settings.onChange((s: AppSettings) => {
      autoUpdater.autoDownload = s.updates.autoDownload;
    });
  }

  /** Updates are only meaningful in a packaged build (and AppImage on Linux). */
  private computeEnabled(): boolean {
    if (!app.isPackaged) return false;
    if (process.platform === 'linux' && !process.env.APPIMAGE) return false;
    // electron-updater reads `<resources>/app-update.yml` on checkForUpdates();
    // if it's absent (e.g. an older installer or a plain Forge package that
    // predates the packaging fix) that call throws ENOENT. Disable gracefully
    // rather than surface a non-actionable error — a reinstall restores the file.
    if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
      logger.warn('[updater] app-update.yml missing from resources; updates disabled');
      return false;
    }
    return true;
  }

  /** Begin the initial check + hourly poll, gated on the user's autoCheck pref. */
  start(): void {
    if (!this.enabled) return;
    if (!this.settings.getAll().updates.autoCheck) return;
    this.initialTimer = setTimeout(() => void this.check(), INITIAL_DELAY);
    this.pollTimer = setInterval(() => {
      if (this.settings.getAll().updates.autoCheck) void this.check();
    }, POLL_INTERVAL);
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
  }

  getState(): UpdateStatus {
    return this.status;
  }

  /** Check GitHub for a newer release. No-op (returns current state) in dev. */
  async check(): Promise<UpdateStatus> {
    if (!this.enabled) return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.emit({ stage: 'error', error: errorMessage(err) });
    }
    return this.status;
  }

  /** Manually start the download (used when autoDownload is off). */
  async download(): Promise<void> {
    if (!this.enabled) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.emit({ stage: 'error', error: errorMessage(err) });
    }
  }

  /** Quit and apply a downloaded update. Safe no-op if nothing is staged. */
  install(): void {
    if (!this.enabled || this.status.stage !== 'downloaded') return;
    // isSilent=false (show the installer), isForceRunAfter=true (relaunch).
    autoUpdater.quitAndInstall(false, true);
  }

  private wireEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.emit({ stage: 'checking', checkedAt: Date.now() });
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.emit({ stage: 'available', version: info.version, notes: releaseNotes(info) });
      this.notifications.notify({
        title: 'Update available',
        body: `Limboo ${info.version} is available to download.`,
      });
    });
    autoUpdater.on('update-not-available', () => {
      this.emit({ stage: 'not-available' });
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      this.emit({ stage: 'downloading', percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.emit({ stage: 'downloaded', version: info.version, notes: releaseNotes(info) });
      this.notifications.notify({
        title: 'Update ready',
        body: `Limboo ${info.version} has been downloaded. Restart to install.`,
      });
    });
    autoUpdater.on('error', (err: Error) => {
      this.emit({ stage: 'error', error: errorMessage(err) });
    });
  }

  /** Merge a transition into the status and push the full object to renderers. */
  private emit(patch: Partial<UpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion(),
    };
    // A new check supersedes any stale error/version once it resolves.
    if (patch.stage === 'not-available' || patch.stage === 'checking') {
      this.status.error = undefined;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcEvents.updateStatus, this.status);
      }
    }
  }
}

/** electron-updater release notes can be a string or a list of per-version notes. */
function releaseNotes(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (!notes) return undefined;
  const text =
    typeof notes === 'string'
      ? notes
      : notes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).join('\n');
  // Strip HTML tags GitHub may include, then cap length for the renderer.
  return text.replace(/<[^>]*>/g, '').trim().slice(0, 2000) || undefined;
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}
