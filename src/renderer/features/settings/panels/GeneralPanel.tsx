/** General — high-level app info and the restore-defaults action. */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { Section, Field } from '../controls';

export function GeneralPanel() {
  const reset = useSettingsStore((s) => s.reset);
  const addToast = useUIStore((s) => s.addToast);
  const [confirming, setConfirming] = useState(false);

  const doReset = async () => {
    try {
      await reset();
      addToast({ title: 'Settings restored to defaults', tone: 'info' });
    } catch (err) {
      addToast({
        title: 'Could not reset settings',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Section
      title="General"
      hint="Limboo is local-first and private — the only network traffic is the coding agent talking to its provider."
    >
      <Field
        id="reset"
        label="Restore defaults"
        hint="Reset all global preferences (appearance, behavior) to their defaults. Per-workspace settings are unaffected."
      >
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void doReset()}
              className="rounded-md bg-danger px-2.5 py-1 text-[12px] font-medium text-base transition-opacity hover:opacity-90"
            >
              Confirm reset
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-fg"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-fg transition-colors hover:border-line-strong"
          >
            <RotateCcw size={13} />
            Reset…
          </button>
        )}
      </Field>
    </Section>
  );
}
