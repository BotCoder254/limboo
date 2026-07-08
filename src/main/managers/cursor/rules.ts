/**
 * Session-scoped generated context rule
 * (`<root>/.cursor/rules/limboo-context.mdc`).
 *
 * Cursor has no system-prompt preset-append switch, but the CLI auto-loads
 * rule files under `.cursor/rules` (and AGENTS.md / CLAUDE.md) as standing
 * instructions — the documented injection vehicle for Limboo's three context
 * producers (<project-memory> / <project-context> / <repository-delta>).
 * The rule is written fresh immediately before each run and removed/restored
 * in `finally`, so it never goes stale, never pollutes `git status` after the
 * run, and never leaks into commits. Rules survive multi-turn runs and are
 * visible/auditable on disk while the run executes.
 */
import { withSessionFile } from './sessionFile';

/** Render the MDC body: frontmatter + the composed context block. */
export function buildContextRule(contextBlock: string): string {
  return [
    '---',
    'description: Limboo session context (generated per run — do not edit)',
    'alwaysApply: true',
    '---',
    '',
    'The following project context is provided by Limboo, the orchestration',
    'platform running this agent. Treat it as background knowledge about the',
    'repository and prior sessions; verify against the working tree when acting.',
    '',
    contextBlock,
    '',
  ].join('\n');
}

/**
 * Materialize the context rule for the duration of `fn`, then restore/remove
 * it. `contextBlock: null` (nothing to inject) skips the write.
 */
export async function withSessionContextRule<T>(
  root: string,
  contextBlock: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  return withSessionFile(
    root,
    '.cursor/rules/limboo-context.mdc',
    () => (contextBlock ? buildContextRule(contextBlock) : null),
    fn,
  );
}
