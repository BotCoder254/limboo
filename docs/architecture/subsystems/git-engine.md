# Subsystem: Git Engine

## Purpose

The Git Engine is the deep git integration: every git operation for the active
workspace, plus Limboo's lightweight per-session checkpoints. It is designed around a
timeline (a checkout timeline, not a bag of commands) and runs entirely in the main
process, argv-only, with no shell. See the
[Git workflow guide](../../guides/git-workflow.md).

Source: [`src/main/managers/GitManager.ts`](../../../src/main/managers/GitManager.ts)
with `managers/git/{exec,parse,status,refs}.ts`.

## Responsibilities

- Read: status, diff, log, commit detail, branches, tags, blame.
- Working tree: stage, unstage, discard, commit.
- Branch / tag: checkout, create branch, create tag.
- Network: fetch, push, pull, init.
- Checkpoints: create, list, diff, restore, delete.

## Submodules

- `git/exec.ts` — `runGit(cwd, args, opts)` spawns via `execFile` (argv-only, never
  shell), with a bounded timeout / buffer and a locked-down environment (no pager,
  `GIT_TERMINAL_PROMPT=0`). `assertInsideRepo(root, relPath)` guards every
  renderer-supplied path.
- `git/parse.ts` — structured parsers for status, log, blame, unified diff,
  name-status, and numstat.
- `git/status.ts` — a quick status snapshot (branch, ahead/behind, counts), reused by
  the File System Layer to push status into session rows.
- `git/refs.ts` — `sanitizeRef` validates user-supplied branch / base refs
  (rejects leading `-`, metacharacters, control bytes) before they become git
  argv elements; used by the Worktree Manager and branch operations.

## Public surface (key methods)

`status`, `diff`, `stage` / `unstage` / `stageAll` / `unstageAll`, `discard`,
`commit`, `log`, `commitDetail`, `branches`, `checkout`, `createBranch`, `tags`,
`createTag`, `blame`, `fetch`, `push`, `pull`, `init`, and the checkpoint methods.
Reached via the `git:*` channels.

## Checkpoints

Checkpoints are stored as refs under `refs/limboo/checkpoints/<sessionId>/<ts>` — off
any branch, never pushed. They are created using a temporary index
(`GIT_INDEX_FILE`) so the user's index and working tree are untouched: build a tree,
create a commit, write the ref. Restoring auto-checkpoints the current state first;
older checkpoints beyond the configured maximum are pruned. Metadata is stored in the
`git_checkpoints` table.

## Push / pull safety

Push uses `--force-with-lease`, never a bare `--force`, and can require confirmation.
Errors are classified into structured outcomes (no upstream, rejected / needs pull,
not fast-forward, conflicts, auth failed) so the UI can guide the next step. Limboo
stores no remote credentials — it uses the user's credential helper / SSH agent — and
embedded-credential remote URLs are redacted from results and logs.

## Dependencies and wiring

- On `commit`, the engine offers the commit to the **Memory System** as a knowledge
  candidate (fire-and-forget; respects the auto-capture policy).
- The **File System Layer** notifies the engine on tree changes so git refreshes
  live; the **Agent Manager** triggers auto-checkpoints before changes.
- Worktree lifecycle (add / remove / repair) lives in the separate
  [**Worktree Manager**](worktree-manager.md). The engine's root resolves
  through it: git operations target the *active session's* effective root
  (its worktree when it owns one), and the root cache is invalidated on
  active-session changes. Known limitation: git queries for a non-active
  session in the same workspace resolve to the active session's root.

## Data flow

`git:changed` and `git:checkpoints-changed` are pushed to the renderer;
`useGitStore` consumes them.

## Security boundary

argv-only spawns (no shell injection), every path validated with `assertInsideRepo`,
inputs capped (commit message, ref names), and checkpoints isolated in a private ref
namespace so they never pollute real history. See
[the security model](../security-model.md).

## Planned

Merge-conflict resolution UI, remote management, and stash are planned; see
[ROADMAP.md](../../../ROADMAP.md).
