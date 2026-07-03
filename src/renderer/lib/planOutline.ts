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
  /** How many live harness todos were matched onto outline tasks by
   *  {@link applyRuntime} — lets the panel detect a failed overlay and fall
   *  back to showing the raw checklist. */
  matched: number;
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
  return { phases, taskCount, completed: 0, matched: 0 };
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

/** Words too generic to signal that a todo and an outline task are the same. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'and', 'of', 'in', 'for', 'with', 'on',
  'fix', 'add', 'update', 'implement', 'create', 'make',
]);

/** Distinctive word tokens of a label (normalized, stopwords dropped). */
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}

/** Jaccard similarity between two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Minimum similarity for a todo↔task pairing to count as a match. */
const MATCH_THRESHOLD = 0.5;

/**
 * Overlay live execution status from the harness `TaskItem[]` onto a parsed
 * outline. The agent's TodoWrite labels rarely repeat the plan's bullet titles
 * verbatim, so exact/substring matching alone left the outline frozen while the
 * run completed. Matching is now a deterministic greedy best-match assignment:
 * exact/substring on the normalized labels scores 1, otherwise word-token
 * Jaccard overlap; pairs under {@link MATCH_THRESHOLD} are dropped, and each
 * todo/task participates in at most one pairing. `matched` reports how many
 * todos landed, so the panel can fall back to the flat checklist when the
 * overlay failed. Pure + deterministic — safe to run on every streamed delta.
 */
export function applyRuntime(outline: PlanOutline, runtime: OutlineRuntime): PlanOutline {
  const todos = (runtime.tasks ?? []).map((t, i) => ({
    index: i,
    n: norm(t.label),
    toks: tokens(t.label),
    status: (t.status ?? (t.done ? 'completed' : 'pending')) as TaskStatus,
  }));

  const flat: Array<{ task: OutlineTask; n: string; toks: Set<string> }> = [];
  for (const p of outline.phases) {
    for (const t of p.tasks) flat.push({ task: t, n: norm(t.title), toks: tokens(t.title) });
  }

  // Score every (todo, task) pair, keep the plausible ones, then assign
  // greedily by (score desc, todo index asc, task order asc) — deterministic.
  const pairs: Array<{ score: number; todo: number; taskIdx: number }> = [];
  for (const td of todos) {
    if (!td.n) continue;
    for (let i = 0; i < flat.length; i++) {
      const ot = flat[i];
      if (!ot.n) continue;
      const exact = td.n === ot.n || td.n.includes(ot.n) || ot.n.includes(td.n);
      const score = exact ? 1 : jaccard(td.toks, ot.toks);
      if (score >= MATCH_THRESHOLD) pairs.push({ score, todo: td.index, taskIdx: i });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.todo - b.todo ||
      flat[a.taskIdx].task.order - flat[b.taskIdx].task.order,
  );

  const statusByTaskId = new Map<string, TaskStatus>();
  const usedTodos = new Set<number>();
  const usedTasks = new Set<number>();
  for (const pair of pairs) {
    if (usedTodos.has(pair.todo) || usedTasks.has(pair.taskIdx)) continue;
    usedTodos.add(pair.todo);
    usedTasks.add(pair.taskIdx);
    statusByTaskId.set(flat[pair.taskIdx].task.id, todos[pair.todo].status);
  }

  let completed = 0;
  const phases = outline.phases.map((p) => ({
    ...p,
    tasks: p.tasks.map((t) => {
      const live = statusByTaskId.get(t.id);
      let status: TaskExecStatus =
        live === 'completed' ? 'completed' : live === 'in_progress' ? 'active' : 'pending';
      // Layer session-level signals onto the currently-active task only.
      if (status === 'active' && runtime.awaitingPermission) status = 'waiting';
      if (status === 'active' && runtime.failed) status = 'failed';
      if (status === 'completed') completed += 1;
      return { ...t, status };
    }),
  }));

  return { phases, taskCount: outline.taskCount, completed, matched: usedTodos.size };
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
