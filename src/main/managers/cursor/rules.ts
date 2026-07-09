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
import type { SessionPermissionMode } from '@shared/types';

import { withSessionFile } from './sessionFile';

/**
 * Per-run execution-posture note. Print mode gives the model no signal about
 * whether its tools actually execute — a propose-only run looks identical to
 * an applying one from the inside, and models misattribute blocked shells to
 * "plan mode" or a sandbox. Stating the posture up front stops that: the
 * model attempts mutations normally (so they surface as proposals) and keeps
 * using the allowed read-only inspection commands.
 */
export function executionPostureNote(mode: SessionPermissionMode, force: boolean): string {
  if (mode === 'ask') {
    return 'Execution posture for this run: read-only Q&A. Answer from the repository without modifying it.';
  }
  if (mode === 'plan') {
    return 'Execution posture for this run: planning. Design the approach; read-only inspection commands (git status/log/diff/show, ls, cat, rg) are available, but do not modify the repository.';
  }
  if (!force) {
    return [
      'Execution posture for this run: propose-only. You are NOT in plan mode.',
      'Read-only inspection commands (git status/log/diff/show, gh ... list/view, ls, cat, rg) are allowed and execute immediately.',
      'File edits and mutating shell commands are recorded as proposals and presented to the user for one-click approval — attempt them normally and describe what you changed; never claim that plan mode or a sandbox is blocking you.',
    ].join(' ');
  }
  return 'Execution posture for this run: apply. Your file edits and shell commands run directly against the working tree; destructive commands and Limboo’s own data are denied by policy.';
}

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
