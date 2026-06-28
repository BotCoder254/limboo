/**
 * Plan panel — the Task tab's rich view of Plan Mode. It visualizes the agent's
 * proposed implementation strategy and its live execution checklist:
 *
 *   • planning      → a "analyzing the repository" placeholder while the agent
 *                     reads (read-only); any early TodoWrite items stream in.
 *   • ready         → the rendered plan markdown + metadata + a toolbar, with
 *                     Approve & Execute / Reject / Regenerate controls. Nothing is
 *                     executed until the user approves.
 *   • implementing  → the live checklist ticks off as the agent works the plan.
 *   • completed     → the finished plan + its checklist, preserved for audit.
 *
 * Everything is driven by the active session's agent snapshot (plan + tasks); no
 * mock data. Theme tokens only — no new colors.
 */
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { PlanMeta, PlanStatus, SessionPlan, TaskItem } from '@shared/types';
import { EmptyState, IconButton, Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { Markdown } from '@/renderer/features/workspace/Markdown';

const STATUS_BADGE: Record<PlanStatus, { label: string; cls: string }> = {
  planning: { label: 'Planning', cls: 'text-accent' },
  ready: { label: 'Ready for review', cls: 'text-accent' },
  implementing: { label: 'Implementing', cls: 'text-warning' },
  completed: { label: 'Completed', cls: 'text-success' },
  rejected: { label: 'Rejected', cls: 'text-faint' },
};

const RISK_CLS: Record<NonNullable<PlanMeta['risk']>, string> = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-danger',
};

export function PlanPanel() {
  const sessionId = useSessionStore((s) => s.selectedId);
  const plan = useAgentStore((s) => (sessionId ? s.bySession[sessionId]?.plan : null)) ?? null;
  const tasks = useAgentStore((s) => (sessionId ? s.bySession[sessionId]?.tasks : undefined)) ?? [];

  // No plan and no checklist yet → the genuine empty state.
  if (!plan && tasks.length === 0) {
    return (
      <EmptyState
        compact
        icon={ClipboardList}
        title="No plan yet"
        description="Switch the composer to Plan and describe what to build. Claude Code analyzes the repository and proposes a reviewable strategy here before changing anything."
      />
    );
  }

  // A checklist with no plan (a direct Implement run using TodoWrite).
  if (!plan) {
    return (
      <div className="flex flex-col gap-3">
        <TaskChecklist tasks={tasks} />
      </div>
    );
  }

  return <PlanView sessionId={sessionId} plan={plan} tasks={tasks} />;
}

