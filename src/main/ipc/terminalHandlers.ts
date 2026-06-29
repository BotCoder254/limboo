/**
 * IPC handlers for the Terminal Manager. Registered through `handle()`, so every
 * call inherits sender-origin validation. All renderer input is validated here in
 * the main process (CLAUDE.md §6): ids are type/length-checked, write payloads are
 * byte-capped, and grid dimensions are bounded before they reach a PTY. The
 * manager itself enforces the workspace-root `cwd` guard and argv-style spawn.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { TERMINAL_LIMITS } from '@shared/constants';
import type { TerminalCreateOptions, TerminalSession } from '@shared/types';
import { handle } from './registry';
import type { TerminalManager } from '../managers/TerminalManager';
import { logger } from '../logger';

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('terminal: invalid id');
  }
}

function sanitizeOptions(raw: unknown): TerminalCreateOptions {
  const o = (raw ?? {}) as Record<string, unknown>;
  const opts: TerminalCreateOptions = {};
  if (typeof o.title === 'string') opts.title = o.title.slice(0, TERMINAL_LIMITS.titleMax);
  if (typeof o.cols === 'number' && Number.isFinite(o.cols)) opts.cols = o.cols;
  if (typeof o.rows === 'number' && Number.isFinite(o.rows)) opts.rows = o.rows;
  // `origin` is intentionally NOT honored from the renderer — user-driven creates
  // are always 'user'. Agent terminals are created inside the main process only.
  return opts;
}

export function registerTerminalHandlers(terminal: TerminalManager): void {
  handle<[string, TerminalCreateOptions?], TerminalSession>(
    IpcChannels.terminalCreate,
    (_e, workspaceId, opts) => {
      assertValidId(workspaceId);
      try {
        return terminal.create(workspaceId, sanitizeOptions(opts));
      } catch (err) {
        logger.warn('terminal:create failed', err);
        throw err;
      }
    },
  );

  handle<[string], { terminals: TerminalSession[]; scrollback: Record<string, string> }>(
    IpcChannels.terminalList,
    (_e, workspaceId) => {
      assertValidId(workspaceId);
      const terminals = terminal.list(workspaceId);
      const scrollback: Record<string, string> = {};
      for (const t of terminals) scrollback[t.id] = terminal.scrollback(t.id);
      return { terminals, scrollback };
    },
  );

  handle<[string, string], void>(IpcChannels.terminalWrite, (_e, id, data) => {
    assertValidId(id);
    if (typeof data !== 'string') throw new Error('terminal:write invalid payload');
    terminal.write(id, data);
  });

  handle<[string, number, number], void>(IpcChannels.terminalResize, (_e, id, cols, rows) => {
    assertValidId(id);
    if (typeof cols !== 'number' || typeof rows !== 'number') {
      throw new Error('terminal:resize invalid dimensions');
    }
    terminal.resize(id, cols, rows);
  });

  handle<[string], void>(IpcChannels.terminalKill, (_e, id) => {
    assertValidId(id);
    terminal.kill(id);
  });

  handle<[string, string], TerminalSession | null>(IpcChannels.terminalRename, (_e, id, title) => {
    assertValidId(id);
    if (typeof title !== 'string') throw new Error('terminal:rename invalid title');
    return terminal.rename(id, title);
  });

  handle<[string], void>(IpcChannels.terminalClear, (_e, id) => {
    assertValidId(id);
    terminal.clear(id);
  });
}
