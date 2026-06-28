/**
 * Composer quick-controls — the bottom-left cluster inside the floating composer
 * that lets the user switch the agent's model, thinking budget, and approval
 * policy without opening Settings. Each is a compact popover wired straight to
 * `useSettingsStore.update`, so changes apply to the next prompt immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { Brain, Check, ChevronDown, ShieldCheck, type LucideIcon } from 'lucide-react';
import { AGENT_MODELS, providerForModel } from '@shared/constants';
import { cn } from '@/renderer/lib/cn';
import { ProviderIcon } from '@/renderer/components/brand/ProviderIcon';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';

interface Option<T extends string> {
  value: T;
  label: string;
  /** Optional leading glyph rendered in the menu + trigger. */
  glyph?: React.ReactNode;
}

function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  icon: Icon,
  triggerGlyph,
  title,
  disabled,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
  /** Glyph shown before the label on the trigger (e.g. a provider mark). */
  triggerGlyph?: React.ReactNode;
  title: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
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

  return (
    <div ref={ref} className="relative no-drag">
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
          open && 'bg-elevated text-fg',
        )}
      >
        {triggerGlyph ?? (Icon && <Icon size={12} className="text-faint" />)}
        <span className="max-w-[120px] truncate">{current?.label ?? value}</span>
        <ChevronDown size={11} className="text-faint" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 min-w-[180px] animate-pop-in overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-xl">
          {options.map((option) => (
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
        </div>
      )}
    </div>
  );
}

export function ComposerControls({ disabled = false }: { disabled?: boolean }) {
  const agent = useSettingsStore((s) => s.settings.agent);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="flex items-center gap-0.5">
      <MiniSelect
        title="Model"
        value={agent.model}
        triggerGlyph={
          <ProviderIcon provider={providerForModel(agent.model)} size={12} className="text-faint" />
        }
        options={AGENT_MODELS.map((m) => ({
          value: m.value,
          label: m.label,
          glyph: <ProviderIcon provider={m.provider} size={13} className="text-muted" />,
        }))}
        onChange={(model) => void update({ agent: { model } })}
        disabled={disabled}
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
      <span className="h-3.5 w-px bg-line" />
      <MiniSelect
        title="Approval policy"
        icon={ShieldCheck}
        value={agent.permissionMode}
        options={[
          { value: 'approve-edits', label: 'Approve edits & commands' },
          { value: 'approve-all', label: 'Approve everything' },
          { value: 'auto', label: 'Auto-approve' },
        ]}
        onChange={(permissionMode) => void update({ agent: { permissionMode } })}
        disabled={disabled}
      />
    </div>
  );
}
