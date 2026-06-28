/**
 * Permission approval modal. The Coding Agent Manager intercepts every gated
 * tool call (writes, commands, anything outside the auto-approve policy) and
 * bridges it here. The user sees exactly what the agent wants to do — the
 * command text or a diff preview — and explicitly allows or denies it before the
 * tool runs. Driven entirely by `useAgentStore.pending`.
 */
import { useEffect } from 'react';
import { FilePen, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react';
import type { ToolRisk } from '@shared/types';
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

export function ApprovalModal() {
  const pending = useAgentStore((s) => s.pending);
  const respond = useAgentStore((s) => s.respond);

  // Keyboard: Enter allows, Esc denies — matches the button order.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respond('deny');
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) respond('allow');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, respond]);

  if (!pending) return null;
  const Icon = riskIcon(pending.risk);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              pending.risk === 'command' && 'bg-danger/15 text-danger',
              pending.risk === 'write' && 'bg-warning/15 text-warning',
              pending.risk === 'read' && 'bg-elevated text-muted',
            )}
          >
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-fg">Permission required</p>
            <p className="truncate text-[11px] text-faint">
              {RISK_LABEL[pending.risk]} · {pending.tool}
            </p>
          </div>
        </div>

        <div className="px-4 py-3">
          <p className="text-[13px] text-fg">{pending.summary}</p>
          {pending.detail && (
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
              {pending.detail}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() => respond('allow', true)}
            className="text-[12px] text-muted transition-colors hover:text-fg"
          >
            Always allow this session
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => respond('deny')}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
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
    </div>
  );
}
