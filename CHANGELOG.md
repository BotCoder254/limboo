# Changelog

All notable changes to Limboo are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). See
[docs/operations/versioning.md](docs/operations/versioning.md).

## [Unreleased]

### Added

- Documentation subsystem: landing `README`, a structured `docs/` site (getting
  started, concepts, guides, reference, architecture, operations), community-health
  files (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `ROADMAP`,
  `SUPPORT`, `GOVERNANCE`, `AUTHORS`, `CITATION.cff`), and `.github/` automation
  (CI, CodeQL, Dependabot, issue/PR templates).

### Changed

- **Integrated Terminal** — pinned `node-pty` to the `1.2.0-beta` line,
  Microsoft's in-progress rewrite of the native addon on Node-API
  (`node-addon-api`) instead of NAN. The compiled binary is ABI-stable across
  Node.js *and* Electron major versions, so the per-platform prebuilt bundled
  in the npm package works as-is — no `node-gyp` rebuild, no Visual Studio
  Build Tools requirement, for any Electron version including future ones.
  `forge.config.ts`'s `rebuildConfig.ignoreModules` excludes `node-pty` from
  Electron Forge's native-rebuild pass, since `@electron/rebuild` doesn't know
  the bundled prebuilt is already correct and would otherwise try (and fail
  without the toolchain) to recompile it. No terminal behavior change. (An
  earlier attempt at this used `@homebridge/node-pty-prebuilt-multiarch`, a
  NAN-based fork — verified afterward to have no published prebuilt past
  roughly Electron 29's ABI, so it didn't actually fix the problem; superseded
  by this change.) See [installation](docs/getting-started/installation.md).

## [1.0.0]

The first consolidated release. The desktop foundation and platform services are
operational.

### Added

- **Desktop foundation** — multi-process Electron architecture with a typed IPC
  layer, frameless window with custom controls, window-state persistence, persistent
  settings, native menu and context menu, system tray, desktop notifications,
  single-instance lock, CSP and sandbox, main-process logging and global error
  handlers, a React error boundary and loading-screen hydration gate, Zustand
  stores, a command palette and keyboard shortcuts, and the pure-black three-pane
  shell.
- **Workspace Manager** — register, open, switch, and remove workspaces with a
  validation and tech-stack detection pipeline; active-workspace lifecycle.
- **Session Manager** — create, list, switch, duplicate, and trash development
  sessions; per-session transcript and activity persistence.
- **Local Database** — `better-sqlite3` store at `{userData}/limboo.db` with WAL,
  a versioned schema, idempotent migrations, and bound-parameter access.
- **Git Engine** — status, diff, stage, commit, log, branches, tags, blame, fetch,
  init, push, and pull (force-with-lease, never bare force), plus lightweight
  per-session checkpoints stored under a private ref namespace; an ahead/behind pill
  and unpushed badge in the UI.
- **Integrated Terminal** — workspace-scoped `node-pty` sessions with bounded
  scrollback; agent shell commands mirrored into the terminal view.
- **File System Layer** — `chokidar` watch, an indexed directory tree, guarded
  reads, and live git status pushed into the session list.
- **Agent Manager** — orchestration of the `@anthropic-ai/claude-agent-sdk` in plan
  and implement modes, risk-gated tool approvals, workspace path guarding,
  transcript/activity/diagnostics persistence, and SDK session resume.
- **Local Memory System** — durable, provider-independent project knowledge with
  fully offline FTS5 / BM25 retrieval, tiered ranking, auto-capture proposals, and
  prompt injection; a Memory activity tab and settings.
- **Unified streaming timeline** — the conversation rendered as one continuous,
  turn-grouped event stream of messages, tool calls, and status markers.

[Unreleased]: https://github.com/BotCoder254/limboo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/BotCoder254/limboo/releases/tag/v1.0.0
