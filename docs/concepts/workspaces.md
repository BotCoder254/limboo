# Workspaces

A workspace is the project container. A session always belongs to a workspace. This
page explains what a workspace represents and how its lifecycle works.

## Why workspaces

The agent needs an unambiguous, bounded root to operate in: a single directory it
can read, watch, index, run git against, and spawn terminals inside, with every path
guarded to stay within it. A workspace is that root, plus the metadata Limboo detects
about it. Bounding everything to a workspace is also a security primitive — it is the
boundary that path-traversal guards enforce.

## What a workspace contains

- A filesystem **path** (unique; a directory).
- Detected **metadata** — languages, package managers, frameworks, git branch,
  Docker presence.
- A **config** — ignored directories, preferred shell, terminal-command approval.
- **Lifecycle** and **health** state.
- Its **sessions**.

## Lifecycle

Workspaces are owned by the main-process Workspace Manager and persisted in SQLite:

- **Create / open** — register or reopen a directory. A validation step rejects
  system roots and the home directory itself and checks the path is an accessible
  directory (symlink-aware). A detection step probes the tech stack.
- **Switch** — make a workspace active. This drives in-process listeners: the File
  System Layer tears down the old watcher and starts watching the new root, and the
  Memory System seeds starter memories on first activation.
- **Toggle favorite** — favorites sort first.
- **Update config** — change ignored directories, preferred shell, and so on.
- **Rescan** — re-run detection (branch changed, lockfile added, framework
  detected).
- **Remove** — unregister from Limboo. Files are never deleted.

## Active-workspace wiring

When the active workspace changes, several subsystems react in process:

- The **File System Layer** starts watching and indexing the new root and seeds the
  session list's git status.
- The **Memory System** seeds default memories for the workspace (idempotent).

This single source of truth keeps the watcher, indexer, git engine, and memory store
pointed at the same root.

## See also

- [Sessions](sessions.md).
- [Workspace Manager architecture](../architecture/subsystems/workspace-manager.md).
- [File System Layer](../architecture/subsystems/file-system-layer.md).
