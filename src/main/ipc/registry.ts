/**
 * Typed wrapper around `ipcMain.handle`. Every handler is wrapped so a thrown
 * error is logged (with the channel name) and surfaced to the renderer as a
 * rejected promise instead of crashing the main process.
 */
import { ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { IpcChannel, IpcSend } from '@shared/ipc-channels';
import { logger } from '../logger';

// Injected by Electron Forge's Vite plugin. In dev it is the Vite dev-server URL
// (e.g. http://localhost:5173); undefined in a packaged build (renderer is file://).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

/**
 * Only accept IPC from our own renderer. In dev that is the Vite dev-server
 * origin; in production the renderer is loaded over `file://`. Anything else
 * (an iframe, a hijacked navigation, an injected frame) is rejected before a
 * handler runs.
 */
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  const origin = frame.origin;

  const devUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  if (devUrl) {
    try {
      if (origin === new URL(devUrl).origin) return true;
    } catch {
      /* fall through */
    }
  }

  // Packaged: loadFile yields a file:// origin.
  return origin === 'file://';
}

export type IpcHandler<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TResult | Promise<TResult>;

export function handle<TArgs extends unknown[], TResult>(
  channel: IpcChannel,
  handler: IpcHandler<TArgs, TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      logger.warn(`Rejected IPC from untrusted sender on ${channel}`, event.senderFrame?.origin);
      throw new Error('Untrusted IPC sender');
    }
    try {
      return await handler(event, ...(args as TArgs));
    } catch (err) {
      logger.error(`IPC handler failed: ${channel}`, err);
      throw err;
    }
  });
}

export type IpcListener<TArgs extends unknown[]> = (event: IpcMainEvent, ...args: TArgs) => void;

/**
 * One-way counterpart of {@link handle} for high-frequency fire-and-forget
 * messages (`ipcRenderer.send`) — e.g. mic audio chunks — that don't want the
 * invoke round-trip. Same sender validation; errors are logged, never thrown
 * (there is no reply to reject).
 */
export function on<TArgs extends unknown[]>(channel: IpcSend, listener: IpcListener<TArgs>): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      logger.warn(`Rejected IPC from untrusted sender on ${channel}`, event.senderFrame?.origin);
      return;
    }
    try {
      listener(event, ...(args as TArgs));
    } catch (err) {
      logger.error(`IPC listener failed: ${channel}`, err);
    }
  });
}
