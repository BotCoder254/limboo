/**
 * Context-aware Composer banner. Sits above the input inside the floating
 * composer card and explains *why* sending is unavailable or paused — rate
 * limits, expired auth, a pending tool approval, or a context-window warning.
 * Driven by the agent's lifecycle + last-request outcome, never by scraping logs.
 */
import { AlertTriangle, ClipboardCheck, KeyRound, Loader2, TimerReset } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { runCommand } from '@/renderer/lib/commands';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

type Tone = 'warning' | 'danger' | 'accent';

const TONE: Record<Tone, { border: string; icon: string; bg: string }> = {
  warning: { border: 'border-warning/40', icon: 'text-warning', bg: 'bg-warning/10' },
  danger: { border: 'border-danger/40', icon: 'text-danger', bg: 'bg-danger/10' },
  accent: { border: 'border-accent/40', icon: 'text-accent', bg: 'bg-accent/10' },
};

function formatReset(resetsAt?: number, timezone?: string): string {
  if (!resetsAt) return '';
  try {
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(resetsAt),
    );
    return timezone ? `${time} (your local time)` : time;
  } catch {
    return '';
  }
}

export function ComposerBanner() {
  const lifecycle = useAgentStore((s) => s.lifecycle);
  const rateLimit = useAgentStore((s) => s.rateLimit);
  const outcome = useAgentStore((s) => s.request.outcome);
  const retryAuth = useAgentStore((s) => s.retryAuth);
  const clearRateLimit = useAgentStore((s) => s.clearRateLimit);
  const sessionId = useSessionStore((s) => s.selectedId);
  const planReady = useAgentStore(
    (s) => (sessionId ? s.bySession[sessionId]?.plan?.status : undefined) === 'ready',
  );

  let tone: Tone | null = null;
  let Icon: LucideIcon = AlertTriangle;
  let title = '';
  let body = '';
  let action: { label: string; onClick: () => void } | null = null;

  if (lifecycle === 'rate-limited') {
    tone = 'warning';
    Icon = TimerReset;
    title = 'Anthropic usage limit reached';
    const when = formatReset(rateLimit?.resetsAt, rateLimit?.timezone);
    body =
      `Claude Code is still connected, but it can't run more prompts until your usage allocation resets` +
      (when ? ` around ${when}.` : '.') +
      ' You can keep drafting — sending resumes automatically once it clears.';
    action = { label: 'Try now', onClick: clearRateLimit };
  } else if (lifecycle === 'auth-required') {
    tone = 'danger';
    Icon = KeyRound;
    title = 'Claude Code needs to be signed in again';
    body =
      'Your Claude Code authentication expired. Open a terminal, run `claude`, and sign in — Limboo reuses that login. Then retry.';
    action = { label: 'Re-check sign-in', onClick: retryAuth };
  } else if (lifecycle === 'reconnecting') {
    tone = 'warning';
    Icon = Loader2;
    title = 'Reconnecting to Claude Code';
    body = 'A transient issue interrupted the run. Limboo is restoring the connection and will resume automatically.';
  } else if (planReady) {
    tone = 'accent';
    Icon = ClipboardCheck;
    title = 'Plan ready for your review';
    body = 'Claude Code proposed an implementation plan. Review it in the Tasks panel, then approve to begin — nothing changes until you do.';
    action = { label: 'Review plan', onClick: () => runCommand('drawer.toggleTasks') };
  } else if (outcome === 'context-overflow') {
    tone = 'warning';
    Icon = AlertTriangle;
    title = 'Conversation is getting long';
    body = 'The context window is near its limit, so the agent may soon summarize or compress earlier turns.';
  }

  if (!tone) return null;
  const t = TONE[tone];

  return (
    <div
      className={cn(
        'mb-2 flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[12px] animate-fade-in',
        t.border,
        t.bg,
      )}
    >
      <Icon size={15} className={cn('mt-0.5 shrink-0', t.icon, lifecycle === 'reconnecting' && 'animate-spin')} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{title}</p>
        <p className="mt-0.5 leading-relaxed text-muted">{body}</p>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="no-drag shrink-0 self-center rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg transition-colors hover:bg-elevated"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
