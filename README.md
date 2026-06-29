<div align="center">

# Limboo

**The operating system for AI software development.**

A local-first desktop workspace that gives a connected coding agent everything it
needs to do real engineering: projects, sessions, file watching, repository
indexing, git, terminals, memory, permissions, and context. Limboo is not an AI
model. It is the environment around one.

[Documentation](docs/README.md) ·
[Architecture](docs/architecture/overview.md) ·
[Contributing](CONTRIBUTING.md) ·
[Roadmap](ROADMAP.md) ·
[Security](SECURITY.md)

</div>

---

## What is Limboo?

Limboo is a desktop application (Electron + React + TypeScript) that acts as the
workspace *around* a coding agent. The agent already understands programming,
debugging, planning, and git. Limboo provides the environment where it can perform
at its highest level: it manages the repository, watches the filesystem, runs the
terminal, owns the database, holds durable project memory, and enforces a strict
security boundary, while the agent focuses exclusively on writing software.

Every unit of work is a **Session** — a bundle of a repository, branch, chat
history, agent, terminal history, checkpoints, permissions, context, memory, tasks,
and generated files. Instead of opening many windows, everything lives inside one
workspace.

## Why it exists

Traditional IDEs revolve around files. Limboo revolves around conversations. You do
not ask "which file should I edit?" — you say "implement authentication," and the
agent figures out the files while Limboo visualizes the process: the streaming
reply, the tool calls, the file changes, the git diff, and the running commands.

It is **local-first** by design. There is no backend and no cloud sync. The only
network traffic is the connected coding agent talking to its AI provider. The
project, its history, and its memory belong to the developer.

## Key features

- **Session-centric workspace** — repo + branch + chat + agent + terminal +
  checkpoints + memory, all in one place.
- **Coding agent orchestration** — drives the Claude Code agent (plan and implement
  modes) with risk-gated tool approvals, path-guarded to the workspace.
- **Deep git engine** — status, diff, stage, commit, log, branches, tags, blame,
  fetch, push, pull, plus lightweight per-session **checkpoints** for instant
  recovery.
- **Integrated terminal** — workspace-scoped PTY sessions; agent commands are
  mirrored into the terminal view.
- **File System Layer** — live watch + indexed tree + guarded reads, pushing live
  git status into the session list.
- **Local Memory System** — durable, provider-independent project knowledge with
  fully offline FTS5 / BM25 retrieval, injected into the agent prompt.
- **Unified streaming timeline** — one continuous, turn-grouped event stream of the
  conversation, tool calls, and status.
- **Pure-black, dark-only UI** — a minimal three-pane shell tuned for a true
  `#000000` background.

## Architecture at a glance

```
 Renderer (Chromium + React)   UI only — it asks, it never performs
        |  window.limboo.*
        v
 Preload (contextBridge)        the only bridge; contextIsolation on, sandbox on
        |  ipcRenderer <-> ipcMain
        v
 Main (Node.js + OS access)     workspaces, sessions, git, terminal, fs, agent,
                                memory, SQLite — every OS-touching capability
```

Limboo runs three Electron contexts with a hard boundary between them. The renderer
holds no business logic; all filesystem, git, shell, database, and agent work lives
in the main process and crosses a single typed IPC bridge. See
[docs/architecture/overview.md](docs/architecture/overview.md).

## Tech stack

| Layer            | Choice                                          |
| ---------------- | ----------------------------------------------- |
| Shell / desktop  | Electron 42 (via Electron Forge 7)              |
| Bundler          | Vite 5 (`@electron-forge/plugin-vite`)          |
| UI framework     | React 19                                        |
| Language         | TypeScript                                      |
| Styling          | Tailwind CSS v4 (CSS-first, no config)          |
| State            | Zustand 5 (slice-per-domain stores)             |
| Database         | better-sqlite3 (WAL, FTS5)                       |
| Terminal         | node-pty + xterm                                |
| File watching    | chokidar                                        |
| Coding agent     | `@anthropic-ai/claude-agent-sdk`                |
| Icons            | lucide-react                                    |

## Quick start

**Prerequisites**

- Node.js 20+ and npm.
- A C/C++ build toolchain — `better-sqlite3` and `node-pty` are native modules
  compiled on install (build-essential / Xcode Command Line Tools / MSVC Build
  Tools depending on platform).
- The coding agent owns its own authentication. Limboo never stores credentials;
  it reads the agent's existing sign-in (for example `ANTHROPIC_API_KEY` or the
  Claude Code credentials file). See
  [docs/guides/using-the-agent.md](docs/guides/using-the-agent.md).

**Run in development**

```bash
npm install     # installs deps and compiles native modules
npm start       # Electron + Vite dev server (renderer on :5173)
```

There is no `npm run dev` — `npm start` drives both Electron and Vite. Full setup
notes live in [docs/getting-started/installation.md](docs/getting-started/installation.md).

**Build installers**

```bash
npm run package   # package the app (no installers)
npm run make      # platform installers (deb / rpm / zip / squirrel)
```

## Documentation

The documentation is organized as a subsystem, not a single file. Start at the
[documentation home](docs/README.md):

- **Getting started** — [installation](docs/getting-started/installation.md),
  [quick start](docs/getting-started/quick-start.md),
  [configuration](docs/getting-started/configuration.md).
- **Concepts** — [sessions](docs/concepts/sessions.md),
  [workspaces](docs/concepts/workspaces.md),
  [local-first](docs/concepts/local-first.md),
  [conversation-first UI](docs/concepts/conversation-first-ui.md).
- **Guides** — [using the agent](docs/guides/using-the-agent.md),
  [git workflow](docs/guides/git-workflow.md),
  [memory system](docs/guides/memory-system.md),
  [terminal](docs/guides/terminal.md),
  [keyboard shortcuts](docs/guides/keyboard-shortcuts.md).
- **Reference** — [`window.limboo` API](docs/reference/window-limboo-api.md),
  [IPC channels](docs/reference/ipc-channels.md),
  [settings](docs/reference/settings.md),
  [design tokens](docs/reference/design-tokens.md),
  [commands](docs/reference/commands.md).
- **Architecture** — [overview](docs/architecture/overview.md) and per-subsystem
  documentation under [docs/architecture/](docs/architecture/overview.md).
- **Operations** — release, CI/CD, packaging, and maintenance under
  [docs/operations/](docs/operations/release-process.md).

Two internal references predate this site and remain the deepest source of truth
for contributors: [`CLAUDE.md`](CLAUDE.md) (the code-level working contract) and
[`project.md`](project.md) (the full product and architecture vision).

## Project status

Limboo is at `1.0.0`. The desktop foundation and platform services are built:
workspaces, sessions, the git engine, the integrated terminal, the File System
Layer, agent orchestration, the Local Memory System, and a hardened IPC layer over
a 14-table SQLite database. Planned work (repository clone/track UI, a standalone
permission system, a dedicated search engine, merge-conflict resolution, remote
management, and stash) is tracked in [ROADMAP.md](ROADMAP.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
development workflow, the process-boundary contract, theme discipline, and the
verification steps every change must pass. Please also review the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Limboo is local-first with a deliberately small attack surface and defense-in-depth
hardening. To report a vulnerability, follow [SECURITY.md](SECURITY.md) — please do
not open a public issue for security reports.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 BotCoder254.
