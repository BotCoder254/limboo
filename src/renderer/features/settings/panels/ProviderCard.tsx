/**
 * Shared provider status row for Settings › Agent › Providers. Claude and
 * Cursor (and any future adapter) render the same icon-tile + name + status
 * line + icon-pill layout, driven by the shared {@link LifecycleMeta} shape
 * from features/agent/status.ts — one status vocabulary, no per-provider
 * pill styling.
 */
import type { AgentProvider } from '@shared/constants';
import { cn } from '@/renderer/lib/cn';
import { ProviderIcon } from '@/renderer/components/brand/ProviderIcon';
import type { LifecycleMeta } from '@/renderer/features/agent/status';

export function ProviderStatusRow({
  provider,
  name,
  statusLine,
  meta,
}: {
  provider: AgentProvider;
  name: string;
  statusLine: string;
  meta: LifecycleMeta;
}) {
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
        <ProviderIcon provider={provider} size={18} className="text-muted" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] text-fg">{name}</span>
        <span className="truncate text-[11px] text-faint">{statusLine}</span>
      </div>
      <span
        title={statusLine}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted"
      >
        <Icon size={12} className={cn(meta.text, meta.spin && 'animate-spin')} aria-hidden />
        {meta.label}
      </span>
    </div>
  );
}
