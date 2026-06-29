# Quick start

This walks through the core loop: open a workspace, start a session, and send your
first prompt. It assumes you have Limboo running from source (see
[Installation](installation.md)).

## 1. Open a workspace

A **workspace** is a complete project: a directory, its detected tech stack, its git
state, and its sessions. On first launch the shell shows a workspace launcher.

- Pick a directory through the launcher, or drag a folder onto the window.
- Limboo validates the path (it rejects system roots and your home directory
  itself), detects the tech stack (git, Node.js, Python, Docker, lockfiles), and
  begins watching and indexing it.

See [Workspaces](../concepts/workspaces.md).

## 2. Start a session

The left sidebar holds **sessions** and nothing else. A session bundles a branch,
chat history, the agent, terminal history, checkpoints, and memory into one
workspace.

- Create a session (command palette: `Cmd/Ctrl+K` then "New session", or
  `Cmd/Ctrl+N`).
- The center column is the conversation; the composer is docked at its bottom.

See [Sessions](../concepts/sessions.md).

## 3. Choose a mode

The agent runs in one of two modes:

- **Plan** — the agent produces a review-first plan you approve before any changes.
- **Implement** — the agent works directly, requesting approval for risky tools.

Switch modes from the command palette ("Switch to Plan mode" / "Switch to Implement
mode") or the composer. See [Using the agent](../guides/using-the-agent.md).

## 4. Send your first prompt

Type an intent, not a file. For example:

```
Add a health-check endpoint and a test for it.
```

As the agent works, the conversation renders one continuous, turn-grouped timeline:
the streaming reply, inline tool cards (Read / Edit / Bash / and so on), file
changes, and status markers. When the agent wants to run a risky tool, an inline
approval appears; approve or deny it, optionally remembering the choice for the
session. See [Data flow](../architecture/data-flow.md).

## 5. Watch the activity drawer

The right side is a fixed icon rail plus a collapsible drawer. Its tabs visualize
what the agent is doing:

- **Files** — the indexed workspace tree.
- **Changes / Git** — working-tree status and diffs.
- **Tasks** — the agent's task list.
- **Activity** — an audit feed of tool calls and file changes.
- **Terminal** — integrated shells; agent commands are mirrored here.
- **Memory** — durable project knowledge and proposals.

## 6. Commit and checkpoint

Limboo creates a lightweight **checkpoint** before the agent's first change in a run,
so you can restore instantly. When you are satisfied, stage and commit from the git
workspace, then push. See [Git workflow](../guides/git-workflow.md).

## Next steps

- [Configuration](configuration.md) — tune appearance, agent, git, and memory.
- [Keyboard shortcuts](../guides/keyboard-shortcuts.md).
- [Memory system](../guides/memory-system.md) — teach Limboo durable project
  knowledge.
