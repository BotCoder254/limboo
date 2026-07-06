/**
 * Resume banner — shown under the session header when the repository diverged
 * from the session's last snapshot (commits landed, a rebase happened, the
 * worktree was recreated, …). Purely informational: Review opens the delta
 * dialog, dismiss drops the pending prompt injection. Matches the
 * MissingWorktreeBanner row idiom (h-9, border-b, bg-surface).
 */
import { AlertTriangle, Info, X } from 'lucide-react';
import { IconButton } from '@/renderer/components/ui';
import { useResumeStore } from '@/renderer/stores/useResumeStore';

export function ResumeBanner({ sessionId }: { sessionId: string }) {
  const state = useResumeStore((s) => s.bySession[sessionId]);
  const openDetail = useResumeStore((s) => s.openDetail);
  const dismiss = useResumeStore((s) => s.dismiss);

  if (!state || state.phase !== 'delta') return null;

  // Warning tone for the structural cases; info tone for ordinary drift.
  const warn = /history rewritten|root changed/i.test(state.summary ?? '');

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
      {warn ? (
        <AlertTriangle size={13} className="shrink-0 text-warning" />
      ) : (
        <Info size={13} className="shrink-0 text-accent" />
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
        Repository changed since last visit
        {state.summary ? <span className="text-faint"> — {state.summary}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => void openDetail(sessionId)}
        className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-base transition-opacity hover:opacity-90"
      >
        Review
      </button>
      <IconButton label="Dismiss" size="sm" onClick={() => void dismiss(sessionId)}>
        <X size={13} />
      </IconButton>
    </div>
  );
}
