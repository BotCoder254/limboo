/**
 * Memory settings — the Local Memory System. Fully local (no network, no
 * embeddings API): retrieval is SQLite FTS5/BM25 fused with recency, confidence,
 * and usage. These knobs shape what is captured and how much is injected into the
 * agent prompt; the memory database itself lives under the app's user-data dir.
 */
import { MEMORY_LIMITS, RESUME_LIMITS, SEARCH_LIMITS, clamp } from '@shared/constants';
import { cn } from '@/renderer/lib/cn';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, SegmentedControl, Select, StackedField, Toggle } from '../controls';

/** Per-source toggles for Global Search (label + the settings key it flips). */
const SOURCE_CHIPS: { id: 'files' | 'symbols' | 'docs' | 'memory' | 'commits' | 'branches' | 'sessions'; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'docs', label: 'Docs' },
  { id: 'memory', label: 'Memory' },
  { id: 'commits', label: 'Commits' },
  { id: 'branches', label: 'Branches & tags' },
  { id: 'sessions', label: 'Sessions' },
];

export function MemoryPanel() {
  const memory = useSettingsStore((s) => s.settings.memory);
  const search = useSettingsStore((s) => s.settings.search);
  const resume = useSettingsStore((s) => s.settings.resume);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Resume"
        hint="When you reopen a session, Limboo revalidates the repository against the state it last saw and surfaces what changed — commits, files, symbols, and dependency manifests — so the agent continues against current reality, not remembered assumptions. Fully local, bounded git; never blocks switching."
      >
        <Field
          id="resumeEnabled"
          label="Repository revalidation on resume"
          hint="Compare the repo to the session's last snapshot on activation and show a delta when it diverged."
        >
          <Toggle checked={resume.enabled} onChange={(v) => void update({ resume: { enabled: v } })} />
        </Field>
        {resume.enabled && (
          <>
            <Field
              id="resumeInjectDelta"
              label="Inject repository delta into prompts"
              hint="Give the agent a one-shot summary of what changed before its next prompt."
            >
              <Toggle
                checked={resume.injectDelta}
                onChange={(v) => void update({ resume: { injectDelta: v } })}
              />
            </Field>
            <Field
              id="resumeMaxCommits"
              label="Max commits in delta"
              hint="How many commit subjects the delta lists (counts stay exact regardless)."
            >
              <Select<number>
                value={clamp(
                  resume.maxCommitsInDelta,
                  RESUME_LIMITS.maxCommitsInDelta.min,
                  RESUME_LIMITS.maxCommitsInDelta.max,
                )}
                options={[10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))}
                onChange={(v) => void update({ resume: { maxCommitsInDelta: v } })}
              />
            </Field>
            <Field
              id="resumeStaleDays"
              label="Skip revalidation newer than"
              hint="Skip the check for sessions touched within this window (0 = always revalidate)."
            >
              <Select<number>
                value={clamp(
                  resume.staleThresholdDays,
                  RESUME_LIMITS.staleThresholdDays.min,
                  RESUME_LIMITS.staleThresholdDays.max,
                )}
                options={[0, 1, 7, 30].map((n) => ({
                  value: n,
                  label: n === 0 ? 'Always' : `${n} day${n === 1 ? '' : 's'}`,
                }))}
                onChange={(v) => void update({ resume: { staleThresholdDays: v } })}
              />
            </Field>
          </>
        )}
      </Section>

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

      <Section
        title="Search"
        hint="The Search Engine indexes this workspace's files and symbols on-device and federates memory, git, and sessions behind one query interface (Cmd/Ctrl+P). Fully local — no network, no embeddings."
      >
        <Field
          id="searchEnabled"
          label="Enable search indexing"
          hint="Master switch for background indexing, Global Search, and context injection."
        >
          <Toggle checked={search.enabled} onChange={(v) => void update({ search: { enabled: v } })} />
        </Field>
        <Field
          id="searchIndexContents"
          label="Index file contents"
          hint="Full-text search + symbol extraction. When off, only file paths are indexed."
        >
          <Toggle
            checked={search.indexContents}
            onChange={(v) => void update({ search: { indexContents: v } })}
          />
        </Field>
        <Field
          id="searchMaxFileSize"
          label="Max indexed file size"
          hint="Files larger than this index their path only (contents skipped)."
        >
          <Select<number>
            value={clamp(search.maxFileSizeKb, SEARCH_LIMITS.maxIndexFileKb.min, SEARCH_LIMITS.maxIndexFileKb.max)}
            options={[128, 256, 512, 1024, 2048].map((n) => ({ value: n, label: `${n} KB` }))}
            onChange={(v) => void update({ search: { maxFileSizeKb: v } })}
          />
        </Field>
        <Field
          id="searchIncludeIgnored"
          label="Index ignored files"
          hint="Also index files matched by ignore rules (node_modules, build output). Larger index, slower."
        >
          <Toggle
            checked={search.includeIgnored}
            onChange={(v) => void update({ search: { includeIgnored: v } })}
          />
        </Field>
        <Field
          id="searchMaxResults"
          label="Results per source"
          hint="How many hits each source group shows in the Search UI."
        >
          <Select<number>
            value={clamp(search.maxResultsPerGroup, SEARCH_LIMITS.maxResultsPerGroup.min, SEARCH_LIMITS.maxResultsPerGroup.max)}
            options={[5, 8, 12, 20, 30].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => void update({ search: { maxResultsPerGroup: v } })}
          />
        </Field>
        <StackedField
          id="searchSources"
          label="Search sources"
          hint="Which subsystems Global Search includes. Turn off noisy sources to focus results — the index is untouched, so you can re-enable any time."
        >
          <div className="flex flex-wrap gap-1">
            {SOURCE_CHIPS.map((s) => {
              const on = search.sources?.[s.id] ?? true;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void update({ search: { sources: { [s.id]: !on } } })}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] transition-colors',
                    on ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted hover:text-fg',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </StackedField>
        <Field
          id="searchFuzzy"
          label="Fuzzy matching"
          hint="Typo-tolerant substring matching for symbols. Off = strict prefix matching only."
        >
          <Toggle checked={search.fuzzy} onChange={(v) => void update({ search: { fuzzy: v } })} />
        </Field>
        <Field
          id="searchHistoryLimit"
          label="Recent searches kept"
          hint="How many recent queries the search modal remembers per workspace."
        >
          <Select<number>
            value={clamp(search.historyLimit, SEARCH_LIMITS.historyLimit.min, SEARCH_LIMITS.historyLimit.max)}
            options={[5, 10, 25, 50].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => void update({ search: { historyLimit: v } })}
          />
        </Field>
      </Section>

      <Section
        title="Search bar"
        hint="The title-bar search box (VSCode-style) is the universal entry point. It opens a centered, real-time search modal over the whole workspace."
      >
        <Field
          id="searchLiveDelay"
          label="Live-search delay"
          hint="How quickly results refresh as you type. Instant is snappiest; Balanced spares large repositories."
        >
          <SegmentedControl<typeof search.liveDelay>
            value={search.liveDelay}
            options={[
              { value: 'instant', label: 'Instant' },
              { value: 'fast', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
            ]}
            onChange={(v) => void update({ search: { liveDelay: v } })}
          />
        </Field>
        <Field
          id="searchOpenOnClick"
          label="Open on click"
          hint="Click the title-bar box to open search. When off, the box is a hint and only the Cmd/Ctrl+P shortcut opens it."
        >
          <Toggle
            checked={search.openOnClick}
            onChange={(v) => void update({ search: { openOnClick: v } })}
          />
        </Field>
      </Section>

      <Section
        title="Search context for the agent"
        hint="Search is the primary context provider for the coding agent: it supplies ranked files and symbols before the agent explores with its own Read/Grep/Glob tools."
      >
        <Field
          id="searchInject"
          label="Inject context into agent prompts"
          hint="Prepend the most relevant files/symbols for each task to the agent's context."
        >
          <Toggle
            checked={search.injectContext}
            onChange={(v) => void update({ search: { injectContext: v } })}
          />
        </Field>
        {search.injectContext && (
          <Field
            id="searchMaxInjected"
            label="Max context items per prompt"
            hint="Higher supplies more locations but uses more of the prompt budget."
          >
            <Select<number>
              value={clamp(search.maxInjected, SEARCH_LIMITS.maxInjected.min, SEARCH_LIMITS.maxInjected.max)}
              options={[0, 4, 8, 10, 16, 24].map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => void update({ search: { maxInjected: v } })}
            />
          </Field>
        )}
      </Section>
    </div>
  );
}