function PlanView({
  sessionId,
  plan,
  tasks,
}: {
  sessionId: string | null;
  plan: SessionPlan;
  tasks: TaskItem[];
}) {
  const settings = useSettingsStore((s) => s.settings.agent.plan);
  const approvePlan = useAgentStore((s) => s.approvePlan);
  const rejectPlan = useAgentStore((s) => s.rejectPlan);
  const regeneratePlan = useAgentStore((s) => s.regeneratePlan);
  const addToast = useUIStore((s) => s.addToast);

  const [raw, setRaw] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);

  // Collapse the plan body automatically once implementation starts so the live
  // checklist is what the eye lands on.
  useEffect(() => {
    if (plan.status === 'implementing') setBodyOpen(false);
  }, [plan.status]);

  const badge = STATUS_BADGE[plan.status];
  const planning = plan.status === 'planning';
  const ready = plan.status === 'ready';

  const copy = () => {
    void window.limboo?.system?.clipboardWrite(plan.markdown);
    addToast({ title: 'Plan copied', tone: 'success' });
  };

  const download = () => {
    const ext = settings.defaultExportFormat === 'txt' ? 'txt' : 'md';
    downloadText(`${slugify(plan.title)}.${ext}`, plan.markdown);
  };

  const onApprove = () => {
    if (!sessionId) return;
    if (settings.requireSecondaryConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    approvePlan(sessionId);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header + toolbar */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-fg" title={plan.title}>
            {plan.title}
          </p>
          <span className={cn('text-[11px] font-medium', badge.cls)}>
            {planning && <Loader2 size={10} className="mr-1 inline animate-spin" />}
            {badge.label}
          </span>
        </div>
        {!planning && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton size="sm" label="Copy plan as Markdown" onClick={copy}>
              <Copy size={13} />
            </IconButton>
            <IconButton size="sm" label="Download plan" onClick={download}>
              <Download size={13} />
            </IconButton>
            <IconButton
              size="sm"
              label={raw ? 'Show rendered plan' : 'Show raw Markdown'}
              active={raw}
              onClick={() => setRaw((v) => !v)}
            >
              <Code2 size={13} />
            </IconButton>
            <IconButton
              size="sm"
              label="Regenerate plan"
              onClick={() => sessionId && regeneratePlan(sessionId)}
            >
              <RefreshCw size={13} />
            </IconButton>
          </div>
        )}
      </div>

      {/* Metadata */}
      {settings.showEstimates && !planning && <PlanMetaRow meta={plan.meta} highlightRisk={settings.highlightRisk} />}

      {/* Planning placeholder */}
      {planning && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
          <Spinner size={12} />
          Analyzing the repository — reading files and dependencies (read-only)…
        </div>
      )}

      {/* Plan body (markdown) */}
      {!planning && plan.markdown && settings.showReasoning && (
        <div className="rounded-lg border border-line bg-surface-2/50">
          <button
            type="button"
            onClick={() => setBodyOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-faint transition-colors hover:text-muted"
          >
            {bodyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Implementation plan
          </button>
          {bodyOpen &&
            (raw ? (
              <pre className="max-h-[40vh] overflow-auto border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                {plan.markdown}
              </pre>
            ) : (
              <div className="border-t border-line px-3 py-2 text-[12.5px]">
                <Markdown text={plan.markdown} />
              </div>
            ))}
        </div>
      )}

      {/* Approval controls */}
      {ready && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5">
          <p className="text-[12px] text-muted">
            Review the plan above. Approving unlocks file changes and begins implementation against this
            checklist.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApprove}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
            >
              <CheckCircle2 size={13} />
              {confirming ? 'Confirm — start now' : 'Approve & Execute'}
            </button>
            <button
              type="button"
              onClick={() => sessionId && regeneratePlan(sessionId)}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-fg"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => sessionId && rejectPlan(sessionId)}
              className="ml-auto rounded-md px-2.5 py-1.5 text-[12px] text-faint transition-colors hover:text-danger"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Live checklist */}
      {tasks.length > 0 && <TaskChecklist tasks={tasks} />}
    </div>
  );
}

function PlanMetaRow({ meta, highlightRisk }: { meta: PlanMeta; highlightRisk: boolean }) {
  const chips: Array<{ label: string; cls?: string }> = [];
  if (meta.taskCount) chips.push({ label: `${meta.taskCount} task${meta.taskCount === 1 ? '' : 's'}` });
  if (meta.affectedFiles) chips.push({ label: `~${meta.affectedFiles} file${meta.affectedFiles === 1 ? '' : 's'}` });
  if (meta.risk) chips.push({ label: `${meta.risk} risk`, cls: highlightRisk ? RISK_CLS[meta.risk] : undefined });
  if (meta.frameworks && meta.frameworks.length > 0) chips.push({ label: meta.frameworks.slice(0, 3).join(', ') });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className={cn(
            'rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium',
            c.cls ?? 'text-muted',
          )}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function TaskChecklist({ tasks }: { tasks: TaskItem[] }) {
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-faint">
        <span>Checklist</span>
        <span>
          {done}/{tasks.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {tasks.map((task) => {
          const status = task.status ?? (task.done ? 'completed' : 'pending');
          return (
            <li key={task.id} className="flex items-start gap-2 rounded-md px-1 py-1">
              <TaskMark status={status} />
              <span
                className={cn(
                  'text-[12px] leading-snug',
                  status === 'completed' && 'text-faint line-through',
                  status === 'in_progress' && 'text-fg',
                  status === 'pending' && 'text-muted',
                )}
              >
                {task.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TaskMark({ status }: { status: NonNullable<TaskItem['status']> }) {
  if (status === 'in_progress') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <Spinner size={12} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
        status === 'completed'
          ? 'border-success bg-success/20 text-success'
          : 'border-line-strong text-transparent',
      )}
    >
      <CheckCircle2 size={10} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'plan'
  );
}

/** Trigger a client-side file download for the given text (no fs / IPC needed). */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
