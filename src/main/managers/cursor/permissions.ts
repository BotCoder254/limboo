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
 * Turn an OS-absolute path into a Cursor *absolute* rule path. Cursor's grammar
 * treats a single leading `/` as **project-relative** and a double `//` as
 * **absolute**; without this an absolute userData deny like `Read(/home/.../x)`
 * is silently reinterpreted against the workspace and never matches. We
 * glob-escape first, then guarantee exactly one extra leading slash.
 */
function absRulePath(p: string): string {
  const escaped = globEscape(p);
  return escaped.startsWith('/') ? `/${escaped}` : `//${escaped}`;
}

/**
 * The minimal deny-first rule set for any Cursor run. Mirrors the app-data
 * guard the Claude path enforces in canUseTool (touchesAppData) plus
 * repo-integrity, self-gate, and destructive-shell basics.
 */
export function sessionDenyRules(userDataPath: string): string[] {
  const userData = absRulePath(userDataPath);
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
    // Absolute rule path (`//…`) — a single leading slash would be read as
    // project-relative and never match (see absRulePath).
    `Read(${userData}/**)`,
    `Write(${userData}/**)`,
    // Named belt-and-suspenders denies for the two the design note calls out by
    // name (both already inside the userData tree above, but explicit here).
    // Limboo's own app data stays HARD-denied — the memory tools are the only
    // sanctioned path in; workspace secrets (below) are ask-for-approval instead.
    `Read(${userData}/secrets/**)`,
    `Read(${userData}/limboo.db)`,
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

/**
 * Workspace secrets the agent may only touch with the user's approval. These go
 * in the cli.json `ask` list (NOT `deny`): on a hook-verified run the
 * `beforeReadFile`/`preToolUse` hook drives Limboo's own approval prompt, and on
 * a non-hook run `ask` (unlike `deny`) neither hard-blocks the file nor poisons
 * other tools. The live `touchesSensitiveFile` guard in AgentManager mirrors this
 * as an approval prompt for both providers. Covers `.env` secret variants (the
 * non-secret templates .env.example/.sample/.template/.dist stay untouched), SSH
 * private keys, key/cert material, and netrc. Bare names match at any depth; `~/`
 * is the home dir.
 */
export function sessionAskRules(): string[] {
  return [
    'Read(.env)',
    'Read(.env.local)',
    'Read(.env.*.local)',
    'Read(.env.production*)',
    'Read(.env.development*)',
    'Read(.env.staging*)',
    'Read(.env.test*)',
    'Write(.env)',
    'Write(.env.local)',
    'Write(.env.*.local)',
    'Write(.env.production*)',
    'Write(.env.development*)',
    'Write(.env.staging*)',
    'Write(.env.test*)',
    'Read(~/.ssh/**)',
    'Write(~/.ssh/**)',
    'Read(**/id_rsa)',
    'Read(**/id_ed25519)',
    'Read(**/id_ecdsa)',
    'Read(**/id_dsa)',
    'Read(**/*.pem)',
    'Read(**/*.key)',
    'Read(**/*.p12)',
    'Read(**/*.pfx)',
    'Read(~/.netrc)',
    'Read(**/.netrc)',
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
    // Worktree confinement comes from `--workspace <root>` + cwd, not from the
    // read glob — so this is the proven bare `Read(**)` (a `Read(/**)` variant
    // hinges on Cursor's single-slash grammar and can break read auto-approval).
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
  rules: { deny: string[]; allow?: string[]; ask?: string[] },
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
  rules: { deny: string[]; allow?: string[]; ask?: string[] },
): Record<string, unknown> {
  const original = safeParseObject(originalBytes);
  const out = copySafeKeys(original, new Set(['permissions']));

  const perms =
    original.permissions && typeof original.permissions === 'object' && !Array.isArray(original.permissions)
      ? (original.permissions as Record<string, unknown>)
      : {};
  const allow = Array.isArray(perms.allow) ? perms.allow.filter((r) => typeof r === 'string') : [];
  const deny = Array.isArray(perms.deny) ? perms.deny.filter((r) => typeof r === 'string') : [];
  const ask = Array.isArray(perms.ask) ? perms.ask.filter((r) => typeof r === 'string') : [];
  out.permissions = {
    allow: [...new Set([...allow, ...(rules.allow ?? [])])],
    deny: [...new Set([...deny, ...rules.deny])],
    ask: [...new Set([...ask, ...(rules.ask ?? [])])],
  };
  return out;
}
