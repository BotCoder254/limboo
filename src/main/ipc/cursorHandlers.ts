/**
 * IPC handlers for the Cursor provider's authentication (Phase 1 — no run
 * capability). Reached from the renderer through `window.limboo.agent.cursor.*`.
 *
 * The surface is capability-based (CLAUDE.md §6): the API key crosses exactly
 * once (set), is validated + length-capped here, and is NEVER returned,
 * echoed into an error, or logged. Every other channel exchanges only the
 * secret-free {@link CursorAuthState}.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { CURSOR_LIMITS } from '@shared/constants';
import type { CursorAuthState } from '@shared/types';
import type { CursorAuthManager } from '../managers/cursor/CursorAuthManager';
import { handle } from './registry';

/**
 * Printable non-space ASCII only — anything else (newlines, spaces, control
 * bytes) could corrupt env injection. Lenient on the `crsr_` prefix: the key
 * format is not contractual. The message deliberately never includes the value.
 */
function assertApiKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (
    key.length < CURSOR_LIMITS.apiKeyMin ||
    key.length > CURSOR_LIMITS.apiKeyMax ||
    !/^[\x21-\x7e]+$/.test(key)
  ) {
    throw new Error('That does not look like a valid Cursor API key.');
  }
  return key;
}

export function registerCursorHandlers(cursor: CursorAuthManager): void {
  handle<[], CursorAuthState>(IpcChannels.agentCursorGetAuthState, () => cursor.getAuthState());

  handle<[], CursorAuthState>(IpcChannels.agentCursorRefreshAuth, () => cursor.probe(true));

  handle<[boolean?], void>(IpcChannels.agentCursorLoginStart, (_event, manual) =>
    cursor.loginStart(manual === true),
  );

  handle<[], void>(IpcChannels.agentCursorLoginCancel, () => cursor.loginCancel());

  handle<[], void>(IpcChannels.agentCursorLogout, () => cursor.logout());

  handle<[string], void>(IpcChannels.agentCursorSetApiKey, (_event, key) =>
    cursor.setApiKey(assertApiKey(key)),
  );

  handle<[], void>(IpcChannels.agentCursorRemoveApiKey, () => cursor.removeApiKey());
}
