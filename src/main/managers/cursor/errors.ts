/**
 * Cursor run-error classification — the Cursor counterpart of AgentManager's
 * classifyAgentError, mapping a thrown/raw error string into the same
 * structural Classification shape (request outcome + optional lifecycle
 * escalation + recoverability).
 *
 * The runtime folds process-exit knowledge into the message it throws (see
 * NO_RESULT_MARKER): the documented failure contract is "non-zero exit,
 * errors on stderr, the stream may end without a terminal result", so a
 * marker on that path lets one string carry everything the classifier needs.
 */
import type { AgentLifecycleStatus, RateLimitInfo, RequestOutcome } from '@shared/types';

export interface CursorClassification {
  outcome: RequestOutcome;
  /** If set, escalate lifecycle; otherwise lifecycle stays ready/current. */
  lifecycle?: AgentLifecycleStatus;
  rateLimit?: RateLimitInfo;
  /** True when a transparent recovery retry is warranted. */
  recoverable: boolean;
}

/**
 * Appended by CursorRuntime when the child exited non-zero without emitting a
 * terminal result event — the documented "stream ended early" failure shape,
 * which warrants one transparent retry.
 */
export const NO_RESULT_MARKER = '[cursor-no-terminal-result]';

export function classifyCursorError(raw: string): CursorClassification {
  const t = raw.toLowerCase();

  // Rate / usage limit — service refused more calls; auth + process healthy.
  if (/rate.?limit|too many requests|\b429\b|usage limit|quota exceeded|quota reached/.test(t)) {
    return {
      outcome: 'rate-limited',
      lifecycle: 'rate-limited',
      rateLimit: { message: raw.slice(0, 240) },
      recoverable: false,
    };
  }
  // Auth — sign in with cursor-agent login or configure an API key.
  if (/not (logged in|authenticated)|unauthorized|\b401\b|\b403\b|invalid api key|login required|authentication (failed|required|error)|cursor-agent login|api key.*(missing|invalid|expired)/.test(t)) {
    return { outcome: 'auth-required', lifecycle: 'auth-required', recoverable: false };
  }
  // Context window — request-local; the capability stays ready.
  if (/context (window|length|limit)|prompt is too long|maximum context|too many tokens|context_length/.test(t)) {
    return { outcome: 'context-overflow', recoverable: false };
  }
  // Transient transport / process death / provider overload — retry once via
  // the existing recovery budget. Includes the documented ended-early shape.
  if (
    raw.includes(NO_RESULT_MARKER) ||
    /econnreset|etimedout|epipe|enotfound|eai_again|socket hang up|connection (reset|refused|closed)|stream (closed|ended|error)|network|fetch failed|\b50[023]\b|\b529\b|overloaded|temporarily unavailable/.test(t)
  ) {
    return { outcome: 'failed', lifecycle: 'reconnecting', recoverable: true };
  }
  // Default: request-local failure; capability stays healthy.
  return { outcome: 'failed', recoverable: false };
}

/**
 * A resume-token corruption shape: the stored chat id no longer resolves
 * server-side. The caller drops the stored id once and retries fresh
 * (mirrors the Claude ede_diagnostic self-heal).
 */
export function isCursorResumeCorruption(raw: string): boolean {
  const t = raw.toLowerCase();
  return (
    /\b(chat|session|conversation|thread)\b[^\n]{0,60}\b(not found|does not exist|invalid|expired|deleted)\b/.test(t) ||
    /\b(invalid|unknown|expired)\b[^\n]{0,40}\b(chat|resume|session) id\b/.test(t)
  );
}
