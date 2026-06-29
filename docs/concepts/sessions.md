# Sessions

A session is the unit of work in Limboo. Everything you do happens inside one. This
page explains what a session is and why the whole application is organized around it.

## Why sessions

Traditional IDEs organize work around files and windows. Limboo organizes it around
sessions, because an AI development task is not "edit this file" — it is a unit of
intent ("implement authentication") that spans many files, commands, and decisions.
A session captures the entire context of that intent in one place, so you can leave
it, return to it, duplicate it, or trash it without losing anything.

## What a session contains

A session bundles, for one workspace:

- a branch and chat history,
- the coding agent and its transcript,
- terminal history,
- git checkpoints,
- permissions and approvals,
- context and memory,
- tasks and generated files,
- execution history.

Instead of opening many windows, everything lives inside one workspace view: the
left sidebar lists sessions, the center is the conversation, and the right drawer
visualizes the activity.

## Lifecycle

Sessions are owned by the main-process Session Manager and persisted in SQLite.
Their lifecycle:

- **Create** — a new session starts with a default title; the title is derived
  automatically from your first prompt.
- **Active** — exactly one session is active at a time; switching clears its unread
  count.
- **Update** — rename, pin, archive. Pinned sessions sort first.
- **Duplicate** — clone a session, its transcript, and its activity into a fresh
  one.
- **Trash and restore** — sessions are soft-deleted (recoverable) before they are
  purged.
- **Mode** — each session remembers whether it was last in plan or implement mode.

Sessions render as flat, message-style rows (a status dot, a title, and meta), not
cards. The active row uses a left accent bar.

## How sessions relate to other subsystems

- The **Agent Manager** persists each session's transcript, activity, and
  diagnostics, and resumes the underlying SDK session across turns.
- The **Git Engine** stores checkpoints per session under a private ref namespace.
- The **File System Layer** pushes live git status (branch and diff counts) into the
  session rows.

## See also

- [Workspaces](workspaces.md) — the container a session belongs to.
- [Session Manager architecture](../architecture/subsystems/session-manager.md).
- [Conversation-first UI](conversation-first-ui.md).
