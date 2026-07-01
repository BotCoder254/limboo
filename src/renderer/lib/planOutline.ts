/**
 * Plan outline parser — turns the agent's plan Markdown into the hierarchical
 * phase/task structure the Task Panel visualizes.
 *
 * The Claude Code harness only streams flat `TodoWrite` items (`{ content,
 * status }`); it does NOT emit phases, per-task files, or rationale. Rather than
 * invent that structure, we DERIVE it from the plan Markdown the agent already
 * writes: headings become phases, list items become tasks, indented lines and
 * following prose become notes, and path-like code spans become affected files.
 * Live execution status is then layered on by fuzzy-matching each derived task
 * against the harness `TaskItem[]`.
 *
 * Pure + dependency-free (renderer-side): the same Markdown always yields the
 * same outline, so it is safe to run on every streamed delta.
 */
import type { TaskItem, TaskStatus } from '@shared/types';

/** Execution status shown per task. Extends the harness statuses with derived ones. */
export type TaskExecStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'waiting' // a permission prompt is open on the active task
  | 'failed'; // the run errored while this task was active

export interface OutlineTask {
  id: string;
  title: string;
  /** Global 1-based execution order across all phases. */
  order: number;
  /** Indented bullet lines / following prose that elaborate the task. */
  notes: string[];
  /** Path-like references discovered in the task text (best-effort). */
  files: string[];
  status: TaskExecStatus;
}

export interface OutlinePhase {
  id: string;
  title: string;
  tasks: OutlineTask[];
}

export interface PlanOutline {
  phases: OutlinePhase[];
  taskCount: number;
  completed: number;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/;
// A code span that looks like a file path: has a slash or a dotted extension.
const PATH_IN_CODE = /`([^`]+)`/g;
const LOOKS_LIKE_PATH = /[\w.-]+\/[\w./-]+|[\w-]+\.[a-z]{1,5}\b/i;

/** Strip Markdown emphasis/links/code for a clean, comparable task title. */
function cleanInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract path-like code spans from a line. */
function filesIn(line: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PATH_IN_CODE.lastIndex = 0;
  while ((m = PATH_IN_CODE.exec(line))) {
    const inner = m[1].trim();
    if (LOOKS_LIKE_PATH.test(inner) && inner.length <= 120) out.push(inner);
  }
  return out;
}

/** Normalize a label for fuzzy matching (lowercase alphanumerics only). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Parse plan Markdown into phases + tasks. Fenced code blocks are skipped so a
 * `- item` inside a shell snippet is not mistaken for a task.
 */
export function parsePlanOutline(markdown: string): PlanOutline {
  const phases: OutlinePhase[] = [];
  let current: OutlinePhase | null = null;
  let lastTask: OutlineTask | null = null;
  let order = 0;
  let inFence = false;

  const ensurePhase = (): OutlinePhase => {
    if (!current) {
      current = { id: `phase_${phases.length}`, title: 'Plan', tasks: [] };
      phases.push(current);
    }
    return current;
  };

  const lines = markdown.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      const title = cleanInline(heading[2]);
      if (title) {
        current = { id: `phase_${phases.length}`, title, tasks: [] };
        phases.push(current);
        lastTask = null;
      }
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = item[1].replace(/\t/g, '  ').length;
      const text = item[2].trim();
      // Deeply-indented bullets elaborate the preceding task instead of becoming
      // their own row (keeps the tree shallow and readable).
      if (indent >= 2 && lastTask) {
        lastTask.notes.push(cleanInline(text));
        lastTask.files.push(...filesIn(text));
        continue;
      }
      const phase = ensurePhase();
      order += 1;
      lastTask = {
        id: `${phase.id}_task_${phase.tasks.length}`,
        title: cleanInline(text),
        order,
        notes: [],
        files: filesIn(text),
        status: 'pending',
      };
      phase.tasks.push(lastTask);
      continue;
    }

    // Prose directly under a task becomes a note; a blank line ends the run.
    const prose = line.trim();
    if (prose && lastTask && !HEADING.test(line)) {
      lastTask.notes.push(cleanInline(prose));
      lastTask.files.push(...filesIn(prose));
    } else if (!prose) {
      lastTask = null;
    }
  }

  // De-dup files per task.
  for (const p of phases) {
    for (const t of p.tasks) t.files = Array.from(new Set(t.files)).slice(0, 8);
  }

  const taskCount = phases.reduce((n, p) => n + p.tasks.length, 0);
  return { phases, taskCount, completed: 0 };
}

export interface OutlineRuntime {
  /** Live harness todos (drives per-task status). */
  tasks: TaskItem[];
  /** True while a permission prompt is open for this session. */
  awaitingPermission?: boolean;
  /** True if the last run for this session ended in error. */
  failed?: boolean;
  /** True while implementation is actively running. */
  running?: boolean;
}

const STATUS_RANK: Record<TaskStatus, number> = { pending: 0, in_progress: 1, completed: 2 };

/**
 * Overlay live execution status from the harness `TaskItem[]` onto a parsed
 * outline by fuzzy title match. When the outline can't be matched (no plan text),
 * callers fall back to rendering the flat checklist instead.
 */
export function applyRuntime(outline: PlanOutline, runtime: OutlineRuntime): PlanOutline {
  const todos = runtime.tasks ?? [];
  const normedTodos = todos.map((t) => ({ n: norm(t.label), status: t.status ?? (t.done ? 'completed' : 'pending') }));

  const match = (title: string): TaskStatus | undefined => {
    const n = norm(title);
    if (!n) return undefined;
    let best: { status: TaskStatus; rank: number } | undefined;
    for (const td of normedTodos) {
      if (!td.n) continue;
      if (td.n === n || td.n.includes(n) || n.includes(td.n)) {
        const rank = STATUS_RANK[td.status];
        if (!best || rank > best.rank) best = { status: td.status, rank };
      }
    }
    return best?.status;
  };

  let completed = 0;
  const phases = outline.phases.map((p) => ({
    ...p,
    tasks: p.tasks.map((t) => {
      const live = match(t.title);
      let status: TaskExecStatus =
        live === 'completed' ? 'completed' : live === 'in_progress' ? 'active' : 'pending';
      // Layer session-level signals onto the currently-active task only.
      if (status === 'active' && runtime.awaitingPermission) status = 'waiting';
      if (status === 'active' && runtime.failed) status = 'failed';
      if (status === 'completed') completed += 1;
      return { ...t, status };
    }),
  }));

  return { phases, taskCount: outline.taskCount, completed };
}

/** Serialize an outline to a stable JSON structure for the Export → JSON action. */
export function outlineToJson(outline: PlanOutline, title: string): string {
  return JSON.stringify(
    {
      title,
      taskCount: outline.taskCount,
      completed: outline.completed,
      phases: outline.phases.map((p) => ({
        title: p.title,
        tasks: p.tasks.map((t) => ({
          order: t.order,
          title: t.title,
          status: t.status,
          files: t.files,
          notes: t.notes,
        })),
      })),
    },
    null,
    2,
  );
}
