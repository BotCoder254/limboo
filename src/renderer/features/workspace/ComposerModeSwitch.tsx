/**
 * Permission-mode selector — the single composer control that governs how the
 * agent is allowed to act on the next prompt. It mirrors Claude Code's own
 * `Shift+Tab` cycle vocabulary so the desktop app stays in lock-step with the
 * harness (see {@link SessionPermissionMode}):
 *
 *   • Plan            — read-only; the agent proposes a strategy for review.
 *   • Ask before edits — writes/commands prompt for approval (SDK `default`).
 *   • Accept edits     — file edits auto-approve; commands still prompt.
 *
 * `bypassPermissions` is deliberately absent (this is a safety-first local app).
 * When Plan is active the trigger renders as a prominent accent "Plan" pill so the
 * planning state reads at a glance without a separate panel.
 *
 * Pure presentation: the selected mode lives in the Composer and is passed to
 * `agent.send(sessionId, prompt, mode)`; every prompt inherits it until changed.
 */
import type { ReactNode } from 'react';
import { ClipboardList, FilePen, ShieldCheck } from 'lucide-react';
import type { SessionPermissionMode } from '@shared/types';
import { MiniSelect, type Option } from './ComposerControls';

const MODE_GLYPH: Record<SessionPermissionMode, ReactNode> = {
  plan: <ClipboardList size={13} className="text-accent" />,
  default: <ShieldCheck size={13} className="text-muted" />,
  acceptEdits: <FilePen size={13} className="text-muted" />,
};

const MODE_OPTIONS: Option<SessionPermissionMode>[] = [
  { value: 'plan', label: 'Plan', glyph: MODE_GLYPH.plan },
  { value: 'default', label: 'Ask before edits', glyph: MODE_GLYPH.default },
  { value: 'acceptEdits', label: 'Accept edits', glyph: MODE_GLYPH.acceptEdits },
];

const MODE_TITLE =
  'Permission mode — Plan is read-only and proposes a strategy; Ask before edits prompts for every change; Accept edits auto-approves file edits (commands still prompt)';

export function ComposerModeSwitch({
  mode,
  onChange,
  disabled = false,
}: {
  mode: SessionPermissionMode;
  onChange: (mode: SessionPermissionMode) => void;
  disabled?: boolean;
}) {
  return (
    <MiniSelect
      title={MODE_TITLE}
      value={mode}
      options={MODE_OPTIONS}
      onChange={onChange}
      // Mirror the active mode's glyph on the trigger so it reads at a glance, and
      // light the trigger up in accent while Plan is active (first-class state).
      triggerGlyph={MODE_GLYPH[mode]}
      accent={mode === 'plan'}
      disabled={disabled}
    />
  );
}
