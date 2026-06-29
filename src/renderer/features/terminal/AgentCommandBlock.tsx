/**
 * AgentCommandBlock — renders one coding-agent shell command mirrored into the
 * integrated terminal. The Agent SDK does not stream tool stdout, so this is a
 * record (command echoed on start, output filled on completion) rather than a
 * live PTY stream. Styled to match the workspace's pure-black design language.
 */
import { useState } from 'react';
import { ChevronRight, Loader2, Bot } from 'lucide-react';
import type { TerminalCommandRecord } from '@shared/types';
import { cn } from '@/renderer/lib/cn';

function StatusDot({ status }: { status: TerminalCommandRecord['status'] }) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-accent" />;
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'error' ? 'bg-danger' : 'bg-success',
      )}
    />
  );
}

export function AgentCommandBlock({ record }: { record: TerminalCommandRecord }) {
  const [open, setOpen] = useState(false);
  const duration =
    record.endedAt && record.startedAt
      ? `${((record.endedAt - record.startedAt) / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="rounded-md border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')}
        />
        <Bot size={12} className="shrink-0 text-accent" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
          {record.command}
        </code>
        {duration && <span className="shrink-0 text-[10px] text-faint">{duration}</span>}
        {typeof record.exitCode === 'number' && record.status !== 'running' && (
          <span
            className={cn(
              'shrink-0 rounded px-1 text-[10px] font-medium',
              record.exitCode === 0 ? 'text-success' : 'text-danger',
            )}
          >
            exit {record.exitCode}
          </span>
        )}
        <StatusDot status={record.status} />
      </button>
      {open && record.output && (
        <pre className="max-h-48 overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {record.output}
        </pre>
      )}
    </div>
  );
}
