/**
 * Derives "is a session actively running" from the agent store. A run is in
 * flight whenever the request phase is anything but idle/done — that single
 * signal drives the spinner on the matching session row and the center header.
 * Running state is never stored on the session itself; it is purely agent state.
 */
import type { RequestPhase } from '@shared/types';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

const RUNNING_PHASES = new Set<RequestPhase>([
  'submitting',
  'connecting',
  'streaming',
  'recovering',
  'awaiting-permission',
]);

/** The id of the session whose agent run is currently in flight, or null. */
export function useRunningSessionId(): string | null {
  return useAgentStore((s) =>
    RUNNING_PHASES.has(s.request.phase) ? s.request.sessionId : null,
  );
}

/** Whether a specific session is the one currently running. */
export function useIsSessionRunning(sessionId: string): boolean {
  return useRunningSessionId() === sessionId;
}
