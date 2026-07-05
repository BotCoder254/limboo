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
  AgentSessionSnapshot,
  ChatMessage,
  ClarificationRequest,
  FileChange,
  PermissionRequest,
  PlanRevision,
  RateLimitInfo,
  RequestState,
  SessionPermissionMode,
} from '@shared/types';
import { useUIStore } from './useUIStore';
import { useAttachmentStore } from './useAttachmentStore';

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
  /** @deprecated legacy single-session mirror — use {@link requestsBySession}. */
  request: RequestState;
  /** Per-session run phase. Sessions can run concurrently, so this (not the
   *  single `request` field) is the source of truth for "is THIS session busy
   *  / streaming / awaiting-permission". */
  requestsBySession: Record<string, RequestState>;
  rateLimit?: RateLimitInfo;
  heartbeat: { lastOkAt: number | null; consecutiveFailures: number };
  activeSessionId: string | null;
  bySession: Record<string, AgentSessionSnapshot>;
  diagnostics: AgentDiagnostic[];
  /** Pending tool approvals, keyed by sessionId — a second session's request
   *  must never clobber a first session's still-unanswered one. */
  pendingBySession: Record<string, PermissionRequest>;
  /** Pending AskUserQuestion clarifications, keyed by sessionId (same reasoning). */
  pendingClarificationBySession: Record<string, ClarificationRequest>;
  /** Per-session composer permission mode. Absent = the Composer falls back to
   *  the resolved Plan-first default (workspace override ?? global setting).
   *  Owned here (not Composer-local state) so plan approval can flip a session
   *  out of Plan mode the moment implementation begins. */
  composerModeBySession: Record<string, SessionPermissionMode>;
  hydrated: boolean;

  setComposerMode: (sessionId: string, mode: SessionPermissionMode) => void;

  hydrate: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadDiagnostics: (sessionId?: string | null) => Promise<void>;
  send: (
    sessionId: string,
    prompt: string,
    mode?: SessionPermissionMode,
    attachmentIds?: string[],
  ) => Promise<void>;
  stop: (sessionId: string) => void;
  clear: (sessionId: string) => void;
  clearRateLimit: () => void;
  retryAuth: () => void;
  respond: (id: string, behavior: 'allow' | 'deny', remember?: boolean) => void;
  respondClarification: (
    id: string,
    answers: Record<string, string | string[]>,
    response?: string,
  ) => void;
  approvePlan: (sessionId: string, execMode?: SessionPermissionMode) => void;
  rejectPlan: (sessionId: string) => void;
  regeneratePlan: (sessionId: string, extra?: string) => void;
  setPlanPinned: (sessionId: string, pinned: boolean) => void;
  listPlanRevisions: (sessionId: string) => Promise<PlanRevision[]>;
  restorePlanRevision: (sessionId: string, revisionId: string) => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => {
  // Streamed-delta frame batching. A burst of `message-delta` events (the main
  // process now flushes finely so text reveals smoothly) would otherwise force a
  // React render per delta. Instead we accumulate delta text per streaming
  // message and apply it to the store ONCE per animation frame — collapsing a
  // burst into a single render aligned to the display refresh. Any non-delta
  // event flushes the buffer first so `message-done` carries the full text and
  // timeline ordering is preserved.
  const deltaBuffer = new Map<string, { sessionId: string; text: string }>(); // key: messageId
  let rafHandle: number | null = null;

  const scheduleFlush = (): void => {
    if (rafHandle !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      rafHandle = requestAnimationFrame(() => flushDeltasNow());
    } else {
      rafHandle = setTimeout(() => flushDeltasNow(), 16) as unknown as number;
    }
  };

  const flushDeltasNow = (): void => {
    if (rafHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle);
      else clearTimeout(rafHandle as unknown as ReturnType<typeof setTimeout>);
      rafHandle = null;
    }
    if (deltaBuffer.size === 0) return;
    // messageId -> accumulated text, and the set of sessions touched this frame.
    const appends = new Map<string, string>(); // key: messageId
    const sessions = new Set<string>();
    for (const [messageId, entry] of deltaBuffer) {
      appends.set(messageId, entry.text);
      sessions.add(entry.sessionId);
    }
    deltaBuffer.clear();
    set((state) => {
      const bySession = { ...state.bySession };
      for (const sessionId of sessions) {
        const prev = bySession[sessionId] ?? emptySnapshot();
        bySession[sessionId] = {
          ...prev,
          messages: prev.messages.map((m) => {
            const add = appends.get(m.id);
            return add ? { ...m, text: m.text + add, streaming: true } : m;
          }),
        };
      }
      return { bySession };
    });
  };

  /** Apply a structured event to its session's snapshot / global state. */
  function apply(event: AgentEvent): void {
    // Global (session-less) events first.
    if (event.kind === 'request-state') {
      // Merge into the per-session map — never overwrite other sessions'
      // in-flight phases (see requestsBySession doc comment).
      set((state) => ({
        request: event.request,
        requestsBySession: { ...state.requestsBySession, [event.sessionId]: event.request },
      }));
      return;
    }
    if (event.kind === 'diagnostic') {
      set((state) => ({
        diagnostics: [...state.diagnostics, event.diagnostic].slice(-MAX_DIAGNOSTICS),
      }));
      return;
    }

    // Streamed text: accumulate and apply on the next frame (see deltaBuffer).
    if (event.kind === 'message-delta') {
      const existing = deltaBuffer.get(event.messageId);
      if (existing) existing.text += event.text;
      else deltaBuffer.set(event.messageId, { sessionId: event.sessionId, text: event.text });
      scheduleFlush();
      return;
    }
    // Any other event must see the fully-applied stream first — otherwise a
    // `message-done` (which replaces text) could race ahead of buffered deltas.
    flushDeltasNow();

    set((state) => {
      const patch: Partial<AgentStoreState> = {};
      // Plan approved (possibly from another surface or a reloaded window):
      // once implementation starts, a composer still parked on 'plan' must flip
      // to the ask-before-edits execution mode. approvePlan() below sets the
      // user's explicit choice first, so this only fills the gap.
      if (event.kind === 'plan' && event.plan.status === 'implementing') {
        const cur = state.composerModeBySession[event.sessionId];
        if (!cur || cur === 'plan') {
          patch.composerModeBySession = {
            ...state.composerModeBySession,
            [event.sessionId]: 'default',
          };
        }
      }
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
        // 'message-delta' is handled ahead of this switch via the frame-batched
        // deltaBuffer (flushed just above), so it never reaches here.
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

      return { ...patch, bySession: { ...state.bySession, [event.sessionId]: next } };
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
    requestsBySession: {},
    rateLimit: undefined,
    heartbeat: { lastOkAt: null, consecutiveFailures: 0 },
    activeSessionId: null,
    bySession: {},
    diagnostics: [],
    pendingBySession: {},
    pendingClarificationBySession: {},
    composerModeBySession: {},
    hydrated: false,

    setComposerMode: (sessionId, mode) =>
      set((state) => ({
        composerModeBySession: { ...state.composerModeBySession, [sessionId]: mode },
      })),

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
        requestsBySession: agentState.requestsBySession ?? {},
        rateLimit: agentState.rateLimit,
        heartbeat: agentState.heartbeat,
        activeSessionId: agentState.activeSessionId,
        // Replay any requests that were already pending before this window
        // hydrated (e.g. a reload while another session is paused) — the
        // discrete onPermissionRequest/onClarificationRequest events below
        // only fire for NEW requests going forward.
        pendingBySession: Object.fromEntries(
          (agentState.pendingPermissions ?? []).map((r) => [r.sessionId, r]),
        ),
        pendingClarificationBySession: Object.fromEntries(
          (agentState.pendingClarifications ?? []).map((r) => [r.sessionId, r]),
        ),
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
      // Merge, never overwrite — a second session's request must not hide a
      // first session's still-unanswered one (see pendingBySession doc comment).
      api.onPermissionRequest((request) =>
        set((state) => ({
          pendingBySession: { ...state.pendingBySession, [request.sessionId]: request },
        })),
      );
      api.onClarificationRequest?.((request) =>
        set((state) => ({
          pendingClarificationBySession: {
            ...state.pendingClarificationBySession,
            [request.sessionId]: request,
          },
        })),
      );

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

    send: async (sessionId, prompt, mode, attachmentIds) => {
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
      // Attachment chips render on the optimistic bubble too; the echoed message
      // carries the authoritative (main-validated) set.
      const draftMetas = attachmentIds?.length
        ? (useAttachmentStore.getState().bySession[sessionId] ?? []).filter((a) =>
            attachmentIds.includes(a.id),
          )
        : undefined;
      const optimistic: ChatMessage = {
        id: clientMessageId,
        sessionId,
        role: 'user',
        // An attachments-only send shows main's substituted instruction.
        text: prompt.trim().length === 0 && attachmentIds?.length ? 'Review the attached files.' : prompt,
        streaming: false,
        createdAt: Date.now(),
        attachments: draftMetas && draftMetas.length > 0 ? draftMetas : undefined,
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
        await api.send(sessionId, prompt, mode, clientMessageId, attachmentIds);
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
      // Stopping aborts any paused request/clarification for this session (main
      // resolves the canUseTool promise via the abort signal) — drop the cards
      // for THIS session only, leaving any other session's cards untouched.
      set((state) => ({
        pendingBySession: omitKey(state.pendingBySession, sessionId),
        pendingClarificationBySession: omitKey(state.pendingClarificationBySession, sessionId),
      }));
    },

    clear: (sessionId) => {
      void window.limboo?.agent?.clearSession(sessionId);
      set((state) => ({
        bySession: { ...state.bySession, [sessionId]: emptySnapshot() },
        pendingClarificationBySession: omitKey(state.pendingClarificationBySession, sessionId),
      }));
    },

    clearRateLimit: () => {
      void window.limboo?.agent?.clearRateLimit?.();
    },

    retryAuth: () => {
      void window.limboo?.agent?.retryAuth?.();
    },

    respond: (id, behavior, remember) => {
      const { pendingBySession } = get();
      const entry = Object.values(pendingBySession).find((r) => r.id === id);
      if (!entry) return;
      void window.limboo?.agent?.respondPermission({ id, behavior, remember });
      set((state) => ({ pendingBySession: omitKey(state.pendingBySession, entry.sessionId) }));
    },

    respondClarification: (id, answers, response) => {
      const { pendingClarificationBySession } = get();
      const entry = Object.values(pendingClarificationBySession).find((r) => r.id === id);
      if (!entry) return;
      void window.limboo?.agent?.respondClarification?.({
        id,
        answers,
        response,
      });
      set((state) => ({
        pendingClarificationBySession: omitKey(state.pendingClarificationBySession, entry.sessionId),
      }));
    },

    approvePlan: (sessionId, execMode) => {
      const api = window.limboo?.agent;
      if (!api?.approvePlan) return;
      // Flip the composer out of Plan mode immediately — mirror main's coercion
      // (approving never starts another planning pass) so the composer shows the
      // exact mode the implementation run will use.
      const mode: SessionPermissionMode =
        !execMode || execMode === 'plan' ? 'default' : execMode;
      get().setComposerMode(sessionId, mode);
      api.approvePlan(sessionId, execMode).catch((err: unknown) => {
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

    setPlanPinned: (sessionId, pinned) => {
      void window.limboo?.agent?.setPlanPinned?.(sessionId, pinned);
    },

    listPlanRevisions: async (sessionId) => {
      const api = window.limboo?.agent;
      if (!api?.listPlanRevisions) return [];
      try {
        return await api.listPlanRevisions(sessionId);
      } catch {
        return [];
      }
    },

    restorePlanRevision: (sessionId, revisionId) => {
      void window.limboo?.agent?.restorePlanRevision?.(sessionId, revisionId);
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

/** Return a copy of `record` with `key` removed, without mutating the input. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
}

/** Stable empty snapshot so selectors don't churn when a session has no data. */
export const EMPTY_SNAPSHOT: AgentSessionSnapshot = emptySnapshot();
