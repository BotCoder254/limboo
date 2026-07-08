/**
 * Shared mapping from the agent's dual-state model to UI labels + token colors.
 * Centralised so the Composer, the Agent settings panel, and the Agent Console
 * all describe the same lifecycle / request the same way (no off-palette colors).
 */
import {
  CheckCircle2,
  CircleAlert,
  Download,
  KeyRound,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { AgentLifecycleStatus, CursorAuthStatus, RequestPhase } from '@shared/types';

export interface LifecycleMeta {
  /** Tailwind bg token for the status dot. */
  dot: string;
  /** Tailwind text token for inline labels. */
  text: string;
  label: string;
  /** Status glyph for the settings provider pill (dot stays for inline uses). */
  icon: LucideIcon;
  /** The icon should rotate (busy / probing states). */
  spin?: boolean;
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
    return { dot: 'bg-warning', text: 'text-warning', label: 'Not connected', icon: Download };
  }
  switch (lifecycle) {
    case 'starting':
    case 'initializing':
      return { dot: 'bg-muted', text: 'text-muted', label: 'Initializing', icon: Loader2, spin: true };
    case 'busy':
      return { dot: 'bg-accent', text: 'text-accent', label: 'Working', icon: Loader2, spin: true };
    case 'streaming':
      return { dot: 'bg-accent', text: 'text-accent', label: 'Streaming', icon: Loader2, spin: true };
    case 'awaiting-permission':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Awaiting approval', icon: KeyRound };
    case 'reconnecting':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Reconnecting', icon: Loader2, spin: true };
    case 'rate-limited':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Rate limited', icon: CircleAlert };
    case 'auth-required':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Sign in required', icon: KeyRound };
    case 'offline':
      return { dot: 'bg-danger', text: 'text-danger', label: 'Offline', icon: CircleAlert };
    case 'failed':
      return { dot: 'bg-danger', text: 'text-danger', label: 'Error', icon: CircleAlert };
    default:
      return { dot: 'bg-success', text: 'text-success', label: 'Ready', icon: CheckCircle2 };
  }
}

/**
 * Cursor provider auth status → the same meta shape, so the settings Providers
 * section renders Claude and Cursor through one shared pill.
 */
export function cursorStatusMeta(status: CursorAuthStatus | 'unknown'): LifecycleMeta {
  switch (status) {
    case 'authenticated-cli':
    case 'authenticated-api-key':
      return { dot: 'bg-success', text: 'text-success', label: 'Connected', icon: CheckCircle2 };
    case 'not-authenticated':
      return { dot: 'bg-warning', text: 'text-warning', label: 'Sign in required', icon: KeyRound };
    case 'not-installed':
      return { dot: 'bg-line-strong', text: 'text-faint', label: 'Install CLI', icon: Download };
    default:
      return { dot: 'bg-line-strong', text: 'text-faint', label: 'Checking…', icon: Loader2, spin: true };
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
