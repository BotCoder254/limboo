/**
 * Inline permission approval — rendered directly in the conversation stream
 * instead of a modal. The Coding Agent Manager intercepts every gated tool call
 * (writes, commands, anything outside the auto-approve policy) and bridges the
 * request into `useAgentStore.pending`; this card surfaces it at the bottom of
 * the active session's timeline. The run stays paused until the user allows or
 * denies, so generation literally cannot continue without a decision.
 *
 * Visual language matches `ToolCard` (6px radius, hairline border, surface) so it
 * reads as part of the stream, not a separate chrome layer.
 */
import { useEffect } from 'react';
import { FilePen, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react';
import type { PermissionRequest, ToolRisk } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { useAgentStore } from '@/renderer/stores/useAgentStore';

const RISK_LABEL: Record<ToolRisk, string> = {
  read: 'Read',
  write: 'File edit',
  command: 'Command',
};

function riskIcon(risk: ToolRisk): LucideIcon {
  if (risk === 'command') return Terminal;
  if (risk === 'write') return FilePen;
  return ShieldCheck;
}

export function InlineApproval({ request }: { request: PermissionRequest }) {
  const respond = useAgentStore((s) => s.respond);
  const Icon = riskIcon(request.risk);

  // Keyboard: Ctrl/Cmd+Enter allows, Esc denies — matches the button order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respond('deny');
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) respond('allow');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request.id, respond]);

  return (
    <div className="ml-10 max-w-[85%] self-start overflow-hidden rounded-md border border-accent/40 bg-surface-2 animate-fade-in">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            request.risk === 'command' && 'bg-danger/15 text-danger',
            request.risk === 'write' && 'bg-warning/15 text-warning',
            request.risk === 'read' && 'bg-elevated text-muted',
          )}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-fg">Permission required</p>
          <p className="truncate text-[11px] text-faint">
            {RISK_LABEL[request.risk]} · {request.tool}
          </p>
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[12.5px] text-fg">{request.summary}</p>
        {request.detail && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
            {request.detail}
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => respond('allow', true)}
          className="text-[11.5px] text-muted transition-colors hover:text-fg"
        >
          Always allow this session
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => respond('deny')}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => respond('allow')}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
