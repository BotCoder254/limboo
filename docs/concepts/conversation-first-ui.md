# Conversation-first UI

Limboo's interface revolves around a conversation, not a file tree. This page
explains the idea and how the three-pane shell expresses it.

## Files vs conversations

A traditional IDE asks "which file should I edit?". Limboo asks you to state intent:

```
Implement authentication.
```

The coding agent figures out the files; Limboo visualizes the process. The
conversation is the primary surface, and the file tree, diffs, tasks, and terminal
are supporting views that show what the conversation produced.

## The three-pane shell

The shell is a single column with a frameless title bar on top and a horizontal row
of resizable regions below it:

```
+----------------------------------------------------------------+
|  TitleBar (frameless, draggable)            [search][_][o][x]   |
+--------+------------------------------------------+------------+
|Sessions|  header / conversation / composer        | drawer |rail|
+--------+------------------------------------------+------------+
```

- **Left** is sessions and nothing else — no explorer, no git tree, no debugger, no
  extensions panel.
- **Center** is the conversation: a session header, the scrollable conversation, and
  a docked composer. The composer lives only inside the center column.
- **Right** is a fixed icon rail plus a collapsible drawer whose tabs (Files,
  Changes / Git, Tasks, Activity, Terminal, Memory) visualize the work.

The interface intentionally gives almost all space to the conversation. Everything
else collapses out of the way.

## The unified timeline

The conversation is one continuous, turn-grouped event stream. A user message opens
a turn; the agent's reply, its inline tool cards, file changes, and status markers
fill it, sorted chronologically. Streaming text shows a shimmer skeleton until it
settles. This is a renderer-only concern folded from the agent event stream — there
is no separate streaming manager. See [Data flow](../architecture/data-flow.md).

## Minimal by design

The product rule is restraint: no dozens of toolbars, no light mode, no gradients, a
single pure-black surface. The visual system is documented in
[design tokens](../reference/design-tokens.md). The principle comes from
[`project.md`](../../project.md) §3 "Minimal UI" and §11 "Center Workspace".
