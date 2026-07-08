# Configuration

Limboo persists user preferences as a single `AppSettings` object. This page is a
task-oriented tour of the settings categories; the exhaustive field list, defaults,
and clamps are in the [settings reference](../reference/settings.md).

## Where settings live

Settings are owned by the main process and stored at `settings.json` under the OS
user-data directory. The renderer mirrors them through a Zustand store and writes
changes back through the validated `settings:set` IPC channel (write-through). On
load they are deep-merged with defaults (new keys appear automatically), clamped to
valid ranges, and migrated when the schema version changes. See
[the Settings subsystem](../architecture/subsystems/settings.md).

You normally change settings from the in-app Settings modal (`Cmd/Ctrl+,`), not by
editing the file.

## Categories

### Appearance

- **Density** — comfortable or compact row spacing.
- **Font scale** — global text scale (clamped roughly 0.85 to 1.3), applied as a CSS
  variable.
- **Reduced motion** — disables animations; also respects the OS preference.

The theme itself is fixed: dark mode only on a true `#000000` background. There is no
light mode or theme toggle. See [design tokens](../reference/design-tokens.md).

### Layout

Sidebar widths, the active activity tab, whether sessions are collapsed, and the
terminal/git drawer widths. These persist (debounced) as you resize.

### Behavior

- **Notifications** — desktop notifications on or off.
- **Minimize to tray**.

### Agent

The largest category. Highlights:

- **Providers** — connection status per coding agent. Claude Code reuses its own
  local login. **Cursor** (authentication only for now) connects via
  `cursor-agent login` — with an optional manual-browser mode that prints the
  login URL — or a Cursor API key stored encrypted via the OS keychain
  (`safeStorage`); the key is never written to settings files or shown again.
- **Model** — the Claude model the agent uses (Opus 4.8, Sonnet 4.6, Haiku 4.5).
- **Permission mode** — how aggressively tool calls are auto-approved.
- **Web search**, **auto-approve reads**, **max turns**.
- **Connection** — heartbeat interval, reconnect delay, recovery attempts, idle
  timeout, auto-restart, session persistence.
- **Plan** — default mode, incremental streaming, task auto-expand, risk
  highlighting, export format.
- **Terminal** — shell, font, cursor, scrollback, and whether agent commands are
  mirrored into the integrated terminal.

See [Using the agent](../guides/using-the-agent.md).

### Git

- **User identity** — name and email used for commits (blank falls back to your git
  config).
- **Auto-checkpoint** — create a recovery checkpoint before agent changes.
- **Max checkpoints** kept per session.
- **Command approval** — how risky shell commands are gated
  (`destructive` / `all` / `none`).
- **Push** — auto set-upstream, confirm force-push (force always uses
  `--force-with-lease`).
- **Pull** — strategy (`ff-only` or `rebase`).

See [Git workflow](../guides/git-workflow.md).

### Memory

- **Enabled** and **inject into prompt**.
- **Max injected** memories per prompt.
- **Auto-capture** policy (`propose` / `auto` / `off`) and the auto-accept confidence
  threshold.
- **Expiry** — flag unpinned memories stale after N days (never deletes).

See [Memory system](../guides/memory-system.md).

## Resetting

The Settings modal can reset to defaults. This rewrites `settings.json` from
`DEFAULT_SETTINGS` and re-applies appearance side effects.
