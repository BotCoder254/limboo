# Using the agent

Limboo orchestrates a coding agent; it is not the agent itself. This guide explains
how to drive it: authentication, modes, permissions, and recovery. The internals are
documented in the [Agent Manager architecture](../architecture/subsystems/agent-manager.md).

## The boundary

Limboo is to the coding agent what a git GUI is to `git`: it shells out to a capable
engine and provides the environment around it. The agent (Claude Code, via
`@anthropic-ai/claude-agent-sdk`) owns reasoning and authentication. Limboo owns the
workspace, the permission gate, memory injection, and the transcript.

## Authentication

Limboo never stores credentials. It probes for an existing sign-in:

- environment variables: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or
  `CLAUDE_CODE_OAUTH_TOKEN`, or
- the Claude Code credentials file in your home directory.

If none is found, the agent reports an `auth-required` state. Sign in to Claude Code
as usual, then use "retry auth" so Limboo re-probes. Questions about provider
pricing or model behavior belong with the agent / provider, not Limboo.

## Plan vs implement

- **Plan mode** — the agent produces a review-first plan and stops. You approve,
  reject, or regenerate (optionally with extra instructions). Only on approval does
  it act. Plan artifacts are persisted per session.
- **Implement mode** — the agent works directly, pausing only for tool approvals.

Each session remembers its last mode. Switch from the composer or the command
palette.

## Tool permissions

Every tool the agent wants to use is classified by risk:

- **read** — Read, Glob, Grep, LS, WebSearch, WebFetch, and similar. Auto-approved
  when "auto-approve reads" is on.
- **write** — Write, Edit, MultiEdit, NotebookEdit.
- **command** — Bash and other shell tools (the default for unknown / MCP tools).

When a risky tool is requested, an inline approval appears in the conversation
showing the tool and a preview. Approve or deny it; you can remember the decision for
the session and risk level. Memory and git read tools are auto-allowed because they
carry no risk. The strictness is tuned by the agent permission mode and
`git.commandApproval` setting.

All file tools are path-guarded to the active workspace root.

## What you see while it runs

The conversation renders a single turn-grouped timeline: streaming reply text,
inline tool cards with status badges (running, done, denied, error), file changes,
task lists, and status markers. The activity drawer mirrors the same events as a
files tree, git changes, a task list, an audit feed, and the terminal. See
[Data flow](../architecture/data-flow.md).

## Checkpoints and safety

Before the agent's first write or command in a run, Limboo creates a lightweight git
checkpoint labeled "Before agent changes" (when auto-checkpoint is enabled), so you
can restore the working tree instantly. See [Git workflow](git-workflow.md).

## Recovery

The agent runs a heartbeat and recovers transparently from transient failures
(sockets, timeouts) with bounded backoff. Auth and rate-limit failures escalate the
lifecycle state and surface in the UI rather than silently retrying. A diagnostics
console records the lifecycle / request / recovery timeline.

## Memory injection

When memory is enabled, Limboo retrieves the most relevant durable project knowledge
for your prompt and injects it into the agent's system context before the prompt
reaches the agent. The agent can also query memory through read-only tools. See
[Memory system](memory-system.md).
