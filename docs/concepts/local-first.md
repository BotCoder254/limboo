# Local-first

Local-first is the defining property of Limboo. This page explains what it means
here and what it implies for privacy, data ownership, and the network.

## What local-first means

Nothing in Limboo requires a server. The project belongs to the developer; so do its
data, history, and memory. Limboo coordinates everything on the local machine and
gets out of the way. There is no Limboo backend to sign in to, no account, and no
cloud sync.

## The only network traffic

The single outbound connection is the **connected coding agent talking to its AI
provider**. Limboo itself makes no other network calls: no telemetry, no analytics,
no update beacons baked into the app's core behavior. If the agent is not running,
Limboo is fully offline-capable for everything it owns: workspaces, sessions, git,
terminals, file indexing, and memory.

## No stored credentials

Limboo never stores agent or remote-git credentials:

- The **coding agent** owns its own authentication. Limboo reads an existing sign-in
  (environment variables or the agent's credentials file) but does not persist it.
- **Git remotes** use your own credential helper or SSH agent. Embedded-credential
  remote URLs are redacted from results and logs.

## Where your data lives

All persistent state is on disk under the OS user-data directory:

- `limboo.db` — SQLite (sessions, transcripts, memories, checkpoints, diagnostics).
- `settings.json` — preferences.
- `window-state.json` — window geometry.
- a main-process log file.

Because everything is local, the offline retrieval used by the
[Memory System](../guides/memory-system.md) is built on SQLite FTS5 / BM25 rather
than a hosted embeddings API.

## Why this matters

Local-first is what makes the other principles achievable: it keeps the app fast
(no round-trips), private (data never leaves the machine), and recoverable (state is
on disk you control). It also shrinks the security surface to almost nothing; see
[the security model](../architecture/security-model.md).

## See also

- [`project.md`](../../project.md) §6 "Why No Backend?" and §7 "Local First
  Architecture".
- [Security model](../architecture/security-model.md).
