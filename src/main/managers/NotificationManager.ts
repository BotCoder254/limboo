/**
 * NotificationManager — thin wrapper around Electron's native Notification API.
 * Respects the user's `behavior.notifications` preference and silently no-ops if
 * the platform doesn't support notifications.
 */
import { Notification } from 'electron';
import { assetPath } from '../paths';
import type { SettingsManager } from './SettingsManager';

export interface NotifyOptions {
  title: string;
  body?: string;
  silent?: boolean;
}

export class NotificationManager {
  constructor(private readonly settings: SettingsManager) {}

  notify(options: NotifyOptions): void {
    if (!this.settings.getAll().behavior.notifications) return;
    if (!Notification.isSupported()) return;

    new Notification({
      title: options.title,
      body: options.body ?? '',
      silent: options.silent ?? false,
      icon: assetPath('icon.png'),
    }).show();
  }
}
