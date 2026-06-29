# Memory system

The Local Memory System preserves durable project knowledge across sessions and
providers and injects the most relevant entries into the agent prompt. It is a
platform service owned by the app, not by the agent. This guide is the user view;
the internals are in the [Memory System architecture](../architecture/subsystems/memory-system.md).

## Why memory exists

A coding agent forgets everything between runs. Decisions, conventions, preferences,
and hard-won solutions are exactly the knowledge you do not want to re-explain every
session. The Memory System captures that knowledge once and surfaces it
automatically, so the agent starts each task already aware of how this project works.

It is fully local and offline: retrieval uses SQLite FTS5 with BM25 keyword
relevance, not a hosted embeddings API.

## The Memory tab

The Memory tab in the activity drawer lists memories with search, tier filters, a
proposals queue, and an inline note composer. Settings for memory live under the
Memory category.

## Tiers

Memories are tiered from least to most authoritative; higher tiers outrank lower
ones in retrieval:

```
session < workspace < project < preference < convention < decision < solution
```

plus a manual `note` tier. Memories can be scoped to a workspace or to global / user
scope (for example, personal preferences that apply everywhere).

## Where memories come from

- **Manual** — write a note directly in the composer.
- **Proposals** — commits and conversations become proposed memories you accept or
  dismiss. The policy is the `memory.autoCapture` setting (`propose`, `auto`, or
  `off`) with a confidence threshold for auto-accept. Proposed memories are never
  injected until accepted.
- **Defaults** — starter memories are seeded per workspace and globally on first run
  so the panel is populated immediately (idempotent).

## Retrieval and injection

When you send a prompt (and memory injection is enabled), Limboo builds a search
query from the prompt plus context (active files, branch), scores candidate memories
by BM25 relevance fused with recency, confidence, usage, tier weight, and pin /
workspace boosts, and selects the top entries within a character budget. Those are
rendered into a context block appended to the agent's system prompt before it
reaches the agent.

The agent can also query memory on demand through read-only tools
(`list_memories`, `search_memories`, `get_memory`) exposed as an MCP server; these
are auto-allowed because they carry no risk.

## Maintenance

Pinned memories are never auto-flagged. An hourly sweep flags stale, unpinned
entries past the configured age — it flags, it never deletes. You can pin, archive,
edit, or remove memories at any time.

## See also

- [Configuration](../getting-started/configuration.md) — memory settings.
- [Memory System architecture](../architecture/subsystems/memory-system.md).
