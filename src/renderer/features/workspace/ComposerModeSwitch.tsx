/**
 * Plan / Implement segmented switch — the control that governs the agent's
 * execution mode for the next prompt. In Plan mode the agent runs read-only and
 * proposes an implementation strategy for review; in Implement mode it is free to
 * modify the repository (still gated by the per-tool approval policy).
 *
 * Pure presentation: the selected mode lives in the Composer and is passed to
 * `agent.send(sessionId, prompt, mode)`.
 */
import { ClipboardList, Hammer } from 'lucide-react';
import type { AgentMode } from '@shared/types';
import { cn } from '@/renderer/lib/cn';

const MODES: Array<{ value: AgentMode; label: string; icon: typeof ClipboardList; title: string }> = [
  { value: 'plan', label: 'Plan', icon: ClipboardList, title: 'Plan — analyze the repository and propose a strategy (read-only)' },
  { value: 'implement', label: 'Build', icon: Hammer, title: 'Implement — let the agent modify the repository' },
];

export function ComposerModeSwitch({
  mode,
  onChange,
  disabled = false,
}: {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="no-drag inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5">
      {MODES.map(({ value, label, icon: Icon, title }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            title={title}
            disabled={disabled}
            onClick={() => onChange(value)}
            className={cn(
              'flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? value === 'plan'
                  ? 'bg-elevated text-accent'
                  : 'bg-elevated text-fg'
                : 'text-muted hover:text-fg',
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
