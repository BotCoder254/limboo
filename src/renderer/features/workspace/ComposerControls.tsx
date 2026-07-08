/**
 * Composer quick-controls — the bottom-left cluster inside the floating composer
 * that lets the user switch the agent's model, thinking budget, and approval
 * policy without opening Settings. Each is a compact popover wired straight to
 * `useSettingsStore.update`, so changes apply to the next prompt immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { Brain, Check, ChevronDown, Search, type LucideIcon } from 'lucide-react';
import { providerForModel, type AgentProvider } from '@shared/constants';
import { cn } from '@/renderer/lib/cn';
import { ProviderIcon } from '@/renderer/components/brand/ProviderIcon';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useAgentModels } from '@/renderer/features/agent/models';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Optional leading glyph rendered in the menu + trigger. */
  glyph?: React.ReactNode;
}

/** A compact popover select used across the composer footer (model / thinking /
 *  approval — and the Plan/Build mode switch). Exported so every composer control
 *  reads and behaves identically (same trigger, popover, click-outside, Esc). */
export function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  icon: Icon,
  triggerGlyph,
  title,
  disabled,
  accent = false,
  searchable = false,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
  /** Glyph shown before the label on the trigger (e.g. a provider mark). */
  triggerGlyph?: React.ReactNode;
  title: string;
  disabled?: boolean;
  /** Render the trigger as a filled accent pill (used for the active Plan state). */
  accent?: boolean;
  /** Show a filter input at the top of the popover (for long option lists). */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(q))
    : options;

  return (
    <div ref={ref} className="relative no-drag min-w-0">
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          accent
            ? 'bg-accent/15 font-medium text-accent hover:bg-accent/25'
            : 'text-muted hover:bg-elevated hover:text-fg',
          open && !accent && 'bg-elevated text-fg',
          open && accent && 'bg-accent/25',
        )}
      >
        {triggerGlyph ?? (Icon && <Icon size={12} className="text-faint" />)}
        <span className="max-w-[120px] truncate">{current?.label ?? value}</span>
        <ChevronDown size={11} className="text-faint" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 min-w-[180px] animate-pop-in overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-xl">
          {searchable && (
            <div className="mb-1 flex items-center gap-1.5 rounded-md bg-surface-2 px-2">
              <Search size={11} className="shrink-0 text-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-6 w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-faint"
              />
            </div>
          )}
          {/* Height-capped so long option lists (e.g. discovered Cursor
              models) scroll instead of growing the popover past the
              thinking-select scale. */}
          <div className="max-h-56 overflow-y-auto">
            {visible.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2',
                  option.value === value ? 'text-fg' : 'text-muted',
                )}
              >
                {option.glyph}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            ))}
            {visible.length === 0 && (
              <p className="px-2 py-1.5 text-[12px] text-faint">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PROVIDER_LABEL: Record<AgentProvider, string> = {
  anthropic: 'Claude Code',
  cursor: 'Cursor',
};

export function ComposerControls({ disabled = false }: { disabled?: boolean }) {
  const agent = useSettingsStore((s) => s.settings.agent);
  const update = useSettingsStore((s) => s.update);
  const models = useAgentModels();

  // The provider follows the model; the Agent select switches by jumping to
  // the target provider's first catalog model, and the Model select then
  // offers only that provider's models.
  const provider = providerForModel(agent.model);
  const providerModels = models.filter((m) => m.provider === provider);

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <MiniSelect
        title="Agent"
        value={provider}
        triggerGlyph={<ProviderIcon provider={provider} size={12} className="text-faint" />}
        options={(Object.keys(PROVIDER_LABEL) as AgentProvider[]).map((p) => ({
          value: p,
          label: PROVIDER_LABEL[p],
          glyph: <ProviderIcon provider={p} size={13} className="text-muted" />,
        }))}
        onChange={(next) => {
          if (next === provider) return;
          const first = models.find((m) => m.provider === next);
          if (first) void update({ agent: { model: first.value } });
        }}
        disabled={disabled}
      />
      <span className="h-3.5 w-px bg-line" />
      <MiniSelect
        title="Model"
        value={agent.model}
        options={providerModels.map((m) => ({ value: m.value, label: m.label }))}
        onChange={(model) => void update({ agent: { model } })}
        disabled={disabled}
        searchable
      />
      <span className="h-3.5 w-px bg-line" />
      <MiniSelect
        title="Extended thinking"
        icon={Brain}
        value={agent.thinking}
        options={[
          { value: 'off', label: 'Thinking: Off' },
          { value: 'on', label: 'Thinking: On' },
          { value: 'adaptive', label: 'Thinking: Adaptive' },
        ]}
        onChange={(thinking) => void update({ agent: { thinking } })}
        disabled={disabled}
      />
    </div>
  );
}
