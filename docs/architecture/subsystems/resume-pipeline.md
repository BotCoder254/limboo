# Subsystem: Resume Pipeline

## Purpose

The Resume Pipeline is what makes reopening a session mean **"continue exactly
where you left off"** rather than merely replaying a transcript. The Claude Agent
SDK persists the *conversation* — prompts, tool calls, results, and reasoning — and
resumes it through `options.resume`
([SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)). But the SDK
explicitly does **not** reconstruct filesystem or repository state; it recommends
that application-level systems own that. A conversation records *why* decisions were
made. It cannot tell the agent whether another session committed to the same branch,
whether the history was rebased, whether a dependency manifest changed, or whether a
function it relied on was deleted while the session was inactive.

The Resume Pipeline closes that gap. On every session activation it revalidates the
repository against the state the session last saw, computes a structured **repository
delta**, and hands the agent a one-shot context block so it resumes against verified
repository reality instead of remembered assumptions. It is a provider-independent
platform service owned by the app — like the [Memory System](memory-system.md) and
the Search Engine — and it is fully local: every git operation is argv-only,
bounded, and offline.

Source:
[`src/main/managers/resume/ResumeManager.ts`](../../../src/main/managers/resume/ResumeManager.ts)
and
[`src/main/managers/resume/delta.ts`](../../../src/main/managers/resume/delta.ts).

## Design principle: cooperation, not replacement

The pipeline never tries to reconstruct engineering context from a single source.
Each subsystem remembers a different thing, and resume synchronizes them:

| Subsystem | Remembers |
| --- | --- |
| Claude Agent SDK | what the agent *thought* (conversation) |
| Git | how the repository *evolved* (commits, trees) |
| Search index | *where* relevant symbols live |
| `search_refs` graph | *how* files depend on each other |
| Local Memory | *why* architectural decisions were made |
| Worktree | the isolated filesystem the task lives in |

Git is treated as the authoritative source of repository evolution — object identity
via commit hashes and trees — never inferred from conversation.

## Responsibilities

- Record a **repository anchor** per session (a snapshot) at meaningful moments.
- On activation, **revalidate** the repo against that anchor (cheap short-circuit
  when nothing changed) without ever blocking session switching.
- Compute a structured **repository delta** when the repo diverged.
- Enrich the delta with **code intelligence**: per-file symbol adds/removes and
  importer counts.
- **Downgrade** memory confidence when referenced files disappear; restore it when
  they return.
- Inject a one-shot `<repository-delta>` block into the next agent prompt.

## Placement and wiring

The manager is constructed in the composition root
([`src/main/index.ts`](../../../src/main/index.ts)) after Search and Memory, and
wired with the same setter-injection pattern used by other platform services:

- `agent.setResumeManager(resume)` — context injection + the run-end snapshot signal.
- `git.setResumeManager(resume)` — a snapshot signal after each checkpoint.
- `resume.setSearchManager(search)` / `resume.setMemoryManager(memory)` — enrichment
  and memory revalidation.
- `resume.setSessionRootResolver(...)` — the same worktree-aware effective-root
  resolver the Agent / Terminal / Git / Search managers use.
- `resume.setStatusRecorder((id, label, detail) => agent.recordStatus(...))` — so
  revalidation results land in the session timeline via `agent_activity`.
- `sessions.onActiveChanged((s) => resume.onActiveSessionChanged(s))` — a **separate,
  additive** listener registered next to the existing effective-root retarget
  listener, so the retarget path (`retargetEffectiveRoot`) is untouched.
- Boot revalidation chains after worktree recovery:
  `worktrees.recover().finally(() => { retargetEffectiveRoot(); resume.onBoot(); })`
  — so a repaired or missing worktree never produces a bogus delta.

Every entry point is fire-and-forget. Revalidation runs asynchronously and is
deadline-bounded; a timeout or git failure degrades to "no delta" and never blocks
the switch or surfaces an error.

## Storage

Two tables own the pipeline's durable state (schema v10; see
[the database](database.md)):

- `session_snapshots` — one repository anchor per session (primary key
  `session_id`, upserted). Columns: `workspace_id`, `root`, `head` (NULL for a
  non-git or unborn HEAD), `branch` (NULL when detached), `dirty_hash`,
  `dirty_files` (a capped JSON summary), `reason`, and timestamps.
