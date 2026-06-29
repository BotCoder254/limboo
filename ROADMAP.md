# Roadmap

This roadmap reflects current reality. It separates what is **built** from what is
**planned**. The deepest, code-level status lives in [`CLAUDE.md`](CLAUDE.md) §8; the
product vision lives in [`project.md`](project.md). This file is a forward-looking
summary, not a commitment to dates.

## Built

The desktop foundation and platform services are operational in the main process,
reached from the renderer through the typed IPC bridge and backing a real, no-mock
UI:

- **Desktop foundation** — frameless window, window-state and settings persistence,
  native menu / tray / notifications, single-instance lock, CSP and sandbox,
  command palette and shortcuts, the pure-black three-pane shell.
- **Workspace Manager** — lifecycle, validation, tech-stack detection, active
  workspace.
- **Session Manager** — create / list / switch / duplicate / trash; per-session
  transcript and activity.
- **Local Database** — SQLite (WAL, FTS5), versioned schema, idempotent migrations.
- **Git Engine** — status / diff / stage / commit / log / branches / tags / blame /
  fetch / init / push / pull, plus lightweight per-session checkpoints.
- **Integrated Terminal** — `node-pty` sessions with mirrored agent commands.
- **File System Layer** — watch + index + guarded reads + live git status.
- **Agent Manager** — Claude Code orchestration (plan / implement), risk-gated tool
  approvals, path guarding, diagnostics, session resume.
- **Local Memory System** — offline FTS5 / BM25 retrieval, tiers, proposals, prompt
  injection.

## Planned

Tracked but not yet built (mirrors the "Still open / future" list in
[`CLAUDE.md`](CLAUDE.md) §8):

- **Repository clone / track UI** — clone a remote and register it as a workspace
  from inside the app.
- **Standalone Permission System** — a dedicated permission layer beyond the agent's
  per-tool `canUseTool` gate.
- **Project Indexer / Search Engine** — a standalone code index and search beyond
  the file tree.
- **Merge-conflict resolution UI** — interactive conflict resolution in the git
  workspace.
- **Remote management** — add / edit / remove git remotes from the UI.
- **Stash** — git stash support.
- **Memory embeddings** — an optional local vector layer fused on top of the
  existing BM25 ranking (the ranking is already fusion-ready).
- **Code signing and notarization** — signed installers for distribution (see
  [docs/operations/packaging-and-signing.md](docs/operations/packaging-and-signing.md)).

## How to influence the roadmap

Open a feature request issue with the use case and constraints. Substantial
proposals should describe how they fit the process boundary and the local-first,
dark-only, manager-per-responsibility principles. See
[CONTRIBUTING.md](CONTRIBUTING.md).
