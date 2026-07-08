# Subsystem: Agent Manager

## Purpose

The Agent Manager orchestrates the coding agent. It is the single most important
distinction in the architecture: Limboo is **not** the agent — it is the operating
environment around it, the way a git GUI shells out to `git`. The agent
(`@anthropic-ai/claude-agent-sdk`) owns reasoning and authentication; the Agent
Manager owns the workspace boundary, the permission gate, memory injection, and the
persisted transcript. See the [Using the agent guide](../../guides/using-the-agent.md).

Source: [`src/main/managers/AgentManager.ts`](../../../src/main/managers/AgentManager.ts)
with `managers/memory/memoryTools.ts`.

## Responsibilities

- Run prompts through the SDK in plan and implement modes.
- Gate tool calls by risk (`canUseTool`) and path-guard them to the workspace.
- Retrieve and inject relevant memories into the system prompt.
- Persist transcript, activity, and diagnostics; resume SDK sessions.
- Monitor connection health and recover transparently.

## Authentication and capability

`probeHealth()` checks for an existing sign-in (the `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or `CLAUDE_CODE_OAUTH_TOKEN` env vars, or the Claude Code
credentials file) and reports `AgentInstall`. Limboo stores no Anthropic
credentials. `retryAuth()` forces a re-probe after the user signs in again.

### Cursor authentication (Agent Adapter Architecture, Phase 1)

Cursor is the second provider, currently **authentication only** — it cannot run
yet (`AGENT_MODELS` has no Cursor entries, so it is structurally unselectable as
the running agent). The code lives beside, not inside, this manager:

- `src/main/managers/cursor/CursorAuthManager.ts` — lazy local classification
  (`not-installed` / `not-authenticated` / `authenticated-cli` /
  `authenticated-api-key`), the interactive `cursor-agent login` child (single-
  flight, timeout-killed, manual-browser mode via `NO_OPEN_BROWSER=1` with a
  validated https URL surfaced to the UI), `logout`, and API-key lifecycle.
  State broadcasts on `agent:cursor-auth-changed` and never carries secrets.
- `src/main/managers/cursor/exec.ts` — argv-only `cursor-agent` runner (the
  `runGit` idiom): PATH resolution with a Windows `where.exe` fallback, batch
  shims bridged through `%ComSpec%` only with static-whitelisted literal args,
  bounded output, `redactCursor()` on everything captured.
- `src/main/secrets/SecretStore.ts` — the app's safeStorage-backed secret store
  (first consumer). The Cursor API key is encrypted at rest under
  `userData/secrets/`, decrypted only at child-spawn time (`getSpawnEnv()`),
  and never IPC'd, logged, or placed on argv.

`status --format json` output is parsed defensively (whitelisted scalars only);
`crsr_` tokens and `CURSOR_API_KEY=` values are redacted centrally in
`logger.ts` and in this manager's `redact()`.

## Lifecycle and recovery

The lifecycle runs `starting -> initializing -> ready | busy | not-installed |
auth-required | rate-limited | reconnecting`. A heartbeat (interval / retry / backoff
from settings) recovers from transient failures with bounded backoff; auth and
rate-limit failures escalate the lifecycle instead of retrying. A diagnostics ring
records the lifecycle / request / recovery timeline.

## Tool permission bridge (`canUseTool`)

Tools are classified: **read** (Read, Glob, Grep, LS, WebSearch, WebFetch, ...),
**write** (Write, Edit, MultiEdit, NotebookEdit), and **command** (Bash and the
default for unknown / MCP tools). Risky tools prompt the renderer via
`agent:permission-request`; "always allow" is remembered per session and risk level.
Memory and git read tools are auto-allowed. All file tools are path-guarded to the
active workspace root (`isInsideRoot`, symlink-aware). The strictness is tuned by the
agent permission mode and `git.commandApproval`.

## Plan mode

`mode: 'plan' | 'implement'` is stored per session. A plan run creates an
`agent_plans` row; `ExitPlanMode` captures the plan markdown for approval. The
renderer drives `approvePlan` / `rejectPlan` / `regeneratePlan(extra?)`.

## Memory injection and MCP

When memory is enabled, `memoryContextFor(sessionId, prompt)` retrieves ranked
memories and appends a context block to the agent's system prompt. The agent can also
query memory through a read-only MCP server (`list_memories`, `search_memories`,
`get_memory`) created by `memoryTools.ts`; these tools are auto-allowed.

## Persistence

The transcript lives in `agent_messages` (append-only user / assistant turns), the
audit feed in `agent_activity`, the SDK-session mapping in `agent_session_meta`,
diagnostics in `agent_diagnostics`, and plans in `agent_plans`. Snapshots are loaded
on session open. See [the database](database.md).

## Dependencies and wiring

Post-construction the manager is given the terminal (mirror commands), session
(auto-title), git (auto-checkpoint, live refresh), and memory (retrieve / inject)
managers. See [the main process](../main-process.md).

## Data flow

Sending a prompt persists the user turn, names an untitled session, optionally
creates a plan, then runs with recovery and streams structured `AgentEvent`s out via
`agent:event`. The renderer folds them into the timeline. See
[data flow](../data-flow.md).

## Security boundary

Path guarding to the workspace, risk-gated approvals, no stored credentials, and
auto-checkpoints before changes. Permission decisions reject prototype-polluting
keys. See [the security model](../security-model.md).
