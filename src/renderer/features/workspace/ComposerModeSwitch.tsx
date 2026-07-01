/**
 * Plan / Build mode select — the control that governs the agent's execution mode
 * for the next prompt. In Plan mode the agent runs read-only and proposes an
 * implementation strategy for review; in Build (implement) mode it is free to
 * modify the repository (still gated by the per-tool approval policy).
 *
 * Rendered as a compact popover select (the shared {@link MiniSelect}) so it looks
 * and behaves exactly like the other composer footer controls — click the trigger,
 * pick the other mode from a small menu — rather than an always-expanded segmented
 * block. This also keeps the footer on one line as the center column narrows.
 *
 * Pure presentation: the selected mode lives in the Composer and is passed to
 * `agent.send(sessionId, prompt, mode)`.
 */
import type { ReactNode } from 'react';
import { ClipboardList, Hammer } from 'lucide-react';
import type { AgentMode } from '@shared/types';
import { MiniSelect, type Option } from './ComposerControls';

const MODE_GLYPH: Record<AgentMode, ReactNode> = {
  plan: <ClipboardList size={13} className="text-accent" />,
  implement: <Hammer size={13} className="text-muted" />,
};

const MODE_OPTIONS: Option<AgentMode>[] = [
  { value: 'plan', label: 'Plan', glyph: MODE_GLYPH.plan },
  { value: 'implement', label: 'Build', glyph: MODE_GLYPH.implement },
];

const MODE_TITLE =
  'Execution mode — Plan analyzes the repository read-only and proposes a strategy; Build lets the agent modify it';

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
    <MiniSelect
      title={MODE_TITLE}
      value={mode}
      options={MODE_OPTIONS}
      onChange={onChange}
      // Mirror the active mode's glyph on the trigger so the current mode reads at
      // a glance, matching the model select's provider-mark trigger.
      triggerGlyph={MODE_GLYPH[mode]}
      disabled={disabled}
    />
  );
}
