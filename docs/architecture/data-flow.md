# Data flow: the unified streaming timeline

The most important runtime data path in Limboo is the agent event stream that becomes
the conversation. Understanding it explains how a single prompt turns into the
streaming reply, the inline tool cards, the file changes, the task list, and the git
refresh you see. It is deliberately a renderer-only fold over one event stream —
there is no separate streaming manager.

## End-to-end path

```
 user prompt
     |  window.limboo.agent.send(sessionId, prompt, mode?)
     v
 AgentManager (main)  runs the Claude Code SDK, emits structured AgentEvents
     |  IpcEvents.agentEvent  ("agent:event")
     v
 window.limboo.agent.onEvent(cb)   (preload subscription)
     |
     v
 useAgentStore.apply(event)   upserts into bySession[sessionId] snapshot
     |
     v
 ConversationView   folds the snapshot into chronological, turn-grouped rows
```

## The event stream

The main process streams a union of structured `AgentEvent`s (defined in
[`src/shared/types.ts`](../../src/shared/types.ts)), including: `message-start`,
`message-delta`, `message-done`, `tool-start`, `tool-end`, `file-change`,
`activity`, `tasks`, `plan`, `result`, `error`, `request-state`, and `diagnostic`.

## Store application

`useAgentStore.apply(event)` mutates state:

- Global events: `request-state` updates the active request phase / outcome;
  `diagnostic` appends to a bounded diagnostics ring.
- Per-session events upsert into the `bySession[sessionId]` snapshot:
  `message-start` / `message-done` upsert messages (deduped by id);
  `message-delta` mutates the streaming message and flags it streaming; `tool-start`
  appends a tool call; `tool-end` updates its status; `file-change` upserts changes
  (deduped by path); `activity` appends; `tasks` replaces; `plan` updates.

A snapshot is also fetched on session load (`agent:getSnapshot`) so an existing
transcript renders immediately.

## Turn folding in the renderer

`ConversationView` folds the snapshot into turns. A user message opens a turn; the
assistant's text blocks, tool calls, and status markers are collected, sorted by
timestamp, and grouped into that turn. The result renders as:

- a compact user bubble, then
- an assistant block with markdown text (a shimmer skeleton while streaming), inline
  tool cards with status badges (running / done / denied / error), status markers,
  and an inline approval when a permission is pending.

## Why renderer-only

The timeline is purely a view over the snapshot, so it lives entirely in the
renderer. The main process is responsible for producing correct, persisted events;
the renderer is responsible for presenting them. This keeps the process boundary
clean and means timeline changes never require touching the main process. See
[the renderer process](renderer-process.md) and
[the Agent Manager](subsystems/agent-manager.md).

## Other live streams

The same one-way event pattern drives the rest of the live UI: `fs:tree-changed` and
`fs:index-progress` (file tree), `terminal:data` / `terminal:exit` /
`terminal:command` (terminal), `git:changed` / `git:checkpoints-changed` (git), and
`memory:changed` (memory). Each is consumed by its store's subscription. See
[the IPC channels reference](../reference/ipc-channels.md).
