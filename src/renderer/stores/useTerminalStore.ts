/**
 * Terminal store — the renderer-side mirror of the main-process TerminalManager.
 * Holds the per-workspace terminal list, the active terminal per workspace, and
 * the agent command records mirrored into each terminal. The hot path (raw PTY
 * output) does NOT flow through this store — {@link TerminalView} subscribes to
 * `onData` directly so high-frequency output never triggers React re-renders.
 *
 * In a plain browser preview (no preload) it degrades to empty, read-only state.
 */
import { create } from 'zustand';
import type {
  TerminalCommandRecord,
  TerminalExit,
  TerminalSession,
} from '@shared/types';

interface TerminalState {
  /** Terminals per workspace id (creation order). */
  byWorkspace: Record<string, TerminalSession[]>;
  /** Active terminal id per workspace id. */
  activeByWorkspace: Record<string, string | null>;
  /** Mirrored agent command records, keyed by terminal id (chronological). */
  commandsByTerminal: Record<string, TerminalCommandRecord[]>;
  hydrated: boolean;

  hydrate: () => void;
  /** Load a workspace's terminals from main and pick a default active one. */
  load: (workspaceId: string) => Promise<void>;
  create: (workspaceId: string) => Promise<TerminalSession | null>;
  kill: (workspaceId: string, terminalId: string) => Promise<void>;
  rename: (workspaceId: string, terminalId: string, title: string) => Promise<void>;
  setActive: (workspaceId: string, terminalId: string) => void;
}

function termApi() {
  const api = window.limboo?.terminal;
  if (!api && typeof console !== 'undefined') {
    console.warn('[limboo] window.limboo.terminal is unavailable — preload did not load.');
  }
  return api;
}

/** Pick a sensible active terminal after the list changes. */
function nextActive(list: TerminalSession[], current: string | null): string | null {
  if (current && list.some((t) => t.id === current)) return current;
  const running = list.find((t) => t.status === 'running');
  return running?.id ?? list[0]?.id ?? null;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  byWorkspace: {},
  activeByWorkspace: {},
  commandsByTerminal: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const api = window.limboo?.terminal;
    if (!api) {
      set({ hydrated: true });
      return;
    }
    set({ hydrated: true });

    api.onUpdated(({ workspaceId, terminals }) =>
      set((s) => ({
        byWorkspace: { ...s.byWorkspace, [workspaceId]: terminals },
        activeByWorkspace: {
          ...s.activeByWorkspace,
          [workspaceId]: nextActive(terminals, s.activeByWorkspace[workspaceId] ?? null),
        },
      })),
    );

    api.onExit((exit: TerminalExit) =>
      set((s) => {
        const next: Record<string, TerminalSession[]> = {};
        for (const [wsId, list] of Object.entries(s.byWorkspace)) {
          next[wsId] = list.map((t) =>
            t.id === exit.terminalId
              ? { ...t, status: exit.signal ? 'crashed' : 'exited', exitCode: exit.exitCode }
              : t,
          );
        }
        return { byWorkspace: next };
      }),
    );

    api.onCommand((record: TerminalCommandRecord) =>
      set((s) => {
        const existing = s.commandsByTerminal[record.terminalId] ?? [];
        const idx = existing.findIndex((r) => r.callId === record.callId);
        const merged =
          idx >= 0
            ? existing.map((r, i) => (i === idx ? record : r))
            : [...existing, record];
        return {
          commandsByTerminal: { ...s.commandsByTerminal, [record.terminalId]: merged },
        };
      }),
    );
  },

  load: async (workspaceId) => {
    const api = termApi();
    if (!api) return;
    const { terminals } = await api.list(workspaceId);
    set((s) => ({
      byWorkspace: { ...s.byWorkspace, [workspaceId]: terminals },
      activeByWorkspace: {
        ...s.activeByWorkspace,
        [workspaceId]: nextActive(terminals, s.activeByWorkspace[workspaceId] ?? null),
      },
    }));
  },

  create: async (workspaceId) => {
    const api = termApi();
    if (!api) return null;
    const term = await api.create(workspaceId);
    set((s) => ({
      activeByWorkspace: { ...s.activeByWorkspace, [workspaceId]: term.id },
    }));
    return term;
  },

  kill: async (workspaceId, terminalId) => {
    const api = termApi();
    if (!api) return;
    await api.kill(terminalId);
    // The `terminal:updated` broadcast refreshes the list; nothing else to do.
  },

  rename: async (workspaceId, terminalId, title) => {
    const api = termApi();
    if (!api) return;
    await api.rename(terminalId, title);
  },

  setActive: (workspaceId, terminalId) =>
    set((s) => ({
      activeByWorkspace: { ...s.activeByWorkspace, [workspaceId]: terminalId },
    })),
}));
