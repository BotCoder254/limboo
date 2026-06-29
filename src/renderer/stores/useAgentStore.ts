/**
 * Agent store — the renderer-side mirror of the main-process AgentManager.
 *
 * `hydrate()` loads the install/runtime state and subscribes to the structured
 * event stream through the preload bridge. The store keeps TWO orthogonal state
 * models in sync with main: the agent *lifecycle* (capability health) and the
 * *request* state (the active/last run). A failed request never collapses the
 * lifecycle — that distinction is what makes transient failures feel non-fatal.
 *
 * Every `AgentEvent` is applied to a per-session snapshot (messages / tool calls
 * / changes / tasks / activity) plus a global diagnostics ring buffer, so the UI
 * renders typed state and never scrapes raw output. All mutations go through
 * `window.limboo.agent.*`.
 */
import { create } from 'zustand';
import type {
  AgentDiagnostic,
  AgentEvent,
  AgentInstall,
  AgentLifecycleStatus,
  AgentMode,
  AgentSessionSnapshot,
  ChatMessage,
  FileChange,
  PermissionRequest,
  RateLimitInfo,
  RequestState,
} from '@shared/types';
import { useUIStore } from './useUIStore';

function emptySnapshot(): AgentSessionSnapshot {
  return { messages: [], activity: [], changes: [], tasks: [], toolCalls: [], plan: null };
}

const IDLE_REQUEST: RequestState = {
  sessionId: null,
  phase: 'idle',
  outcome: null,
  attempt: 0,
  maxAttempts: 0,
};

/** Cap on the in-memory diagnostics ring buffer. */
const MAX_DIAGNOSTICS = 500;

interface AgentStoreState {
  install: AgentInstall;
  lifecycle: AgentLifecycleStatus;
  request: RequestState;
  rateLimit?: RateLimitInfo;
  heartbeat: { lastOkAt: number | null; consecutiveFailures: number };
  activeSessionId: string | null;
  bySession: Record<string, AgentSessionSnapshot>;
  diagnostics: AgentDiagnostic[];
  pending: PermissionRequest | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadDiagnostics: (sessionId?: string | null) => Promise<void>;
  send: (sessionId: string, prompt: string, mode?: AgentMode) => Promise<void>;
  stop: (sessionId: string) => void;
  clear: (sessionId: string) => void;
  clearRateLimit: () => void;
  retryAuth: () => void;
  respond: (behavior: 'allow' | 'deny', remember?: boolean) => void;
  approvePlan: (sessionId: string) => void;
  rejectPlan: (sessionId: string) => void;
  regeneratePlan: (sessionId: string, extra?: string) => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => {
  /** Apply a structured event to its session's snapshot / global state. */
  function apply(event: AgentEvent): void {
    // Global (session-less) events first.
    if (event.kind === 'request-state') {
      set({ request: event.request });
      return;
    }
    if (event.kind === 'diagnostic') {
      set((state) => ({
        diagnostics: [...state.diagnostics, event.diagnostic].slice(-MAX_DIAGNOSTICS),
      }));
      return;
    }

    set((state) => {
      const prev = state.bySession[event.sessionId] ?? emptySnapshot();
      const next: AgentSessionSnapshot = {
        messages: prev.messages,
        activity: prev.activity,
        changes: prev.changes,
        tasks: prev.tasks,
        toolCalls: prev.toolCalls,
        plan: prev.plan,
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
        case 'plan':
          next.plan = event.plan;
          break;
        case 'result':
        case 'error':
          break;
      }

      return { bySession: { ...state.bySession, [event.sessionId]: next } };
    });

    // Only a genuine hard failure raises a danger toast; rate-limit / auth /
    // context-overflow surface as quieter Composer banners (driven by lifecycle
    // + request.outcome), not alarming toasts.
    if (event.kind === 'error' && event.outcome === 'failed') {
      useUIStore.getState().addToast({ title: 'Agent error', description: event.message, tone: 'danger' });
    }
  }

  return {
    install: { installed: false },
    lifecycle: 'starting',
    request: IDLE_REQUEST,
    rateLimit: undefined,
    heartbeat: { lastOkAt: null, consecutiveFailures: 0 },
    activeSessionId: null,
    bySession: {},
    diagnostics: [],
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
      set({
        install,
        lifecycle: agentState.lifecycle,
        request: agentState.request,
        rateLimit: agentState.rateLimit,
        heartbeat: agentState.heartbeat,
        activeSessionId: agentState.activeSessionId,
      });

      api.onStateChanged((s) =>
        set({
          install: s.install,
          lifecycle: s.lifecycle,
          request: s.request,
          rateLimit: s.rateLimit,
          heartbeat: s.heartbeat,
          activeSessionId: s.activeSessionId,
        }),
      );
      api.onEvent((event) => apply(event));
      api.onPermissionRequest((request) => set({ pending: request }));

      // Seed the diagnostics console with recent history.
      void get().loadDiagnostics();
    },

    loadSession: async (sessionId) => {
      const api = window.limboo?.agent;
      if (!api) return;
      const snapshot = await api.getSnapshot(sessionId);
      set((state) => ({ bySession: { ...state.bySession, [sessionId]: snapshot } }));
    },

    loadDiagnostics: async (sessionId) => {
      const api = window.limboo?.agent;
      if (!api?.getDiagnostics) return;
      const diagnostics = await api.getDiagnostics(sessionId ?? null);
      set({ diagnostics: diagnostics.slice(-MAX_DIAGNOSTICS) });
    },

    send: async (sessionId, prompt, mode) => {
      const api = window.limboo?.agent;
      if (!api) return;
      // Optimistic render: show the user's turn the instant Send is clicked,
      // using a client-generated id that main reuses for the persisted message.
      // The echoed `message-done` event then upserts in place (dedup by id), so
      // there is no duplicate or flicker even though main does heavy work first.
      const clientMessageId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: ChatMessage = {
        id: clientMessageId,
        sessionId,
        role: 'user',
        text: prompt,
        streaming: false,
        createdAt: Date.now(),
      };
      set((state) => {
        const snapshot = state.bySession[sessionId] ?? emptySnapshot();
        return {
          bySession: {
            ...state.bySession,
            [sessionId]: {
              ...snapshot,
              messages: upsertMessage(snapshot.messages, optimistic),
            },
          },
        };
      });
      try {
        await api.send(sessionId, prompt, mode, clientMessageId);
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

    clearRateLimit: () => {
      void window.limboo?.agent?.clearRateLimit?.();
    },

    retryAuth: () => {
      void window.limboo?.agent?.retryAuth?.();
    },

    respond: (behavior, remember) => {
      const { pending } = get();
      if (!pending) return;
      void window.limboo?.agent?.respondPermission({ id: pending.id, behavior, remember });
      set({ pending: null });
    },

    approvePlan: (sessionId) => {
      const api = window.limboo?.agent;
      if (!api?.approvePlan) return;
      api.approvePlan(sessionId).catch((err: unknown) => {
        useUIStore.getState().addToast({
          title: 'Could not start implementation',
          description: err instanceof Error ? err.message : String(err),
          tone: 'danger',
        });
      });
    },

    rejectPlan: (sessionId) => {
      void window.limboo?.agent?.rejectPlan?.(sessionId);
    },

    regeneratePlan: (sessionId, extra) => {
      void window.limboo?.agent?.regeneratePlan?.(sessionId, extra);
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
