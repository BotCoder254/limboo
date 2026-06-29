/**
 * Git settings — local-only (no network, no tokens). Commit identity, message
 * defaults, checkpoint policy, branch-switch safety, and which git operations
 * require confirmation. All git runs argv-only and confined to the workspace repo.
 */
import { GIT_LIMITS, clamp } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, SegmentedControl, Select, StackedField, TextInput, Toggle } from '../controls';

export function GitPanel() {
  const git = useSettingsStore((s) => s.settings.git);
  const update = useSettingsStore((s) => s.update);

  const set = <K extends keyof typeof git>(key: K, value: (typeof git)[K]) =>
    void update({ git: { [key]: value } });

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Commit identity"
        hint="Used as the author of commits made from Limboo. Leave blank to inherit your global git config."
      >
        <StackedField id="gitUserName" label="Author name" hint="git config user.name override.">
          <TextInput
            value={git.userName}
            placeholder="Inherit from git config"
            onChange={(v) => set('userName', v)}
          />
        </StackedField>
        <StackedField id="gitUserEmail" label="Author email" hint="git config user.email override.">
          <TextInput
            value={git.userEmail}
            placeholder="Inherit from git config"
            onChange={(v) => set('userEmail', v)}
          />
        </StackedField>
      </Section>

      <Section title="Commits">
        <StackedField
          id="gitCommitTemplate"
          label="Commit message template"
          hint="Prefilled into the commit box. Leave blank for an empty message."
        >
          <TextInput
            value={git.commitMessageTemplate}
            placeholder="e.g. chore: "
            onChange={(v) => set('commitMessageTemplate', v)}
          />
        </StackedField>
        <Field
          id="gitSuggestCommit"
          label="Suggest message from conversation"
          hint="Offer a commit message derived from the session when committing agent work."
        >
          <Toggle
            checked={git.suggestCommitFromConversation}
            onChange={(v) => set('suggestCommitFromConversation', v)}
          />
        </Field>
      </Section>

      <Section
        title="Checkpoints"
        hint="Lightweight recovery points stored as dedicated git refs — never on a branch, never pushed, and invisible to normal git history."
      >
        <Field
          id="gitAutoCheckpoint"
          label="Auto-checkpoint before agent edits"
          hint="Snapshot the working tree before the agent's first write/command each run."
        >
          <Toggle checked={git.autoCheckpoint} onChange={(v) => set('autoCheckpoint', v)} />
        </Field>
        <Field
          id="gitMaxCheckpoints"
          label="Max checkpoints per session"
          hint="Older checkpoints beyond this are pruned automatically."
        >
          <Select<number>
            value={clamp(git.maxCheckpoints, GIT_LIMITS.maxCheckpoints.min, GIT_LIMITS.maxCheckpoints.max)}
            options={[10, 25, 50, 100, 200].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => set('maxCheckpoints', v)}
          />
        </Field>
      </Section>

      <Section title="Safety">
        <Field
          id="gitConfirmBranchSwitch"
          label="Confirm branch switch with changes"
          hint="Warn (and offer a checkpoint) before switching branches with a dirty working tree."
        >
          <Toggle
            checked={git.confirmBranchSwitchWithChanges}
            onChange={(v) => set('confirmBranchSwitchWithChanges', v)}
          />
        </Field>
        <Field
          id="gitCommandApproval"
          label="Require approval for"
          hint="Which git operations need explicit confirmation in the UI."
        >
          <SegmentedControl<typeof git.commandApproval>
            value={git.commandApproval}
            options={[
              { value: 'destructive', label: 'Destructive' },
              { value: 'all', label: 'All' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(v) => set('commandApproval', v)}
          />
        </Field>
      </Section>
    </div>
  );
}
