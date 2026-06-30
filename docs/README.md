# Limboo Documentation

This is the documentation home for Limboo, the operating system for AI software
development. The documentation is organized as a subsystem, not a single file, in
five layers: a landing page ([README](../README.md)), this site, contributor
documentation, architecture documentation, and operational documentation.

If you are new, start with [Getting started](#getting-started). If you are a
contributor, jump to [Architecture](#architecture) and
[Contributing](#contributing). The two internal references that predate this site
and remain the deepest source of truth are [`CLAUDE.md`](../CLAUDE.md) (the
code-level working contract) and [`project.md`](../project.md) (the product and
architecture vision).

## Getting started

- [Installation](getting-started/installation.md) — prerequisites, native modules,
  platform notes.
- [Quick start](getting-started/quick-start.md) — open a workspace, start a session,
  send your first prompt.
- [Configuration](getting-started/configuration.md) — every settings category and
  where it persists.

## Concepts

- [Sessions](concepts/sessions.md) — the unit of work.
- [Workspaces](concepts/workspaces.md) — the project container.
- [Local-first](concepts/local-first.md) — no backend, no telemetry, your data.
- [Conversation-first UI](concepts/conversation-first-ui.md) — why the app revolves
  around conversations, not files.

## Guides

- [Using the agent](guides/using-the-agent.md) — plan vs implement, permissions,
  approvals.
- [Git workflow](guides/git-workflow.md) — status, staging, commit, push/pull,
  checkpoints.
- [Memory system](guides/memory-system.md) — tiers, proposals, prompt injection.
- [Terminal](guides/terminal.md) — integrated PTY sessions and mirrored commands.
- [Keyboard shortcuts](guides/keyboard-shortcuts.md) — the command palette and
  default bindings.

## Reference

- [`window.limboo` API](reference/window-limboo-api.md) — the full preload bridge
  surface.
- [IPC channels](reference/ipc-channels.md) — invoke and event channel names by
  domain.
- [Settings](reference/settings.md) — the `AppSettings` shape, defaults, and clamps.
- [Design tokens](reference/design-tokens.md) — the pure-black palette and usage.
- [Commands](reference/commands.md) — the command registry and shortcuts.

## Architecture

- [Overview](architecture/overview.md) — the system map and guiding principles.
- [Process model](architecture/process-model.md) — renderer, preload, main.
- [IPC layer](architecture/ipc-layer.md) — the typed bridge and its contracts.
- [Main process](architecture/main-process.md) — boot, managers, and wiring.
- [Renderer process](architecture/renderer-process.md) — shell, stores, features.
- [Data flow](architecture/data-flow.md) — the unified streaming timeline.
- [Security model](architecture/security-model.md) — the hardening patterns.
- [Repository structure](architecture/repository-structure.md) — why each directory
  exists.
- Subsystems:
  [Workspace Manager](architecture/subsystems/workspace-manager.md),
  [Session Manager](architecture/subsystems/session-manager.md),
  [Git Engine](architecture/subsystems/git-engine.md),
  [Terminal Manager](architecture/subsystems/terminal-manager.md),
  [File System Layer](architecture/subsystems/file-system-layer.md),
  [Agent Manager](architecture/subsystems/agent-manager.md),
  [Memory System](architecture/subsystems/memory-system.md),
  [Database](architecture/subsystems/database.md),
  [Settings](architecture/subsystems/settings.md).

## Contributing

- [Development workflow](contributing/development-workflow.md)
- [Coding standards](contributing/coding-standards.md)
- [Pull requests](contributing/pull-requests.md)
- [Testing and verification](contributing/testing-and-verification.md)
- [Documentation standards](contributing/documentation-standards.md)

See also the root [CONTRIBUTING.md](../CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Operations

For maintainers:
[release process](operations/release-process.md),
[versioning](operations/versioning.md),
[CI/CD](operations/ci-cd.md),
[packaging and signing](operations/packaging-and-signing.md),
[installer and updates](operations/installer-and-updates.md),
[dependency updates](operations/dependency-updates.md),
[debugging](operations/debugging.md),
[security audits](operations/security-audits.md).

## Documentation conventions

Every page describes current reality and marks unbuilt work as "Planned". Pages are
terse and technical, open with a short rationale before mechanics, and contain no
emojis. File paths are written as repo-relative inline code. See
[documentation standards](contributing/documentation-standards.md).
