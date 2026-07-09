/**
 * Session-scoped Cursor permission config (`<root>/.cursor/cli.json`).
 *
 * Cursor's declarative permission system is the INVERSE of Claude's callback
 * one: allow/deny rule lists, deny beats allow, and in print mode `--force`
 * allows everything not explicitly denied. Limboo therefore materializes a
 * deny-first cli.json for EVERY run (the app-data guard applies even to
 * propose-only runs) and translates the user's standing posture into allow
 * rules; `--force` is only ever issued together with this rule set. The file
 * is written just for the run and the pre-run bytes are restored in `finally`
 * (see sessionFile.ts). Self-deny rules prevent the agent from editing its
 * own gates (cli.json / hooks.json / mcp.json) mid-run.
 */
import { readOnlyShellRuleSpecs } from '../agent/readOnlyCommands';
import { copySafeKeys, safeParseObject, withSessionFile } from './sessionFile';

/** Escape glob-special characters in a literal path used inside a rule. */
function globEscape(p: string): string {
  return p.replace(/\\/g, '/').replace(/([*?[\]{}])/g, '\\$1');
}

/**
 * The minimal deny-first rule set for any Cursor run. Mirrors the app-data
 * guard the Claude path enforces in canUseTool (touchesAppData) plus
 * repo-integrity, self-gate, and destructive-shell basics.
 */
export function sessionDenyRules(userDataPath: string): string[] {
  const userData = globEscape(userDataPath);
  return [
    // Repo integrity: never let a force run rewrite git internals or its own gates.
    'Write(.git/**)',
    'Write(**/.git/**)',
    'Write(**/.cursor/cli.json)',
    'Write(**/.cursor/hooks.json)',
    'Write(**/.cursor/mcp.json)',
    // Limboo's reserved workspace namespace (per-run attachment staging).
    'Write(.limboo/**)',
    'Write(**/.limboo/**)',
    // App data: Limboo's own database/settings/secrets are never a tool target.
    `Read(${userData}/**)`,
    `Write(${userData}/**)`,
    // Destructive-shell basics (deny-first; everything else rides --force).
    'Shell(rm)',
    'Shell(rmdir)',
    'Shell(del)',
    'Shell(rd)',
    'Shell(format)',
    'Shell(mkfs)',
    'Shell(taskkill)',
    'Shell(shutdown)',
    'Shell(sudo)',
    // Flag-level closes for the read-only Shell allow rules below (deny beats
    // allow): these flags turn inspection commands into writes/exec —
    // `git log --output=<file>` writes, `git grep --open-files-in-pager` and
    // `--upload-pack`/`--receive-pack` execute programs, rg `--pre` runs an
    // arbitrary preprocessor.
    'Shell(git:*--output*)',
    'Shell(git:*--open-files-in-pager*)',
    'Shell(git:*--upload-pack*)',
    'Shell(git:*--receive-pack*)',
    'Shell(rg:*--pre*)',
    'Shell(rg:*--hostname-bin*)',
    'Shell(gh:*--web*)',
  ];
}

/** What the standing posture auto-approves, translated to allow rules. */
export interface CursorAllowPosture {
  /** settings.agent.autoApproveReads under a mode that honors it. */
  autoApproveReads: boolean;
  /** The Limboo MCP bridge servers are registered for this run. */
  limbooMcp: boolean;
  /** Attachments are staged into the workspace for this run — allow reads. */
  attachmentsStaged?: boolean;
}

/**
 * Read-only inspection commands as declarative allow rules, derived from the
 * SAME allowlists `decideToolUse` trusts (readOnlyCommands.ts) so the two
 * layers never drift. Emits exact + space-suffixed pairs (`Shell(git:log)` +
 * `Shell(git:log *)`) rather than bare prefix globs — `Shell(git:diff*)`
 * would also match `git difftool`, which executes external programs. This is
 * what lets a propose-only (no `--force`) run still answer "what changed?"
 * from live `git log`/`gh pr list` instead of stalling on every shell call.
 */
export function readOnlyShellAllowRules(): string[] {
  const specs = readOnlyShellRuleSpecs();
  const rules: string[] = [];
  for (const sub of specs.gitAnyArgs) rules.push(`Shell(git:${sub})`, `Shell(git:${sub} *)`);
  for (const form of specs.gitExact) rules.push(`Shell(git:${form})`);
  for (const form of specs.ghAnyArgs) rules.push(`Shell(gh:${form})`, `Shell(gh:${form} *)`);
  for (const form of specs.ghExact) rules.push(`Shell(gh:${form})`);
  for (const cmd of specs.bare) rules.push(`Shell(${cmd})`);
  return rules;
}

/**
 * Allow rules derived from Limboo's posture (design doc §7). Deny always
 * supersedes allow, so these only ever short-circuit prompts Cursor would
 * otherwise raise — they can never widen past the deny set above.
 */
export function sessionAllowRules(posture: CursorAllowPosture): string[] {
  const rules: string[] = [];
  if (posture.autoApproveReads) {
    rules.push('Read(**)');
    // Same trust boundary as Read(**): provably read-only inspection shells.
    // Plan/ask runs keep these too — the provider already enforces read-only
    // there, and Claude plan mode can run `git log` via the classifier
    // relaxation, so this is parity, not a widening.
    rules.push(...readOnlyShellAllowRules());
  }
  // Staged attachment files were hand-picked by the user for this turn —
  // reading them never prompts (writes stay denied by the .limboo deny rule).
  if (posture.attachmentsStaged) rules.push('Read(.limboo/attachments/**)');
  if (posture.limbooMcp) {
    // Same trust decision Claude's canUseTool makes: the limboo_* tools are
    // internal and strictly read-only, so they never prompt.
    rules.push('Mcp(limboo_memory:*)', 'Mcp(limboo_search:*)');
  }
  return rules;
}

/**
 * Materialize the rules into `<root>/.cursor/cli.json` for the duration of
 * `fn`, then restore whatever was there before. A repo-authored config keeps
 * its own keys and allow rules — our rules are appended (deny supersedes
 * allow, so the merge only tightens).
 */
export async function withSessionCliJson<T>(
  root: string,
  rules: { deny: string[]; allow?: string[] },
  fn: () => Promise<T>,
): Promise<T> {
  return withSessionFile(
    root,
    '.cursor/cli.json',
    (originalBytes) => JSON.stringify(mergeConfig(originalBytes, rules), null, 2),
    fn,
  );
}

/** Merge our rules into a (possibly repo-authored) config, defensively. */
function mergeConfig(
  originalBytes: Buffer | null,
  rules: { deny: string[]; allow?: string[] },
): Record<string, unknown> {
  const original = safeParseObject(originalBytes);
  const out = copySafeKeys(original, new Set(['permissions']));

  const perms =
    original.permissions && typeof original.permissions === 'object' && !Array.isArray(original.permissions)
      ? (original.permissions as Record<string, unknown>)
      : {};
  const allow = Array.isArray(perms.allow) ? perms.allow.filter((r) => typeof r === 'string') : [];
  const deny = Array.isArray(perms.deny) ? perms.deny.filter((r) => typeof r === 'string') : [];
  out.permissions = {
    allow: [...new Set([...allow, ...(rules.allow ?? [])])],
    deny: [...new Set([...deny, ...rules.deny])],
  };
  return out;
}
