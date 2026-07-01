/**
 * Derives "is a session actively running" from the agent store. A run is in
 * flight whenever the request phase is anything but idle/done — that single
 * signal drives the spinner on the matching session row and the center header.
 * Running state is never stored on the session itself; it is purely agent state.
 */
import type { RequestPhase } from '@shared/types';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

/** Phases in which a session's run counts as "in flight" (busy/disabled UI). */
export const RUNNING_PHASES = new Set<RequestPhase>([
  'submitting',
  'connecting',
  'streaming',
  'recovering',
  'awaiting-permission',
]);

/**
 * Whether a specific session's agent run is currently in flight. Reads the
 * per-session phase map — sessions can run concurrently, so a single global
 * "running session id" can't correctly represent more than one at a time (that
 * mismatch used to hide a session's `awaiting-permission` pause the moment any
 * other session started or finished a run).
 */
export function useIsSessionRunning(sessionId: string): boolean {
  return useAgentStore((s) => {
    const phase = s.requestsBySession[sessionId]?.phase;
    return !!phase && RUNNING_PHASES.has(phase);
  });
}

/** Whether a specific session is paused on a tool approval or AskUserQuestion,
 *  needing the user's input to resume — distinct from merely "running". */
export function useSessionAwaitingInput(sessionId: string): boolean {
  return useAgentStore((s) => s.requestsBySession[sessionId]?.phase === 'awaiting-permission');
}
