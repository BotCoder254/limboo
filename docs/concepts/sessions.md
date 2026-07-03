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
- execution history,
- optionally, a dedicated **git worktree** (its own checkout directory +
  branch) and the **services** declared by the repo's
  [limboo.json](../reference/limboo-json.md).

Instead of opening many windows, everything lives inside one workspace view: the
left sidebar lists sessions, the center is the conversation, and the right drawer
visualizes the activity.

## Worktree-backed sessions

A session can own an isolated engineering environment: **New session in
worktree** (`Mod+Shift+N`) provisions a fresh checkout + branch via
`git worktree add`, so several sessions — each with its own agent, terminals,
and services — proceed in parallel without contending for one working tree.

- An editor-style **tab strip** appears above the session header whenever at
  least one worktree session exists (`Ctrl+Tab` / `Ctrl+Shift+Tab` cycles).
- Everything that executes for the session (agent, terminals, git, search,
  file watching) runs in its **effective root** — the worktree while it is
  healthy, the workspace checkout otherwise.
- If the worktree directory vanishes outside Limboo, the session is flagged
  `missing` and a banner offers **Recreate** (from the surviving branch or the
  base ref) or **Detach** (revert to a plain session).
- Archiving can optionally tear the directory down (`teardownOnArchive`) while
  keeping the branch, and unarchiving recreates the environment from it.
- Deleting a session that owns a worktree or branch opens a **delete dialog**
  summarizing its dependencies (worktree dirtiness, branch, terminals,
  checkpoints, memory links, plan) with explicit remove-worktree /
  delete-branch choices; plain sessions keep the one-click delete.

Sessions can also be organized into **folders** and **tags** from the row menu;
the sidebar groups by folder.

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
- The **Worktree Manager** owns each session's checkout lifecycle and resolves
  its effective execution root for every other manager.
- The **Service Manager** supervises the session's declared dev services and
  scripts (the strip under the session header), gated behind the limboo.json
  approval dialog.

## See also

- [Workspaces](workspaces.md) — the container a session belongs to.
- [Session Manager architecture](../architecture/subsystems/session-manager.md).
- [Worktree Manager architecture](../architecture/subsystems/worktree-manager.md).
- [Service Manager architecture](../architecture/subsystems/service-manager.md).
- [Conversation-first UI](conversation-first-ui.md).
