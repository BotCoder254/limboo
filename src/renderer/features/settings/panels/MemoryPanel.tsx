/**
 * Memory settings — the Local Memory System. Fully local (no network, no
 * embeddings API): retrieval is SQLite FTS5/BM25 fused with recency, confidence,
 * and usage. These knobs shape what is captured and how much is injected into the
 * agent prompt; the memory database itself lives under the app's user-data dir.
 */
import { MEMORY_LIMITS, clamp } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, SegmentedControl, Select, Toggle } from '../controls';

export function MemoryPanel() {
  const memory = useSettingsStore((s) => s.settings.memory);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Memory"
        hint="A provider-independent knowledge base of your decisions, conventions, preferences, and reusable solutions — stored on-device and surfaced to the agent automatically."
      >
        <Field
          id="memoryEnabled"
          label="Enable memory"
          hint="Master switch for capture, retrieval, and the Memory panel."
        >
          <Toggle checked={memory.enabled} onChange={(v) => void update({ memory: { enabled: v } })} />
        </Field>
        <Field
          id="memoryInject"
          label="Inject into agent prompts"
          hint="Prepend the most relevant memories to the agent's context before each task."
        >
          <Toggle
            checked={memory.injectIntoPrompt}
            onChange={(v) => void update({ memory: { injectIntoPrompt: v } })}
          />
        </Field>
        <Field
          id="memoryMaxInjected"
          label="Max memories per prompt"
          hint="Higher recalls more context but uses more of the prompt budget."
        >
          <Select<number>
            value={clamp(memory.maxInjected, MEMORY_LIMITS.maxInjected.min, MEMORY_LIMITS.maxInjected.max)}
            options={[0, 4, 8, 12, 16, 24].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => void update({ memory: { maxInjected: v } })}
          />
        </Field>
      </Section>

      <Section
        title="Automatic capture"
        hint="How new memories are created from your work (commits, conversations). Manual notes are always allowed."
      >
        <Field
          id="memoryAutoCapture"
          label="Capture mode"
          hint="Propose surfaces suggestions to confirm; Auto stores high-confidence ones silently; Off keeps only manual notes."
        >
          <SegmentedControl<typeof memory.autoCapture>
            value={memory.autoCapture}
            options={[
              { value: 'propose', label: 'Propose' },
              { value: 'auto', label: 'Auto' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => void update({ memory: { autoCapture: v } })}
          />
        </Field>
        {memory.autoCapture === 'propose' && (
          <Field
            id="memoryAutoAccept"
            label="Auto-keep above confidence"
            hint="Proposals at or above this confidence are kept without asking (0% always asks)."
          >
            <Select<number>
              value={Math.round(memory.autoAcceptConfidence * 100)}
              options={[0, 80, 85, 90, 95].map((n) => ({ value: n, label: n === 0 ? 'Always ask' : `${n}%` }))}
              onChange={(v) => void update({ memory: { autoAcceptConfidence: v / 100 } })}
            />
          </Field>
        )}
      </Section>

      <Section
        title="Maintenance"
        hint="Keep the knowledge base healthy over time. Stale entries are flagged and ranked lower — never deleted automatically."
      >
        <Field
          id="memoryExpiryEnabled"
          label="Flag stale memories"
          hint="Decay unused, unpinned memories so newer knowledge surfaces first."
        >
          <Toggle
            checked={memory.expiry.enabled}
            onChange={(v) => void update({ memory: { expiry: { enabled: v } } })}
          />
        </Field>
        {memory.expiry.enabled && (
          <Field
            id="memoryStaleDays"
            label="Stale after"
            hint="Days of disuse before an unpinned memory is flagged stale."
          >
            <Select<number>
              value={clamp(memory.expiry.staleDays, MEMORY_LIMITS.staleDays.min, MEMORY_LIMITS.staleDays.max)}
              options={[30, 90, 180, 365, 730].map((n) => ({ value: n, label: `${n} days` }))}
              onChange={(v) => void update({ memory: { expiry: { staleDays: v } } })}
            />
          </Field>
        )}
      </Section>
    </div>
  );
}
