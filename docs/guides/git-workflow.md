# Git workflow

Limboo includes a deep git engine that runs entirely in the main process. This guide
covers the day-to-day workflow; the engine internals are in the
[Git Engine architecture](../architecture/subsystems/git-engine.md).

## The git workspace

The Git tab in the activity drawer is a full git surface: working-tree status,
staged and unstaged changes, diffs with syntax highlighting, history, branches,
tags, and blame. It refreshes live as the filesystem changes, because the File
System Layer notifies the git engine on every change burst.

## Status and staging

- **Status** shows the branch, upstream, ahead/behind counts, and changed files.
- **Stage / unstage** individual files or everything; **discard** reverts a tracked
  file or deletes an untracked one.
- **Diff** renders a unified diff per file (staged or working tree), with per-hunk
  line counts and language detection.

## Commit

Commit from the git workspace with a message. Commit identity uses your configured
`git.userName` / `git.userEmail` (blank falls back to your git config). On commit,
the engine offers the commit to the Memory System as a knowledge candidate (subject
to your auto-capture policy).

## Branches, tags, blame

Create and check out branches, create tags, and view blame per file. Switching a
branch with uncommitted changes can be guarded by a confirmation setting.

## Push and pull

- **Fetch** updates remote-tracking refs.
- **Push** publishes the branch. Force-push always uses `--force-with-lease`, never a
  bare `--force`, and a confirmation can be required. An untracked branch can
  auto-set its upstream ("publish branch"). The UI shows an ahead/behind pill and an
  unpushed badge on the Git rail tab.
- **Pull** uses your configured strategy (`ff-only` or `rebase`).

Network operations rely on your own credential helper or SSH agent. Limboo stores no
remote credentials, and embedded-credential remote URLs are redacted from results and
logs. Push and pull errors are classified into structured outcomes (no upstream,
rejected / needs pull, not fast-forward, conflicts, auth failed) so the UI can guide
the next step.

## Checkpoints

Checkpoints are Limboo's lightweight, per-session recovery points. They are stored as
git refs under a private `refs/limboo/checkpoints/...` namespace, so they never land
on a branch and are never pushed.

- The agent auto-creates a checkpoint before its first change in a run (when
  enabled).
- You can list, diff, restore, and delete checkpoints per session. Restoring first
  auto-checkpoints the current state for safety.
- Older checkpoints beyond the configured maximum are pruned automatically.

Checkpoints are created using a temporary index so your real index and working tree
are never disturbed.

## See also

- [Configuration](../getting-started/configuration.md) — git settings.
- [Git Engine architecture](../architecture/subsystems/git-engine.md).
