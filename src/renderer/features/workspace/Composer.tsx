/**
 * The composer — the permanent interaction surface pinned to the bottom of the
 * center column. Wired to the Coding Agent Manager: submitting forwards the
 * prompt to the active session's Claude Code run and the footer reflects the
 * live agent status (idle / streaming / awaiting approval), with a Stop control
 * while a run is in flight.
 */
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUp, CircleStop, Paperclip, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { Spinner } from '@/renderer/components/ui';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

export function Composer({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const sessionId = useSessionStore((s) => s.selectedId);
  const status = useAgentStore((s) => s.status);
  const installed = useAgentStore((s) => s.install.installed);
  const installError = useAgentStore((s) => s.install.error);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const send = useAgentStore((s) => s.send);
  const stop = useAgentStore((s) => s.stop);

  const busy = activeSessionId === sessionId && (status === 'streaming' || status === 'awaiting-permission' || status === 'connecting');
  const blocked = disabled || !installed || busy;

  const autoGrow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = () => {
    const text = value.trim();
    if (!text || blocked || !sessionId) return;
    void send(sessionId, text);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 focus-within:border-line-strong">
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
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
          placeholder={composerPlaceholder(disabled, installed)}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-[13px] text-fg placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => sessionId && stop(sessionId)}
            className="flex h-7 items-center gap-1.5 rounded-md bg-surface px-2.5 text-[12px] font-semibold text-fg transition-colors hover:bg-elevated"
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
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-opacity',
              blocked || value.trim().length === 0
                ? 'cursor-not-allowed bg-surface text-faint'
                : 'bg-accent text-base hover:opacity-90',
            )}
          >
            <ArrowUp size={14} />
            Send
          </button>
        )}
      </div>
      <div className="mx-auto mt-1.5 flex max-w-3xl items-center gap-3 text-[11px] text-faint">
        <StatusHint installed={installed} installError={installError} busy={busy} status={status} sessionActive={activeSessionId === sessionId} />
        <span className="ml-auto">Enter to send • Shift+Enter for newline</span>
      </div>
    </div>
  );
}

function composerPlaceholder(disabled: boolean, installed: boolean): string {
  if (!installed) return 'Sign in to Claude Code to start…';
  if (disabled) return 'Select or create a session to begin…';
  return 'Ask Claude Code to build something…';
}

function StatusHint({
  installed,
  installError,
  busy,
  status,
  sessionActive,
}: {
  installed: boolean;
  installError?: string;
  busy: boolean;
  status: string;
  sessionActive: boolean;
}) {
  if (!installed) {
    return (
      <span className="flex items-center gap-1 text-warning">
        <ShieldAlert size={11} /> {installError ?? 'Claude Code not connected'}
      </span>
    );
  }
  if (busy && sessionActive) {
    return (
      <span className="flex items-center gap-1.5 text-muted">
        <Spinner size={11} />
        {status === 'awaiting-permission' ? 'Waiting for your approval…' : 'Claude Code is working…'}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Sparkles size={11} /> Claude Code ready
    </span>
  );
}
