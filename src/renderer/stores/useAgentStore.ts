/**
 * Agent store — the renderer-side mirror of the main-process AgentManager.
 *
 * `hydrate()` loads the install/runtime state and subscribes to the structured
 * event stream through the preload bridge. Every `AgentEvent` is applied to a
 * per-session snapshot (messages / tool calls / changes / tasks / activity) so
 * the UI never scrapes raw output — it renders typed state. All mutations go
 * through `window.limboo.agent.*`.
 */
import { create } from 'zustand';
import type {
  AgentEvent,
  AgentInstall,
  AgentRuntimeStatus,
  AgentSessionSnapshot,
  ChatMessage,
  FileChange,
  PermissionRequest,
} from '@shared/types';
import { useUIStore } from './useUIStore';

function emptySnapshot(): AgentSessionSnapshot {
  return { messages: [], activity: [], changes: [], tasks: [], toolCalls: [] };
}

interface AgentStoreState {
  install: AgentInstall;
  status: AgentRuntimeStatus;
  activeSessionId: string | null;
  bySession: Record<string, AgentSessionSnapshot>;
  pending: PermissionRequest | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  send: (sessionId: string, prompt: string) => Promise<void>;
  stop: (sessionId: string) => void;
  clear: (sessionId: string) => void;
  respond: (behavior: 'allow' | 'deny', remember?: boolean) => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => {
  /** Apply a structured event to its session's snapshot. */
  function apply(event: AgentEvent): void {
    set((state) => {
      const prev = state.bySession[event.sessionId] ?? emptySnapshot();
      const next: AgentSessionSnapshot = {
        messages: prev.messages,
        activity: prev.activity,
        changes: prev.changes,
        tasks: prev.tasks,
        toolCalls: prev.toolCalls,
      };

      switch (event.kind) {
        case 'message-start':
          next.messages = upsertMessage(prev.messages, event.message);
          break;
        case 'message-delta':
          next.messages = prev.messages.map((m) =>
            m.id === event.messageId ? { ...m, text: m.text + event.text, streaming: true } : m,
          );
          break;
        case 'message-done':
          next.messages = upsertMessage(prev.messages, event.message);
          break;
        case 'tool-start':
          next.toolCalls = [...prev.toolCalls.filter((c) => c.id !== event.call.id), event.call];
          break;
        case 'tool-end':
          next.toolCalls = prev.toolCalls.map((c) =>
            c.id === event.callId ? { ...c, status: event.status, endedAt: Date.now() } : c,
          );
          break;
        case 'file-change':
          next.changes = upsertChange(prev.changes, event.change);
          break;
        case 'activity':
          next.activity = [...prev.activity, event.item];
          break;
        case 'tasks':
          next.tasks = event.tasks;
          break;
        case 'result':
        case 'error':
          break;
      }

      return { bySession: { ...state.bySession, [event.sessionId]: next } };
    });

    if (event.kind === 'error') {
      useUIStore.getState().addToast({ title: 'Agent error', description: event.message, tone: 'danger' });
    }
  }

  return {
    install: { installed: false },
    status: 'unknown',
    activeSessionId: null,
    bySession: {},
    pending: null,
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      const api = window.limboo?.agent;
      if (!api) {
        set({ hydrated: true });
        return;
      }
      set({ hydrated: true });

      const [install, agentState] = await Promise.all([api.getInstall(), api.getState()]);
      set({ install, status: agentState.status, activeSessionId: agentState.activeSessionId });

      api.onStateChanged((s) =>
        set({ install: s.install, status: s.status, activeSessionId: s.activeSessionId }),
      );
      api.onEvent((event) => apply(event));
      api.onPermissionRequest((request) => set({ pending: request }));
    },

    loadSession: async (sessionId) => {
      const api = window.limboo?.agent;
      if (!api) return;
      const snapshot = await api.getSnapshot(sessionId);
      set((state) => ({ bySession: { ...state.bySession, [sessionId]: snapshot } }));
    },

    send: async (sessionId, prompt) => {
      const api = window.limboo?.agent;
      if (!api) return;
      try {
        await api.send(sessionId, prompt);
      } catch (err) {
        useUIStore.getState().addToast({
          title: 'Could not reach the agent',
          description: err instanceof Error ? err.message : String(err),
          tone: 'danger',
        });
      }
    },

    stop: (sessionId) => {
      void window.limboo?.agent?.stop(sessionId);
    },

    clear: (sessionId) => {
      void window.limboo?.agent?.clearSession(sessionId);
      set((state) => ({ bySession: { ...state.bySession, [sessionId]: emptySnapshot() } }));
    },

    respond: (behavior, remember) => {
      const { pending } = get();
      if (!pending) return;
      void window.limboo?.agent?.respondPermission({ id: pending.id, behavior, remember });
      set({ pending: null });
    },
  };
});

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const exists = messages.some((m) => m.id === message.id);
  return exists ? messages.map((m) => (m.id === message.id ? message : m)) : [...messages, message];
}

function upsertChange(changes: FileChange[], change: FileChange): FileChange[] {
  const rest = changes.filter((c) => c.path !== change.path);
  return [...rest, change];
}

/** Stable empty snapshot so selectors don't churn when a session has no data. */
export const EMPTY_SNAPSHOT: AgentSessionSnapshot = emptySnapshot();
