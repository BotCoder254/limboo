/**
 * Plan & Tasks settings — the governance surface for Plan Mode and the Task Panel.
 * Plan Mode is the review-first workflow: the agent analyzes the repository
 * read-only and proposes a plan you approve before any files change. These knobs
 * control the default permission mode, how the plan/outline is presented, how
 * execution is surfaced, and how planning history is retained.
 */
import type { SessionPermissionMode } from '@shared/types';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, SegmentedControl, Select, Toggle } from '../controls';

export function PlanTasksPanel() {
  const plan = useSettingsStore((s) => s.settings.agent.plan);
  const update = useSettingsStore((s) => s.update);

  const setPlan = <K extends keyof typeof plan>(key: K, value: (typeof plan)[K]) =>
    void update({ agent: { plan: { [key]: value } } });

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Plan Mode"
        hint="The review-first workflow — the agent analyzes read-only and proposes a plan you approve before any files change. bypassPermissions is never offered (safety-first)."
      >
        <Field
          id="planDefaultMode"
          label="Default permission mode"
          hint="What new sessions start in. Plan-first (default) is safest; Ask is read-only exploration; a workspace can override this under Settings › Workspace."
        >
          <SegmentedControl<SessionPermissionMode>
            value={plan.defaultMode}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'ask', label: 'Ask' },
              { value: 'default', label: 'Ask before edits' },
              { value: 'acceptEdits', label: 'Accept edits' },
            ]}
            onChange={(value) => setPlan('defaultMode', value)}
          />
        </Field>
        <Field
          id="planRequireSecondaryConfirm"
          label="Confirm before executing"
          hint="Require a second click when approving a plan before implementation begins. Default off."
        >
          <Toggle
            checked={plan.requireSecondaryConfirm}
            onChange={(v) => setPlan('requireSecondaryConfirm', v)}
          />
        </Field>
        <Field
          id="planSaveToMemory"
          label="Save completed plans to Memory"
          hint="Store each finished plan in the Local Memory system so its strategy is retrievable on future tasks. Default off."
        >
          <Toggle checked={plan.savePlansToMemory} onChange={(v) => setPlan('savePlansToMemory', v)} />
        </Field>
      </Section>

      <Section
        title="Task Panel"
        hint="How the derived plan outline is presented in the Tasks tab."
      >
        <Field
          id="planShowReasoning"
          label="Show plan reasoning"
          hint="Render the full implementation-plan markdown in the Tasks panel. Default on."
        >
          <Toggle checked={plan.showReasoning} onChange={(v) => setPlan('showReasoning', v)} />
        </Field>
        <Field
          id="planShowEstimates"
          label="Show plan metadata"
          hint="Show the affected-files / task-count / risk row above the plan. Default on."
        >
          <Toggle checked={plan.showEstimates} onChange={(v) => setPlan('showEstimates', v)} />
        </Field>
        <Field
          id="planHighlightRisk"
          label="Highlight risk"
          hint="Color the risk estimate (low / medium / high). Default on."
        >
          <Toggle checked={plan.highlightRisk} onChange={(v) => setPlan('highlightRisk', v)} />
        </Field>
        <Field
          id="planStreamIncrementally"
          label="Stream tasks as they appear"
          hint="Update the outline incrementally while the plan is built, rather than only when it completes. Default on."
        >
          <Toggle
            checked={plan.streamIncrementally}
            onChange={(v) => setPlan('streamIncrementally', v)}
          />
        </Field>
        <Field
          id="planAutoExpandTasks"
          label="Auto-expand new tasks"
          hint="Expand newly generated task groups automatically. Default on."
        >
          <Toggle checked={plan.autoExpandTasks} onChange={(v) => setPlan('autoExpandTasks', v)} />
        </Field>
        <Field
          id="planAutoCollapseCompleted"
          label="Collapse completed tasks"
          hint="Collapse tasks automatically as they complete during execution. Default off."
        >
          <Toggle
            checked={plan.autoCollapseCompleted}
            onChange={(v) => setPlan('autoCollapseCompleted', v)}
          />
        </Field>
        <Field
          id="planExportFormat"
          label="Plan export format"
          hint="Default format used by the plan Export action."
        >
          <SegmentedControl<typeof plan.defaultExportFormat>
            value={plan.defaultExportFormat}
            options={[
              { value: 'md', label: 'Markdown' },
              { value: 'txt', label: 'Text' },
              { value: 'pdf', label: 'PDF' },
            ]}
            onChange={(value) => setPlan('defaultExportFormat', value)}
          />
        </Field>
      </Section>

      <Section
        title="Execution"
        hint="How live progress is surfaced while a plan is implemented."
      >
        <Field
          id="planShowTaskDurations"
          label="Show task durations"
          hint="Display how long each task took once implementation completes. Default on."
        >
          <Toggle checked={plan.showTaskDurations} onChange={(v) => setPlan('showTaskDurations', v)} />
        </Field>
        <Field
          id="planShowCheckpoints"
          label="Show checkpoints on tasks"
          hint="Surface a Git-checkpoint hint next to tasks during execution. Default on."
        >
          <Toggle
            checked={plan.showCheckpointsOnTasks}
            onChange={(v) => setPlan('showCheckpointsOnTasks', v)}
          />
        </Field>
        <Field
          id="planAllowReorder"
          label="Allow manual reordering"
          hint="Let tasks be re-ordered after approval (best-effort UI). Default off."
        >
          <Toggle checked={plan.allowManualReorder} onChange={(v) => setPlan('allowManualReorder', v)} />
        </Field>
        <Field
          id="planNotifyPhase"
          label="Notify on phase completion"
          hint="Fire a desktop notification when a plan phase completes. Default off."
        >
          <Toggle
            checked={plan.notifyOnPhaseComplete}
            onChange={(v) => setPlan('notifyOnPhaseComplete', v)}
          />
        </Field>
        <Field
          id="planArchiveCompleted"
          label="Archive on completion"
          hint="Archive a plan automatically once its implementation completes. Default off."
        >
          <Toggle checked={plan.archiveCompleted} onChange={(v) => setPlan('archiveCompleted', v)} />
        </Field>
      </Section>

      <Section
        title="History"
        hint="Iterative planning keeps previous revisions so you can compare and restore across planning cycles."
      >
        <Field
          id="planRetainHistory"
          label="Keep plan revisions"
          hint="Snapshot the previous plan whenever it is regenerated or restored. Default on."
        >
          <Toggle checked={plan.retainPlanHistory} onChange={(v) => setPlan('retainPlanHistory', v)} />
        </Field>
        {plan.retainPlanHistory && (
          <Field
            id="planHistoryLimit"
            label="Revisions kept per session"
            hint="Older revisions beyond this count are pruned."
          >
            <Select<number>
              value={plan.historyLimit}
              options={[5, 10, 20, 50, 100].map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => setPlan('historyLimit', v)}
            />
          </Field>
        )}
      </Section>
    </div>
  );
}
