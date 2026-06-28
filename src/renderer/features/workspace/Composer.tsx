/**
 * The composer — a self-contained, floating interaction surface. It is NOT a
 * full-width bar welded to the bottom: it's a rounded card that floats over the
 * transparent page with a gap on every side and no separator line, so the
 * conversation scrolls cleanly behind it.
 *
 * Wired to the Coding Agent Manager: submitting forwards the prompt to the active
 * session's Claude Code run. The footer reflects the live agent *lifecycle* and
 * the active *request* phase, and exposes quick model/thinking/permission
 * controls (left) plus a Send/Stop control (right). Context-aware banners explain
 * rate limits, expired auth, pending approvals, and context warnings.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUp, CircleStop, Paperclip, Sparkles } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { Spinner } from '@/renderer/components/ui';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { BUSY_LIFECYCLES, lifecycleMeta, phaseLabel } from '@/renderer/features/agent/status';
import { ComposerControls } from './ComposerControls';
import { ComposerBanner } from './ComposerBanner';

/** Max grow height before the editor scrolls internally (~40vh). */
const MAX_HEIGHT = 320;

export function Composer({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const sessionId = useSessionStore((s) => s.selectedId);
  const lifecycle = useAgentStore((s) => s.lifecycle);
  const phase = useAgentStore((s) => s.request.phase);
  const installed = useAgentStore((s) => s.install.installed);
  const installError = useAgentStore((s) => s.install.error);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const runningTool = useAgentStore((s) =>
    sessionId ? s.bySession[sessionId]?.toolCalls.find((c) => c.status === 'running')?.name : undefined,
  );
  const send = useAgentStore((s) => s.send);
  const stop = useAgentStore((s) => s.stop);

  const busy = activeSessionId === sessionId && BUSY_LIFECYCLES.has(lifecycle);
  const restricted = lifecycle === 'rate-limited' || lifecycle === 'auth-required';
  const blocked = disabled || !installed || busy || restricted;

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  // Keep the height correct when the value is cleared programmatically.
  useEffect(() => {
    if (value === '') autoGrow();
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || blocked || !sessionId) return;
    void send(sessionId, text);
    setValue('');
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.overflowY = 'hidden';
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="pointer-events-none px-4 pb-4">
      <div className="pointer-events-auto mx-auto w-full max-w-3xl">
        <ComposerBanner />
        <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface-2/95 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-colors focus-within:border-line-strong">
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Attach"
              disabled={blocked}
            >
              <Paperclip size={15} />
            </button>
            <textarea
              ref={ref}
              rows={1}
              value={value}
              disabled={disabled || !installed}
              onChange={(e) => {
                setValue(e.target.value);
                autoGrow();
              }}
              onKeyDown={onKeyDown}
              placeholder={composerPlaceholder(disabled, installed, restricted)}
              className="flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-fg placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
              style={{ maxHeight: MAX_HEIGHT }}
            />
            {busy ? (
              <button
                type="button"
                onClick={() => sessionId && stop(sessionId)}
                className="mb-0.5 flex h-7 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[12px] font-semibold text-fg transition-colors hover:bg-elevated"
              >
                <CircleStop size={14} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={blocked || value.trim().length === 0}
                className={cn(
                  'mb-0.5 flex h-7 w-7 items-center justify-center rounded-lg transition-opacity',
                  blocked || value.trim().length === 0
                    ? 'cursor-not-allowed bg-surface text-faint'
                    : 'bg-accent text-base hover:opacity-90',
                )}
                aria-label="Send"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line/60 pt-1.5">
            <ComposerControls disabled={disabled || !installed} />
            <span className="ml-auto flex items-center gap-2 text-[11px] text-faint">
              <StatusHint
                installed={installed}
                installError={installError}
                busy={busy}
                lifecycle={lifecycle}
                phase={phase}
                toolName={runningTool}
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function composerPlaceholder(disabled: boolean, installed: boolean, restricted: boolean): string {
  if (!installed) return 'Sign in to Claude Code to start…';
  if (restricted) return 'Drafting is fine — sending resumes shortly…';
  if (disabled) return 'Select or create a session to begin…';
  return 'Ask Claude Code to build something…';
}

function StatusHint({
  installed,
  installError,
  busy,
  lifecycle,
  phase,
  toolName,
}: {
  installed: boolean;
  installError?: string;
  busy: boolean;
  lifecycle: ReturnType<typeof useAgentStore.getState>['lifecycle'];
  phase: ReturnType<typeof useAgentStore.getState>['request']['phase'];
  toolName?: string;
}) {
  const meta = lifecycleMeta(lifecycle, installed);
  if (!installed) {
    return (
      <span className={cn('flex items-center gap-1', meta.text)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
        {installError ? 'Not connected' : meta.label}
      </span>
    );
  }
  if (busy) {
    return (
      <span className="flex items-center gap-1.5 text-muted">
        <Spinner size={11} />
        {phaseLabel(phase, toolName)}
      </span>
    );
  }
  if (lifecycle === 'ready') {
    return (
      <span className="flex items-center gap-1 text-faint">
        <Sparkles size={11} /> Claude Code ready
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1', meta.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}
