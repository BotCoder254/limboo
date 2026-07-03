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

      <Section
        title="Sync (push & pull)"
        hint="Limboo never stores remote credentials — push and pull use your existing git credential helper or SSH agent. If none is configured, the operation fails fast with a clear message."
      >
        <Field
          id="gitAutoSetUpstream"
          label="Publish new branches on first push"
          hint="Run push -u origin <branch> so a new branch starts tracking its remote automatically."
        >
          <Toggle
            checked={git.push.autoSetUpstream}
            onChange={(v) => void update({ git: { push: { autoSetUpstream: v } } })}
          />
        </Field>
        <Field
          id="gitConfirmForcePush"
          label="Confirm before force push"
          hint="Shift-click Push force-pushes with --force-with-lease; this asks first."
        >
          <Toggle
            checked={git.push.confirmForcePush}
            onChange={(v) => void update({ git: { push: { confirmForcePush: v } } })}
          />
        </Field>
        <Field
          id="gitPullStrategy"
          label="Pull strategy"
          hint="Fast-forward only keeps history linear; rebase replays your local commits on top of the remote."
        >
          <SegmentedControl<typeof git.pull.strategy>
            value={git.pull.strategy}
            options={[
              { value: 'ff-only', label: 'Fast-forward' },
              { value: 'rebase', label: 'Rebase' },
            ]}
            onChange={(v) => void update({ git: { pull: { strategy: v } } })}
          />
        </Field>
      </Section>

      <Section
        title="Worktrees"
        hint="A worktree-backed session gets its own isolated checkout + branch, so parallel sessions (and agents) never contend for one working tree. Worktrees live under a hashed per-repo folder inside the root below."
      >
        <Field
          id="gitWtEnabled"
          label="Enable worktree sessions"
          hint="Offer 'New session in worktree' and the worktree tab strip."
        >
          <Toggle
            checked={git.worktrees.enabled}
            onChange={(v) => void update({ git: { worktrees: { enabled: v } } })}
          />
        </Field>
        <StackedField
          id="gitWtRoot"
          label="Worktree root"
          hint="Absolute folder for worktree checkouts. Leave blank for the app data default. Tip: a short path (e.g. C:\\wt) leaves the most room for deep node_modules trees on Windows."
        >
          <TextInput
            value={git.worktrees.root}
            placeholder="App data default"
            onChange={(v) => void update({ git: { worktrees: { root: v } } })}
          />
        </StackedField>
        <StackedField
          id="gitWtBranchPrefix"
          label="Branch prefix"
          hint="Auto-generated worktree branches are named <prefix>/<slug>."
        >
          <TextInput
            value={git.worktrees.branchPrefix}
            placeholder="limboo"
            onChange={(v) => void update({ git: { worktrees: { branchPrefix: v } } })}
          />
        </StackedField>
        <Field
          id="gitWtAutoSetup"
          label="Run setup hooks after create"
          hint="Run the repo's limboo.json setup commands (install deps, copy .env, …) in a visible terminal when a worktree is created."
        >
          <Toggle
            checked={git.worktrees.autoSetup}
            onChange={(v) => void update({ git: { worktrees: { autoSetup: v } } })}
          />
        </Field>
        <Field
          id="gitWtConfirmHooks"
          label="Confirm hooks before running"
          hint="Show the exact commands and ask first. Repo-authored hooks always confirm on their first run in a workspace."
        >
          <Toggle
            checked={git.worktrees.confirmHooks}
            onChange={(v) => void update({ git: { worktrees: { confirmHooks: v } } })}
          />
        </Field>
        <Field
          id="gitWtTeardownOnArchive"
          label="Teardown on archive"
          hint="Archiving a worktree session runs teardown hooks and removes its directory; the branch and metadata are kept so restore can recreate it."
        >
          <Toggle
            checked={git.worktrees.teardownOnArchive}
            onChange={(v) => void update({ git: { worktrees: { teardownOnArchive: v } } })}
          />
        </Field>
      </Section>

      <Section
        title="Scripts & Services"
        hint="Supervised long-running processes (dev servers, workers) defined in the repo's limboo.json. Each service gets a loopback port from the range below; everything binds to 127.0.0.1 only."
      >
        <Field
          id="gitSvcPortRange"
          label="Service port range"
          hint="Ports auto-assigned to supervised services."
        >
          <div className="flex items-center gap-2">
            <TextInput
              value={String(git.services.portRangeStart)}
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n)) void update({ git: { services: { portRangeStart: n } } });
              }}
            />
            <span className="text-[12px] text-faint">–</span>
            <TextInput
              value={String(git.services.portRangeEnd)}
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n)) void update({ git: { services: { portRangeEnd: n } } });
              }}
            />
          </div>
        </Field>
        <Field
          id="gitSvcProxyEnabled"
          label="*.localhost reverse proxy"
          hint="Expose services as <service>--<slug>.localhost URLs through a loopback-only proxy (HTTP + WebSocket)."
        >
          <Toggle
            checked={git.services.proxyEnabled}
            onChange={(v) => void update({ git: { services: { proxyEnabled: v } } })}
          />
        </Field>
        <Field
          id="gitSvcProxyPort"
          label="Proxy port"
          hint="Loopback port the reverse proxy listens on."
        >
          <TextInput
            value={String(git.services.proxyPort)}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n)) void update({ git: { services: { proxyPort: n } } });
            }}
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
