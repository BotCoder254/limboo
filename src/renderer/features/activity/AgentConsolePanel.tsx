/**
 * The Agent Console — a structured diagnostics timeline (not a flat log). Every
 * lifecycle moment (init, handshake, prompt, tool exec/approval, streaming,
 * completion, cancel, reconnect, auth change, rate limit, recovery, heartbeat)
 * arrives as an {@link AgentDiagnostic} from the main process with a severity,
 * category, timestamp, and expandable technical detail. Filterable by severity
 * so users can zoom from "everything" to "just the failures".
 */
import { useMemo, useState } from 'react';
import { ChevronRight, TerminalSquare } from 'lucide-react';
import type { AgentDiagnostic, DiagnosticSeverity } from '@shared/types';
import { EmptyState } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

const SEVERITY_DOT: Record<DiagnosticSeverity, string> = {
  debug: 'bg-faint',
  info: 'bg-accent',
  warning: 'bg-warning',
  error: 'bg-danger',
};

type Filter = 'all' | 'warning' | 'error';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'warning', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
];

export function AgentConsolePanel() {
  const diagnostics = useAgentStore((s) => s.diagnostics);
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => {
    const filtered = diagnostics.filter((d) => {
      if (filter === 'all') return true;
      if (filter === 'warning') return d.severity === 'warning' || d.severity === 'error';
      return d.severity === 'error';
    });
    return [...filtered].reverse();
  }, [diagnostics, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'flex-1 rounded px-2 py-1 text-[11px] transition-colors',
              filter === f.id ? 'bg-elevated text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          compact
          icon={TerminalSquare}
          title="No diagnostics yet"
          description="Agent lifecycle, tool, recovery, and heartbeat events stream into this console as Claude Code works."
        />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {items.map((d) => (
            <ConsoleRow key={d.id} diagnostic={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConsoleRow({ diagnostic }: { diagnostic: AgentDiagnostic }) {
  const [open, setOpen] = useState(false);
  const expandable = !!diagnostic.detail;
  return (
    <li className="rounded-md hover:bg-surface-2">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[diagnostic.severity])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{diagnostic.label}</span>
            <span className="shrink-0 text-[10px] text-faint">{relativeTime(diagnostic.at)}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-faint">{diagnostic.category}</span>
        </div>
        {expandable && (
          <ChevronRight size={12} className={cn('mt-0.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        )}
      </button>
      {open && diagnostic.detail && (
        <pre className="mx-2 mb-1.5 max-h-40 overflow-auto rounded-md border border-line bg-[#0a0a0a] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted">
          {diagnostic.detail}
        </pre>
      )}
    </li>
  );
}
