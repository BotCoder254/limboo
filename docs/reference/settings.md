# Reference: settings

Limboo persists one `AppSettings` object. The source of truth is
[`src/shared/constants.ts`](../../src/shared/constants.ts) (`DEFAULT_SETTINGS` plus
the `*_LIMITS` tables the main process clamps against) and
[`src/shared/types.ts`](../../src/shared/types.ts) (the `AppSettings` shape). This
page summarizes the defaults; the constants file is authoritative.

Settings are stored at `settings.json` under the OS user-data directory, deep-merged
with defaults on load, clamped, and migrated when `SETTINGS_VERSION` changes. See
[the Settings subsystem](../architecture/subsystems/settings.md).

The current `SETTINGS_VERSION` is **7**.

## appearance

| Field | Default | Notes |
| ----- | ------- | ----- |
| `density` | `comfortable` | row spacing |
| `fontScale` | `1` | clamped 0.85 - 1.3 |
| `reducedMotion` | `false` | also respects OS preference |

## layout

| Field | Default | Notes |
| ----- | ------- | ----- |
| `leftWidth` | `264` | clamped 200 - 420 |
| `rightWidth` | `320` | clamped 240 - 560 |
| `activeTab` | `files` | active activity tab |
| `sessionsCollapsed` | `false` | |
| `terminalOpen` | `false` | |
| `terminalWidth` | `480` | clamped 320 - 900 |
| `gitWidth` | `560` | clamped 360 - 1000 |

## behavior

| Field | Default |
| ----- | ------- |
| `minimizeToTray` | `false` |
| `notifications` | `true` |

## agent

| Field | Default | Notes |
| ----- | ------- | ----- |
| `model` | `claude-sonnet-4-6` | one of Opus 4.8 / Sonnet 4.6 / Haiku 4.5 |
| `thinking` | `adaptive` | |
| `permissionMode` | `approve-edits` | |
| `webSearch` | `true` | |
| `autoApproveReads` | `true` | |
| `maxTurns` | `24` | clamped 1 - 100 |
| `logVerbosity` | `normal` | |

`agent.connection` (heartbeat / recovery): `heartbeatInterval` `30000`,
`reconnectDelay` `1000`, `maxRecoveryAttempts` `3`, `heartbeatFailureThreshold` `2`,
`idleTimeout` `300000`, `autoRestart` `true`, `sessionPersistence` `true`,
`connectivityNotifications` `true`.

`agent.plan`: `defaultMode` `plan`, `streamIncrementally` `true`,
`autoExpandTasks` `true`, `highlightRisk` `true`, `defaultExportFormat` `md`, plus
display toggles.

`agent.terminal`: `shell` `''` (OS default), `fontSize` `13`, `cursorStyle` `block`,
`cursorBlink` `true`, `scrollback` `5000`, `copyOnSelect` `false`, `confirmKill`
`true`, `mirrorAgentCommands` `true`.

## git

| Field | Default | Notes |
| ----- | ------- | ----- |
| `userName` / `userEmail` | `''` | blank falls back to git config |
| `suggestCommitFromConversation` | `true` | |
| `autoCheckpoint` | `true` | checkpoint before agent changes |
| `maxCheckpoints` | `50` | clamped 1 - 200 |
| `confirmBranchSwitchWithChanges` | `true` | |
| `commandApproval` | `destructive` | `destructive` / `all` / `none` |
| `push.autoSetUpstream` | `true` | |
| `push.confirmForcePush` | `true` | force always uses `--force-with-lease` |
| `pull.strategy` | `ff-only` | `ff-only` / `rebase` |

## memory

| Field | Default | Notes |
| ----- | ------- | ----- |
| `enabled` | `true` | |
| `injectIntoPrompt` | `true` | |
| `maxInjected` | `8` | clamped 0 - 24 |
| `autoCapture` | `propose` | `propose` / `auto` / `off` |
| `autoAcceptConfidence` | `0` | threshold 0 - 1 |
| `expiry.enabled` | `true` | |
| `expiry.staleDays` | `180` | clamped 7 - 3650 |

## Related limits

Other bounds enforced by the main process live in the same constants file:
`AGENT_LIMITS`, `AGENT_CONNECTION_LIMITS`, `LAYOUT_LIMITS`, `TERMINAL_LIMITS`,
`GIT_LIMITS`, `MEMORY_LIMITS`, `FS_LIMITS`, `SESSION_LIMITS`, `WORKSPACE_LIMITS`,
`WINDOW_MIN` / `WINDOW_DEFAULT`, plus `DEFAULT_WORKSPACE_CONFIG`,
`DEFAULT_IGNORED_DIRS`, and `FORBIDDEN_WORKSPACE_PATHS`.
