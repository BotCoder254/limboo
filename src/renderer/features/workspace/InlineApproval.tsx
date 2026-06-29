/**
 * Inline permission approval — rendered directly inside the active assistant
 * turn, immediately beneath the latest streamed content, instead of a modal or a
 * detached card. The Coding Agent Manager intercepts every gated tool call
 * (writes, commands, anything outside the auto-approve policy) and bridges the
 * request into `useAgentStore.pending`. The run stays paused until the user
 * allows or denies, so generation literally cannot continue without a decision.
 *
 * Visual language matches the de-carded inline tool rows: a faint lead icon + a
 * one-line explanation + the action buttons, with only a subtle accent edge to
 * signal the run is waiting on a decision — not a separate chrome layer.
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
    <div className="flex flex-col gap-2 border-l border-accent/50 pl-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <Icon
          size={13}
          className={cn(
            'shrink-0',
            request.risk === 'command' && 'text-danger',
            request.risk === 'write' && 'text-warning',
            request.risk === 'read' && 'text-muted',
          )}
        />
        <span className="text-[12px] font-medium text-fg">Permission required</span>
        <span className="truncate text-[11px] text-faint">
          {RISK_LABEL[request.risk]} · {request.tool}
        </span>
      </div>

      <p className="text-[12.5px] leading-relaxed text-fg">{request.summary}</p>
      {request.detail && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {request.detail}
        </pre>
      )}

      <div className="flex items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={() => respond('allow')}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() => respond('deny')}
          className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-elevated hover:text-fg"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => respond('allow', true)}
          className="ml-auto text-[11.5px] text-faint transition-colors hover:text-fg"
        >
          Always allow this session
        </button>
      </div>
    </div>
  );
}
