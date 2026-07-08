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
  ];
}

/** What the standing posture auto-approves, translated to allow rules. */
export interface CursorAllowPosture {
  /** settings.agent.autoApproveReads under a mode that honors it. */
  autoApproveReads: boolean;
  /** The Limboo MCP bridge servers are registered for this run. */
  limbooMcp: boolean;
}

/**
 * Allow rules derived from Limboo's posture (design doc §7). Deny always
 * supersedes allow, so these only ever short-circuit prompts Cursor would
 * otherwise raise — they can never widen past the deny set above.
 */
export function sessionAllowRules(posture: CursorAllowPosture): string[] {
  const rules: string[] = [];
  if (posture.autoApproveReads) rules.push('Read(**)');
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
