/**
 * Cursor runtime contracts — the seam between AgentManager and the Cursor CLI.
 *
 * `ProviderRunBridge` is deliberately provider-neutral: it is the exact set of
 * run-scoped callbacks AgentManager already builds for the Claude path
 * (streaming closures + tool/result hooks), so a third provider later
 * implements `start(spec, bridge)` against the same surface and nothing above
 * the adapters changes.
 *
 * The NDJSON event types mirror the official `--output-format stream-json`
 * contract (cursor.com/docs/cli/reference/output-format). Every field is
 * optional and unknown fields/types are ignored by design — the docs state
 * fields may be added in a backward-compatible way.
 */
import type { SessionPermissionMode } from '@shared/types';

/** Everything a single Cursor print-mode run needs, resolved up front. */
export interface CursorRunSpec {
  sessionId: string;
  /** Full prompt text (context block + user prompt); rides stdin, never argv. */
  prompt: string;
  /** The session's effective execution root — spawn cwd AND `--workspace`. */
  cwd: string;
  mode: SessionPermissionMode;
  /** True adds `--force` (edits applied). False = propose-only per the docs. */
  force: boolean;
  /** True adds `--trust` (Limboo's ack-hash gate decided, never blind). */
  trusted: boolean;
  model: string;
  /** Prior chat id for `--resume` (multi-turn conversations). */
  resumeChatId?: string;
  /** `--sandbox` value; undefined = omit the flag (CLI default / 'auto'). */
  sandbox?: 'enabled' | 'disabled';
  /** True adds `--approve-mcps` (only set after the flag probed as supported). */
  approveMcps?: boolean;
  /**
   * Per-run env overlay (bridge pipe/token + ELECTRON_RUN_AS_NODE for the
   * hook runner). Composed in AgentManager; merged over getSpawnEnv().
   */
  extraEnv?: Record<string, string>;
  abort: AbortController;
}

/**
 * Run-scoped callbacks into AgentManager. All streaming/tool/persistence
 * behavior stays owned by AgentManager — the runtime only translates wire
 * events into these calls.
 */
export interface ProviderRunBridge {
  ensureStreaming(): void;
  queueDelta(text: string): void;
  finishStreaming(finalText?: string): void;
  onToolUse(id: string, name: string, input: Record<string, unknown>): void;
  onToolResult(id: string, status: 'done' | 'error', output?: string): void;
  /** First `system/init` event → persist the provider resume token. */
  onInit(chatId: string): void;
  /** Terminal result event (present only on clean completions). */
  onResult(ok: boolean, text: string): void;
  /** Structured diagnostics (already-redacted detail only). */
  diag(
    category: string,
    severity: 'debug' | 'info' | 'warning' | 'error',
    label: string,
    detail?: string,
  ): void;
}

/** What a completed run reports back to AgentManager. */
export interface CursorRunOutcome {
  /** Chat id captured from system/init (also persisted via onInit). */
  chatId?: string;
  /** Terminal result, if the stream produced one. */
  result?: { ok: boolean; text: string };
  /** Proposed (not applied) write/shell tool calls seen in a non-force run. */
  proposedMutations: number;
}

/* ------------------------------------------------------------------ */
/* stream-json wire shapes (structural, forgiving)                     */
/* ------------------------------------------------------------------ */

export interface CursorMessageBlock {
  type?: string;
  text?: string;
}

export interface CursorEventBase {
  type?: string;
  subtype?: string;
  session_id?: string;
}

export interface CursorAssistantEvent extends CursorEventBase {
  type: 'assistant';
  message?: { role?: string; content?: CursorMessageBlock[] };
  /** Present on streaming deltas (and buffered flushes) — see classifyAssistantChunk. */
  timestamp_ms?: number;
  /** Present only on the buffered pre-tool-call flush. */
  model_call_id?: string;
}

export interface CursorToolCallEvent extends CursorEventBase {
  type: 'tool_call';
  subtype?: 'started' | 'completed' | string;
  call_id?: string;
  /** Typed union keyed per tool, e.g. { readToolCall: { args, result } }. */
  tool_call?: Record<string, { args?: Record<string, unknown>; result?: unknown } | undefined>;
}

export interface CursorResultEvent extends CursorEventBase {
  type: 'result';
  is_error?: boolean;
  duration_ms?: number;
  result?: string;
  request_id?: string;
}

export type CursorEvent =
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent
  | CursorEventBase;
