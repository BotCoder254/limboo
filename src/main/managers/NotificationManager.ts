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
  /** Optional voice hook — set by the VoiceManager to speak notifications. */
  private speaker: ((text: string) => void) | null = null;

  constructor(private readonly settings: SettingsManager) {}

  /** Wire the voice subsystem's spoken-notification hook (gated there). */
  setSpeaker(speaker: (text: string) => void): void {
    this.speaker = speaker;
  }

  notify(options: NotifyOptions): void {
    if (!this.settings.getAll().behavior.notifications) return;
    this.speaker?.([options.title, options.body].filter(Boolean).join('. '));
    if (!Notification.isSupported()) return;

    new Notification({
      title: options.title,
      body: options.body ?? '',
      silent: options.silent ?? false,
      icon: assetPath('icon.png'),
    }).show();
  }
}
