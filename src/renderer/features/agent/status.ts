/**
 * Shared mapping from the agent's dual-state model to UI labels + token colors.
 * Centralised so the Composer, the Agent settings panel, and the Agent Console
 * all describe the same lifecycle / request the same way (no off-palette colors).
 */
import type { AgentLifecycleStatus, RequestPhase } from '@shared/types';

export interface LifecycleMeta {
  /** Tailwind bg token for the status dot. */
  dot: string;
  /** Tailwind text token for inline labels. */
  text: string;
  label: string;
}

/** Lifecycles where the agent is actively doing work for a run. */
export const BUSY_LIFECYCLES = new Set<AgentLifecycleStatus>([
  'busy',
  'streaming',
  'awaiting-permission',
  'reconnecting',
]);

export function lifecycleMeta(lifecycle: AgentLifecycleStatus, installed: boolean): LifecycleMeta {
  if (!installed || lifecycle === 'not-installed') {
    return { dot: 'bg-warning', text: 'text-warning', label: 'Not connected' };
  }
  switch (lifecycle) {
    case 'starting':
    case 'initializing':
      return { dot: 'bg-muted', text: 'text-muted', label: 'Initializing' };
    case 'busy':
      return { dot: 'bg-accent', text: 'text-accent', label: 'Working' };
    case 'streaming':
      return { dot: 'bg-accent', text: 'text-accent', label: 'Streaming' };
    case 'awaiting-permission':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Awaiting approval' };
    case 'reconnecting':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Reconnecting' };
    case 'rate-limited':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Rate limited' };
    case 'auth-required':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Sign in required' };
    case 'offline':
      return { dot: 'bg-danger', text: 'text-danger', label: 'Offline' };
    case 'failed':
      return { dot: 'bg-danger', text: 'text-danger', label: 'Error' };
    default:
      return { dot: 'bg-success', text: 'text-success', label: 'Ready' };
  }
}

/** A short, human progress phrase for the active run's phase + tool activity. */
export function phaseLabel(phase: RequestPhase, toolName?: string): string {
  if (toolName) {
    switch (toolName) {
      case 'WebSearch':
      case 'WebFetch':
        return 'Searching the web…';
      case 'Read':
      case 'Grep':
      case 'Glob':
      case 'LS':
        return 'Reading project files…';
      case 'Bash':
        return 'Running a command…';
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return 'Editing files…';
      default:
        return 'Using a tool…';
    }
  }
  switch (phase) {
    case 'submitting':
    case 'connecting':
      return 'Thinking…';
    case 'streaming':
      return 'Generating…';
    case 'awaiting-permission':
      return 'Waiting for your approval…';
    case 'recovering':
      return 'Reconnecting…';
    case 'done':
      return 'Finalizing…';
    default:
      return 'Working…';
  }
}
