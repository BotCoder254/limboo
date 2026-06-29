# Subsystem: Memory System

## Purpose

The Local Memory System preserves durable project knowledge across sessions and
providers and injects the most relevant entries into the agent prompt before it
reaches the harness. It is a provider-independent platform service owned by the app,
not the agent, and it is fully offline. See the
[Memory guide](../../guides/memory-system.md).

Source: [`src/main/managers/memory/MemoryManager.ts`](../../../src/main/managers/memory/MemoryManager.ts).

## Responsibilities

- Store tiered knowledge with confidence, usage, status, and expiry.
- Retrieve and rank relevant memories offline (FTS5 / BM25 fused with other signals).
- Build the prompt context block.
- Capture proposals from commits and conversations.
- Seed defaults per workspace / global scope; sweep stale entries.

## Storage

Three tables (see [the database](database.md)):

- `memories` — tiered knowledge (`workspace_id` is NULL for global / user scope).
- `memories_fts` — an FTS5 virtual table over title + body, kept in sync by triggers,
  used for BM25 keyword retrieval (no embeddings API).
- `memory_links` — back-links to the source (conversation, commit, file).

All access is parameterized.

## Tiers

From least to most authoritative, higher tiers outrank lower in retrieval:
`session < workspace < project < preference < convention < decision < solution`, plus
manual `note`. Tier weights bias ranking (decision highest, session lowest).

## Public surface (key methods)

- `seedDefaults(workspaceId|null)`
- `retrieve({workspaceId, sessionId, prompt, limit})` -> `MemoryHit[]`
- `buildContextBlock(hits)` -> the `<project-memory>` block
- `list(filter)`, `create(workspaceId?, input)`, `update(id, patch)`, `pin` /
  `unpin`, `archive`
- `proposeFromCommit(workspaceId, {hash, subject, body})`, `sweep()`

Reached via the `memory:*` channels.

## Retrieval and ranking

`retrieve` builds an FTS query from the prompt plus context (active files, branch),
then composite-scores candidates by BM25 relevance multiplied by recency, confidence,
usage, tier weight, and pin / workspace boosts, returning the top-K within a
character budget. `buildContextBlock` renders the selected memories into a
`<project-memory>` block appended to the agent system preset in the Agent Manager.
The ranking is fusion-ready, so a local vector layer could later be added on top of
BM25.

## Auto-capture

Commits and conversations become proposals (`status = 'proposed'`) the user accepts
or dismisses; policy is the `memory` settings (`propose` / `auto` / `off`, with a
confidence auto-accept threshold). Proposals are never injected until active.

## Defaults and maintenance

`seedDefaults` creates starter memories per workspace and for global scope on first
run (idempotent, meta-flagged). An hourly `sweep` flags stale, unpinned entries
(never deletes).

## Data flow

`memory:changed` is pushed to the renderer; `useMemoryStore` consumes it. The Memory
tab provides search, tier filters, proposals, and an inline composer.

## Security boundary

Parameterized FTS / SQL only; renderer inputs (title, body, query) length-capped via
`MEMORY_LIMITS`. See [the security model](../security-model.md).

## Planned

An optional local vector-embeddings layer fused on top of the existing BM25 ranking
is planned; see [ROADMAP.md](../../../ROADMAP.md).