- `resume_deltas` — the last computed delta per session (primary key `session_id`),
  with `status` (`pending` | `injected` | `dismissed`) and the delta as JSON.
  Persisting it means a pending injection survives an app restart between detection
  and the next prompt.

The Search Engine gains two schema-v11 additions the pipeline reuses (see
[Code-intelligence enrichment](#code-intelligence-enrichment)): a
`search_files.content_hash` column and a `search_refs` dependency table.

All access is parameterized; no value is ever interpolated into SQL.

## Snapshots

A snapshot is the session's repository anchor, captured through the effective
execution root (the worktree checkout when the session owns one, else the workspace
path):

1. `git rev-parse --verify HEAD` -> `head` (NULL on a non-git or unborn repo).
2. `git rev-parse --abbrev-ref HEAD` -> `branch` (`HEAD` means detached -> NULL).
3. `git status --porcelain=v1 -z` -> dirty entries, from which a **dirty hash** is
   derived: a SHA-256 over the sorted `status\0path\0size\0mtimeMs` lines, using
   `fs.lstat` for size and mtime. This detects content drift in an already-dirty
   working tree **without ever reading file contents**. Each `lstat` target is
   validated inside the root first (`isInsideRoot`), and the entry set is capped by
   `RESUME_LIMITS.maxDirtyEntries` (an overflow marker keeps the hash stable).

Snapshots are upserted (`INSERT ... ON CONFLICT(session_id) DO UPDATE`) at four
capture points:

- **Run end** — `AgentManager.send()` finally block (`onRunFinished`): the agent may
  have changed the repo.
- **Checkpoint** — after `GitManager.createCheckpoint` succeeds (`onCheckpointCreated`).
  Snapshots never create checkpoints, so there is no recursion.
- **Deactivation** — the session being switched away from is anchored before the new
  one is revalidated.
- **After revalidation** — a fresh anchor makes each delta one-shot (the next
  activation short-circuits clean while the pending row waits for the first prompt).

A quit-time snapshot is deliberately not attempted — async git during `before-quit`
is unreliable, and the four capture points already cover the important transitions.
The safe failure direction is to over-report the last uncommitted edits, not to miss
a change.

## Revalidation

`revalidate(sessionId)` runs on every activation and at boot. It is wrapped in a
`Promise.race` against `RESUME_LIMITS.revalidateTimeoutMs` (10 s); any failure lands
on phase `idle` with a logged warning and no UI. The flow:

1. Gate on `settings.resume.enabled`. Broadcast phase `checking`.
2. **No snapshot yet** -> capture one (`activate`), phase `clean`. First-ever visit
   never produces a delta.
3. **Optional freshness skip** — if `settings.resume.staleThresholdDays > 0` and the
   snapshot is newer than that window, short-circuit `clean` (0 = always revalidate).
4. **Root changed** — the effective root differs from the snapshot root (worktree
   recreated or detached): emit a delta with `rootChanged: true`, skip the commit
   ranges (they would be meaningless), and re-anchor.
5. **Cheap short-circuit** — read the current head + branch + dirty hash; if all
   three equal the snapshot, clear any stale pending delta and finish `clean`. This
   is the overwhelmingly common case and costs roughly two `rev-parse` calls plus one
   `status`.
6. Otherwise compute the delta, enrich it, persist it `pending`, broadcast phase
   `delta`, record a timeline entry, and re-anchor.

A dirty-hash-only wobble with no visible file/commit change (e.g. an mtime touch) is
treated as `clean` — it re-anchors but surfaces nothing.

## Delta computation

[`delta.ts`](../../../src/main/managers/resume/delta.ts) is a set of pure functions
over the shared `runGit` runner. The snapshot HEAD is validated against
`/^[0-9a-f]{4,64}$/i` before it ever enters an argv, as defense in depth on top of
argv-only execution. The algorithm:

1. `git cat-file -e <snap>^{commit}` — a miss means the snapshot commit was garbage
   collected (typically after a rebase) -> `historyRewritten: true`, carry only
   branch/dirty information.
2. `git merge-base --is-ancestor <snap> HEAD` — a non-zero exit means the snapshot is
   no longer an ancestor (rebase or amend) -> `historyRewritten: true`.
3. `git rev-list --count <snap>..HEAD` and `HEAD..<snap>` -> exact ahead/behind
   counts.
4. `git log --format=%H%x1f%s%x1f%an%x1f%ct -n <maxCommitsInDelta> <snap>..HEAD` ->
   the capped commit list (subjects clipped), parsed on the 0x1f field separator.
5. `git diff --name-status -z <snap> HEAD` -> committed file changes, parsed by the
   shared `parseNameStatus`, then merged with the current dirty entries (committed
   status wins on the same path). Capped at `RESUME_LIMITS.maxFilesInDelta`, with the
   true total kept separately.
6. Each path is **categorized**: `manifest` (package.json, lockfiles, Cargo/Go/Python
   manifests, and **`limboo.json`** — a change here matters because of the
   [config trust gate](../../reference/limboo-json.md)), `migration` (any
   `/migrations/` segment), `config` (tsconfig, eslintrc, vite/forge configs),
   `doc`, or `source`/`other`. Manifest and migration paths are surfaced prominently.

Overflow degrades gracefully: the exact counts are always reported, and the capped
lists show heads with an "... and N more" tail. Every git call inherits the 15 s
`runGit` timeout, and the whole pass is bounded by the 10 s revalidation deadline.

## Code-intelligence enrichment

When the Search Engine is enabled, the delta is enriched using the local index —
no tree-sitter, no embeddings, no network. Two schema-v11 additions make this cheap:

- **`search_files.content_hash`** — a SHA-256 of the (size-capped) file content
  (path-only rows use a `size:mtimeMs` surrogate). During incremental indexing an
  unchanged file is skipped entirely: no delete-then-insert, no FTS churn.
- **`search_refs`** — one row per import/require/use edge, extracted by a regex
  per-language extractor
  ([`search/refs.ts`](../../../src/main/managers/search/refs.ts)) during the same
  indexing pass that owns `search_symbols`. Relative specifiers are resolved to
  workspace paths by pure path math against the already-indexed path set — no
  filesystem I/O, and any `..` escape is rejected. The table is parser-agnostic, so a
  future tree-sitter extractor can repopulate it without a schema change.

From these the pipeline derives, for the changed source files (bounded by
`FS_LIMITS.incrementalIndexMax`):

- **`refImpacts`** — how many files import each changed/deleted file ("3 files import
  `src/shared/types.ts`"). This works regardless of index timing because it queries
  the current reference graph.
- **`symbols`** — per-file symbol adds/removes, computed by capturing the indexed
  symbol identities before a reindex, reindexing the changed files, and diffing
  against the identities after. Best-effort: because the index is continuously
  maintained, this yields results primarily when the index lagged the change, and is
  simply empty otherwise.

## Memory revalidation

The [Memory System](memory-system.md)'s previously write-only `memory_links` table
becomes active. `create` and `acceptProposal` now write links: a `kind='file'` link
for a memory's `filePath`, and `kind='symbol'` links (`path#name`) for its
`symbolRefs`. All paths are validated (bounded, relative, no traversal, no NUL) at
the IPC boundary and re-normalized in the manager.

During revalidation, memories whose linked files were deleted have their confidence
scaled by 0.6 (floored at 0.1); the pre-downgrade value is stashed in the memory's
`meta` so it can be restored verbatim when the file reappears at a later revalidation.
Because retrieval already weights confidence, a downgraded memory naturally sinks in
ranking without any special-casing — obsolete engineering guidance stops surfacing
just because it once appeared in a conversation.

## Context injection

`AgentManager.resumeContextFor(sessionId)` is a third context producer alongside the
memory and search producers. It reads the `pending` delta, renders a
`<repository-delta>` system-prompt block within `RESUME_LIMITS.injectCharBudget`
(the same trim-loop budgeting as the memory/search blocks), and marks the persisted
row `injected` — one delta, one injection. The rendered block is cached on the
in-flight run record so a recovery retry (`runWithRecovery`) re-injects the *same*
block rather than losing it. All three producers are joined with blank-line
separators into a single `systemPrompt.append` on the Claude Code preset, so this
never interacts with `options.resume` or the corrupted-resume self-heal.

The block leads with an advisory ("reconcile your assumptions... re-read anything you
depend on"), then branch/HEAD movement, the capped commit subjects, changed files
tagged by category, a dependency-manifest warning line, any symbol changes and
importer counts, downgraded memories, and an uncommitted-changes note.

## IPC surface

Registered through the `handle()` wrapper (so every call inherits sender-origin
validation). The whole surface takes **string session ids only** — no
renderer-supplied object crosses the boundary, so there is no prototype-pollution
surface.

- `resume:getState` (sessionId) -> `ResumeState`.
- `resume:getDelta` (sessionId) -> `RepoDelta | null` (the persisted row, pending or
  injected, so the detail dialog works after injection). Never recomputed on demand.
- `resume:dismiss` (sessionId) -> void — drops the pending injection.
- `resume:revalidate` (sessionId) -> void — additionally gated to the **active**
  session in the main process.
- Event: `resume:state-changed` pushes each `ResumeState` transition.

Exposed on the preload bridge as the `window.limboo.resume` namespace; see the
[`window.limboo` API](../../reference/window-limboo-api.md).

## User interface

Matching the existing shell idioms exactly (pure-black tokens, no new patterns):

- **`ResumeBanner`** — a row under the session header cloning the missing-worktree
  banner (`h-9`, `border-b border-line bg-surface`): an info tone for ordinary
  drift, a warning tone for a rewrite or root change. "Review" opens the detail
  dialog; a dismiss control drops the injection.
- **Revalidating chip** — a "Revalidating..." pill (the plan-ready chip classes plus
  a spinner) in the session header while the phase is `checking`. Activation stays
  non-blocking; the composer is never disabled.
- **`ResumeDeltaDialog`** — a modal on the hooks-confirmation idiom with branch/HEAD
  movement, the commit list, files grouped by category (manifest/migration
  highlighted), and any symbol changes.

Backed by `useResumeStore`, which subscribes to `resume:state-changed` and hydrates
per session. Revalidation results are also recorded in the Activity timeline.

## Settings

Under the **Memory & Search** settings category (`settings.resume`, bounds in
`RESUME_LIMITS`):

- `enabled` — master switch for snapshots, revalidation, and the delta UI.
- `injectDelta` — inject the pending delta into the next prompt.
- `maxCommitsInDelta` — how many commit subjects the delta lists (counts stay exact).
- `staleThresholdDays` — skip revalidation for sessions touched within this window
  (0 = always).

See the [settings reference](../../reference/settings.md).

## Guarantees and edge cases

- **Never blocks switching** — every entry point is async and fire-and-forget;
  revalidation is deadline-bounded and degrades to "no delta" on any failure.
- **Plain (non-worktree) sessions** share the workspace checkout, so they can see
  deltas produced by sibling sessions' work. This is correct: the repository really
  did change under them.
- **Non-git roots** — `rev-parse` fails, the snapshot stores `head = NULL`, and
  revalidation always short-circuits `clean`. No delta, no error.
- **History rewrite / gc** — detected via `cat-file -e` / `merge-base
  --is-ancestor`; the delta is flagged `historyRewritten` and avoids
  unrelated-histories range diffs.
- **Recovery retries** — the rendered delta block is cached on the run record, so a
  retry re-injects the same block (one delta, one injection).
- **Boot ordering** — revalidation runs strictly after worktree recovery settles;
  the effective-root retarget path, the corrupted-resume self-heal, checkpoint
  creation, and the incremental-vs-full index routing are all untouched.

## Security boundary

Argv-only git through the shared runner (no `shell: true`); the snapshot HEAD is
regex-validated before entering any argv; all SQL is parameterized; `lstat` targets
are `isInsideRoot`-guarded; renderer inputs are string session ids only, and memory
link paths are validated and normalized. Commit subjects and paths are never written
to the log (counts only). See the [security model](../security-model.md).

## Planned

A **tree-sitter** upgrade of the `search_symbols` / `search_refs` extractors — both
tables are parser-agnostic by design — would sharpen the symbol delta and enable a
true call/inheritance graph. A local **vector-embeddings** layer fused on top of BM25
(the Memory and Search rankings are already fusion-ready) would let the injected
context prioritize by conceptual relevance. Both are tracked in
[ROADMAP.md](../../../ROADMAP.md).
