/**
 * A tiny deep-diff for settings. Returns the dot-notation leaf paths whose value
 * changed between a baseline snapshot and the current settings. Objects recurse;
 * scalars and arrays compare by value (arrays via shallow JSON, which is exact for
 * the primitive-only arrays settings use). Purely presentational — it drives the
 * "unsaved changes" confirm list; no state escapes.
 */
type Json = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equalLeaf(a: Json, b: Json): boolean {
  if (a === b) return true;
  // Arrays / mixed leaves: compare by stable serialization.
  return JSON.stringify(a) === JSON.stringify(b);
}

function walk(baseline: Json, current: Json, prefix: string, out: string[]): void {
  if (isPlainObject(baseline) && isPlainObject(current)) {
    const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    for (const key of keys) {
      walk(baseline[key], current[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (!equalLeaf(baseline, current)) out.push(prefix);
}

/** Changed leaf paths (dot notation) between two settings objects. */
export function diffSettings<T>(baseline: T, current: T): string[] {
  const out: string[] = [];
  walk(baseline, current, '', out);
  return out;
}

/**
 * Humanize a settings dot-path into a readable "Section › Field" label:
 * `agent.plan.defaultMode` → "Agent › Plan › Default Mode". Splits camelCase and
 * title-cases each segment. Keeps the layout key out (it's not user-facing here).
 */
export function humanizeSettingPath(path: string): string {
  return path
    .split('.')
    .map((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim(),
    )
    .join(' › ');
}
