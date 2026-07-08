/**
 * Plan panel — the Task tab's rich view of Plan Mode. It is the orchestration
 * surface for the whole Explore → Plan → Approve → Execute lifecycle:
 *
 *   • planning      → "analyzing the repository" placeholder while the agent reads
 *                     (read-only); the derived outline streams in as the plan grows.
 *   • ready         → the rendered plan + a hierarchical, expandable task outline +
 *                     a toolbar and an approval menu. Nothing runs until approved.
 *   • implementing  → the outline becomes a live execution dashboard: tasks tick
 *                     through pending → active → completed, with waiting/failed
 *                     states derived from the run.
 *   • completed     → the finished plan + outline, preserved for audit.
 *
 * The hierarchy (phases + per-task files/notes) is DERIVED from the plan Markdown
 * — the harness only streams flat TodoWrite items — via {@link parsePlanOutline}
 * and cross-referenced with live task status via {@link applyRuntime}. Everything
 * is driven by the active session's agent snapshot; no mock data. Theme tokens
 * only — no new colors.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  FileDown,
  FileText,
  Filter,
  History,
  Loader2,
  ListChecks,
  Pin,
  PinOff,
  Printer,
  RefreshCw,
  Rows3,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type {
  PlanMeta,
  PlanRevision,
  PlanStatus,
  SessionPermissionMode,
  SessionPlan,
  TaskItem,
} from '@shared/types';
import { EmptyState, IconButton, Spinner, SuccessCheck } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import {
  applyRuntime,
  outlineToJson,
  parsePlanOutline,
  type OutlinePhase,
  type OutlineTask,
  type TaskExecStatus,
} from '@/renderer/lib/planOutline';
import { RUNNING_PHASES } from '@/renderer/features/sessions/useSessionRunning';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { Markdown } from '@/renderer/features/workspace/Markdown';

const STATUS_BADGE: Record<PlanStatus, { label: string; cls: string }> = {
  planning: { label: 'Planning', cls: 'text-accent' },
  ready: { label: 'Ready for approval', cls: 'text-accent' },
  implementing: { label: 'Active execution', cls: 'text-warning' },
  completed: { label: 'Completed', cls: 'text-success' },
  rejected: { label: 'Rejected', cls: 'text-faint' },
};

const RISK_CLS: Record<NonNullable<PlanMeta['risk']>, string> = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-danger',
};

type TaskFilter = 'all' | 'pending' | 'done';

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
        description="Switch the composer to Plan and describe what to build. The agent analyzes the repository and proposes a reviewable strategy here before changing anything."
      />
    );
  }

  // A checklist with no plan (a direct execution run using TodoWrite).
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
  const setPlanPinned = useAgentStore((s) => s.setPlanPinned);
  const addToast = useUIStore((s) => s.addToast);

  // Run signals used to derive live per-task execution states.
  const awaitingPermission = useAgentStore((s) => (sessionId ? !!s.pendingBySession[sessionId] : false));
  const request = useAgentStore((s) => (sessionId ? s.requestsBySession[sessionId] : undefined));
  const running = !!request && RUNNING_PHASES.has(request.phase);
  const failed = request?.outcome === 'failed' || request?.outcome === 'tool-rejected';

  const [raw, setRaw] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  // Collapse the plan body automatically once implementation starts so the live
  // outline is what the eye lands on.
  useEffect(() => {
    if (plan.status === 'implementing') setBodyOpen(false);
  }, [plan.status]);

  const planning = plan.status === 'planning';
  const ready = plan.status === 'ready';
  const badge = STATUS_BADGE[plan.status];

  // Derive the phase/task outline from the plan Markdown and overlay live status.
  const outline = useMemo(() => {
    const parsed = parsePlanOutline(plan.markdown);
    return applyRuntime(parsed, { tasks, awaitingPermission, failed, running });
  }, [plan.markdown, tasks, awaitingPermission, failed, running]);

  const hasOutline = outline.taskCount > 0;

  // Real-time headline tally, computed straight from the live TodoWrite list so it
  // advances even when the fuzzy outline↔todo match fails (which otherwise froze
  // the count at 0). Falls back to the outline only when no todos have streamed.
  const live = useMemo(() => {
    let completed = 0;
    let active = 0;
    for (const t of tasks) {
      if (t.done || t.status === 'completed') completed += 1;
      else if (t.status === 'in_progress') active += 1;
    }
    return { completed, active, total: tasks.length };
  }, [tasks]);
  const progress =
    live.total > 0
      ? { completed: live.completed, total: live.total, active: live.active }
      : { completed: outline.completed, total: outline.taskCount, active: 0 };
  const hasProgress = progress.total > 0;

  const copy = () => {
    void window.limboo?.system?.clipboardWrite(plan.markdown);
    addToast({ title: 'Plan copied', tone: 'success' });
  };
  const exportMarkdown = () => downloadText(`${slugify(plan.title)}.md`, plan.markdown);
  const exportJson = () =>
    downloadText(`${slugify(plan.title)}.json`, outlineToJson(outline, plan.title));
  const print = () => printPlan(plan.title, plan.markdown);
  const togglePin = () => {
    if (sessionId) setPlanPinned(sessionId, !plan.pinned);
  };
  const setAllCollapsed = (value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const p of outline.phases) next[p.id] = value;
    setCollapsed(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header + toolbar */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-fg" title={plan.title}>
            {plan.pinned && <Pin size={11} className="shrink-0 text-accent" />}
            {plan.title}
          </p>
          <span className={cn('text-[11px] font-medium', badge.cls)}>
            {(planning || progress.active > 0) && (
              <Loader2 size={10} className="mr-1 inline animate-spin" />
            )}
            {badge.label}
            {hasProgress && ` · ${progress.completed}/${progress.total}`}
            {progress.active > 0 && (
              <span className="ml-1 text-accent">· {progress.active} running</span>
            )}
          </span>
        </div>
        {!planning && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
            <IconButton size="sm" label="Copy plan as Markdown" onClick={copy}>
              <Copy size={13} />
            </IconButton>
            <IconButton size="sm" label="Export as Markdown" onClick={exportMarkdown}>
              <FileText size={13} />
            </IconButton>
            <IconButton size="sm" label="Export outline as JSON" onClick={exportJson}>
              <FileDown size={13} />
            </IconButton>
            <IconButton size="sm" label="Print plan" onClick={print}>
              <Printer size={13} />
            </IconButton>
            <IconButton
              size="sm"
              label="Search tasks"
              active={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={13} />
            </IconButton>
            <IconButton
              size="sm"
              label={`Filter: ${filter}`}
              active={filter !== 'all'}
              onClick={() => setFilter((f) => (f === 'all' ? 'pending' : f === 'pending' ? 'done' : 'all'))}
            >
              <Filter size={13} />
            </IconButton>
            <IconButton size="sm" label="Collapse all phases" onClick={() => setAllCollapsed(true)}>
              <Rows3 size={13} />
            </IconButton>
            <IconButton
              size="sm"
              label={raw ? 'Show rendered plan' : 'Show raw Markdown'}
              active={raw}
              onClick={() => setRaw((v) => !v)}
            >
              <Code2 size={13} />
            </IconButton>
            <IconButton size="sm" label={plan.pinned ? 'Unpin plan' : 'Pin plan'} active={plan.pinned} onClick={togglePin}>
              {plan.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </IconButton>
            <IconButton size="sm" label="History" active={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              <History size={13} />
            </IconButton>
            <IconButton size="sm" label="Regenerate plan" onClick={() => sessionId && regeneratePlan(sessionId)}>
              <RefreshCw size={13} />
            </IconButton>
          </div>
        )}
      </div>

      {searchOpen && (
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter tasks…"
          className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
      )}

      {/* Metadata */}
      {settings.showEstimates && !planning && (
        <PlanMetaRow meta={plan.meta} highlightRisk={settings.highlightRisk} />
      )}

      {/* Planning placeholder */}
      {planning && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
          <Spinner size={12} />
          Analyzing the repository — reading files and dependencies (read-only)…
        </div>
      )}

      {/* Plan body (markdown) */}
      {!planning && plan.markdown && settings.showReasoning && (
        <div className="rounded-md border border-line bg-surface-2/50">
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
        <ApprovalControls
          settings={settings}
          onApprove={(mode) => sessionId && approvePlan(sessionId, mode)}
          onRegenerate={() => sessionId && regeneratePlan(sessionId)}
          onReject={() => sessionId && rejectPlan(sessionId)}
        />
      )}

      {/* Prominent completion banner — a large self-drawing checkmark when the
          whole plan run has finished, so "execution is done" is impossible to miss. */}
      {plan.status === 'completed' && (
        <div className="flex items-center gap-3 rounded-md border border-success/40 bg-success/10 px-3 py-3">
          <SuccessCheck size={44} className="shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold text-success">Execution complete</span>
            <span className="text-[11px] text-muted">
              {hasProgress
                ? `All ${progress.total} task${progress.total === 1 ? '' : 's'} finished.`
                : 'The agent finished this plan.'}
            </span>
          </div>
        </div>
      )}

      {/* Task outline (or the flat checklist fallback) */}
      {hasOutline ? (
        <OutlineTree
          phases={outline.phases}
          collapsed={collapsed}
          onToggle={(id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
          search={search}
          filter={filter}
          showDurations={settings.showTaskDurations}
          onJump={(tab) => useLayoutStore.getState().setActiveTab(tab)}
        />
      ) : (
        tasks.length > 0 && <TaskChecklist tasks={tasks} />
      )}

      {/* The fuzzy overlay can fail when the agent's TodoWrite labels don't
          resemble the plan bullets — if fewer than half the live todos matched
          the outline, ALSO show the raw checklist so live progress is never
          invisible while (or after) the run executes. */}
      {hasOutline &&
        tasks.length > 0 &&
        (plan.status === 'implementing' || plan.status === 'completed') &&
        outline.matched < Math.ceil(tasks.length / 2) && (
          <TaskChecklist tasks={tasks} title="Live progress" />
        )}

      {/* Revision history */}
      {historyOpen && sessionId && <HistorySection sessionId={sessionId} plan={plan} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Approval                                                            */
/* ------------------------------------------------------------------ */

function ApprovalControls({
  settings,
  onApprove,
  onRegenerate,
  onReject,
}: {
  settings: { requireSecondaryConfirm: boolean };
  onApprove: (mode: SessionPermissionMode) => void;
  onRegenerate: () => void;
  onReject: () => void;
}) {
  const [confirming, setConfirming] = useState<SessionPermissionMode | null>(null);

  const approve = (mode: SessionPermissionMode) => {
    if (settings.requireSecondaryConfirm && confirming !== mode) {
      setConfirming(mode);
      return;
    }
    setConfirming(null);
    onApprove(mode);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
      <p className="text-[12px] text-muted">
        Review the plan above. Approving exits Plan Mode and begins implementation against this
        outline — choose how much to review as it works.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => approve('default')}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
        >
          <CheckCircle2 size={13} />
          {confirming === 'default' ? 'Confirm — start now' : 'Approve & ask before edits'}
        </button>
        <button
          type="button"
          onClick={() => approve('acceptEdits')}
          className="rounded-md border border-accent/50 bg-accent/15 px-2.5 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/25"
        >
          {confirming === 'acceptEdits' ? 'Confirm — accept edits' : 'Approve & accept edits'}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-fg"
        >
          Keep planning
        </button>
        <button
          type="button"
          onClick={onReject}
          className="ml-auto rounded-md px-2.5 py-1.5 text-[12px] text-faint transition-colors hover:text-danger"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Outline tree                                                        */
/* ------------------------------------------------------------------ */

const ACTIVE_STATES = new Set<TaskExecStatus>(['active', 'waiting', 'failed']);

function OutlineTree({
  phases,
  collapsed,
  onToggle,
  search,
  filter,
  showDurations,
  onJump,
}: {
  phases: OutlinePhase[];
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  search: string;
  filter: TaskFilter;
  showDurations: boolean;
  onJump: (tab: 'changes' | 'terminal' | 'activity') => void;
}) {
  const q = search.trim().toLowerCase();
  const matches = (t: OutlineTask): boolean => {
    if (filter === 'pending' && t.status === 'completed') return false;
    if (filter === 'done' && t.status !== 'completed') return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.notes.some((n) => n.toLowerCase().includes(q))) {
      return false;
    }
    return true;
  };

  const visible = phases
    .map((p) => ({ ...p, tasks: p.tasks.filter(matches) }))
    .filter((p) => p.tasks.length > 0);

  if (visible.length === 0) {
    return <p className="px-1 py-2 text-[12px] text-faint">No tasks match the current filter.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((phase) => {
        const done = phase.tasks.filter((t) => t.status === 'completed').length;
        const isCollapsed = collapsed[phase.id];
        return (
          <div key={phase.id} className="rounded-md border border-line bg-surface-2/40">
            <button
              type="button"
              onClick={() => onToggle(phase.id)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
            >
              {isCollapsed ? (
                <ChevronRight size={12} className="text-faint" />
              ) : (
                <ChevronDown size={12} className="text-faint" />
              )}
              <ListChecks size={12} className="text-muted" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">
                {phase.title}
              </span>
              <span className="shrink-0 text-[10.5px] font-medium text-faint">
                {done}/{phase.tasks.length}
              </span>
            </button>
            {!isCollapsed && (
              <ul className="flex flex-col gap-0.5 border-t border-line px-1.5 py-1">
                {phase.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} showDurations={showDurations} onJump={onJump} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

const EXEC_LABEL: Record<TaskExecStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Completed',
  waiting: 'Waiting for approval',
  failed: 'Failed',
};

function TaskRow({
  task,
  showDurations,
  onJump,
}: {
  task: OutlineTask;
  showDurations: boolean;
  onJump: (tab: 'changes' | 'terminal' | 'activity') => void;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = task.notes.length > 0 || task.files.length > 0;
  return (
    <li className="rounded-md">
      <div className="flex items-start gap-2 px-1 py-1">
        <ExecMark status={task.status} />
        <button
          type="button"
          onClick={() => hasDetail && setOpen((v) => !v)}
          className={cn(
            'min-w-0 flex-1 text-left text-[12px] leading-snug',
            task.status === 'completed' && 'text-faint line-through',
            task.status === 'active' && 'text-fg',
            task.status === 'waiting' && 'text-warning',
            task.status === 'failed' && 'text-danger',
            task.status === 'pending' && 'text-muted',
          )}
        >
          <span className="mr-1 text-faint">{task.order}.</span>
          {task.title}
          {ACTIVE_STATES.has(task.status) && (
            <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
              {EXEC_LABEL[task.status]}
            </span>
          )}
        </button>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 shrink-0 text-faint transition-colors hover:text-muted"
            aria-label={open ? 'Collapse task' : 'Expand task'}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {open && hasDetail && (
        <div className="ml-6 flex flex-col gap-1.5 pb-1.5 pr-1">
          {task.notes.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {task.notes.map((n, i) => (
                <li key={i} className="text-[11.5px] leading-snug text-muted">
                  · {n}
                </li>
              ))}
            </ul>
          )}
          {task.files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {task.files.map((f) => (
                <span
                  key={f}
                  className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                  title={f}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-[10.5px]">
            <button type="button" onClick={() => onJump('changes')} className="text-accent hover:underline">
              Jump to changes
            </button>
            <button type="button" onClick={() => onJump('terminal')} className="text-accent hover:underline">
              Terminal
            </button>
            <button type="button" onClick={() => onJump('activity')} className="text-accent hover:underline">
              Activity
            </button>
            {showDurations && task.status === 'completed' && (
              <span className="ml-auto text-faint">done</span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ExecMark({ status }: { status: TaskExecStatus }) {
  if (status === 'active' || status === 'waiting') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <Spinner size={12} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-danger">
        <TriangleAlert size={12} />
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
/* Revision history                                                    */
/* ------------------------------------------------------------------ */

function HistorySection({ sessionId, plan }: { sessionId: string; plan: SessionPlan }) {
  const listPlanRevisions = useAgentStore((s) => s.listPlanRevisions);
  const restorePlanRevision = useAgentStore((s) => s.restorePlanRevision);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [compareId, setCompareId] = useState<string | null>(null);

  // Reload whenever the current plan changes (a new revision may have landed).
  useEffect(() => {
    let alive = true;
    void listPlanRevisions(sessionId).then((r) => {
      if (alive) setRevisions(r);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, listPlanRevisions, plan.markdown]);

  if (revisions.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface-2/40 px-3 py-2 text-[11.5px] text-faint">
        No earlier revisions yet. Regenerating the plan keeps the previous version here for
        comparison.
      </div>
    );
  }

  const compare = compareId ? revisions.find((r) => r.id === compareId) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Plan history</div>
      <ul className="flex flex-col gap-1">
        {revisions.map((rev) => {
          const diff = diffLines(plan.markdown, rev.markdown);
          return (
            <li key={rev.id} className="rounded-md border border-line bg-surface-2/40 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  r{rev.rev}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={rev.title}>
                  {rev.title}
                </span>
                <span className="shrink-0 text-[10px] text-faint">
                  <span className="text-success">+{diff.added}</span>{' '}
                  <span className="text-danger">-{diff.removed}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px]">
                <button
                  type="button"
                  onClick={() => setCompareId((c) => (c === rev.id ? null : rev.id))}
                  className="text-accent hover:underline"
                >
                  {compareId === rev.id ? 'Hide' : 'Compare'}
                </button>
                <button
                  type="button"
                  onClick={() => restorePlanRevision(sessionId, rev.id)}
                  className="text-muted hover:text-fg"
                >
                  Restore
                </button>
                <span className="ml-auto text-faint">{formatTime(rev.createdAt)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {compare && (
        <pre className="max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          {compare.markdown}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function PlanMetaRow({ meta, highlightRisk }: { meta: PlanMeta; highlightRisk: boolean }) {
  const chips: Array<{ label: string; cls?: string }> = [];
  if (meta.taskCount) chips.push({ label: `${meta.taskCount} task${meta.taskCount === 1 ? '' : 's'}` });
  if (meta.affectedFiles)
    chips.push({ label: `~${meta.affectedFiles} file${meta.affectedFiles === 1 ? '' : 's'}` });
  if (meta.risk) chips.push({ label: `${meta.risk} risk`, cls: highlightRisk ? RISK_CLS[meta.risk] : undefined });
  if (meta.frameworks && meta.frameworks.length > 0)
    chips.push({ label: meta.frameworks.slice(0, 3).join(', ') });
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

function TaskChecklist({ tasks, title = 'Checklist' }: { tasks: TaskItem[]; title?: string }) {
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-faint">
        <span>{title}</span>
        <span>
          {done}/{tasks.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {tasks.map((task) => {
          const status = task.status ?? (task.done ? 'completed' : 'pending');
          return (
            <li key={task.id} className="flex items-start gap-2 rounded-md px-1 py-1">
              <ExecMark status={status === 'in_progress' ? 'active' : status} />
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

/**
 * Print just the plan via an offscreen iframe. A new BrowserWindow is denied by
 * the app's window-open handler, so we print the iframe's own document instead of
 * the whole shell. The raw Markdown is shown in a readable monospace block.
 */
function printPlan(title: string, markdown: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  doc.open();
  doc.write(
    `<html><head><title>${esc(title)}</title><style>` +
      'body{font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:24px}' +
      'h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;word-wrap:break-word;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace}' +
      `</style></head><body><h1>${esc(title)}</h1><pre>${esc(markdown)}</pre></body></html>`,
  );
  doc.close();
  const win = iframe.contentWindow;
  if (win) {
    win.focus();
    win.print();
  }
  // Give the print dialog time to read the document before tearing it down.
  window.setTimeout(() => iframe.remove(), 1000);
}

/** Naive line set-diff for a compact +added / -removed history summary. */
function diffLines(current: string, revision: string): { added: number; removed: number } {
  const cur = new Set(current.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const rev = new Set(revision.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const l of cur) if (!rev.has(l)) added += 1;
  for (const l of rev) if (!cur.has(l)) removed += 1;
  return { added, removed };
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
