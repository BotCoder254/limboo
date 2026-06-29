# Subsystem: Settings

## Purpose

The Settings subsystem owns persistent user preferences. It exists so the renderer
has a single, validated, migrated source of preferences that survives restarts and
stays consistent across windows. The user-facing tour is
[Configuration](../../getting-started/configuration.md); the field reference is
[Settings](../../reference/settings.md).

Source: [`src/main/managers/SettingsManager.ts`](../../../src/main/managers/SettingsManager.ts),
with defaults and limits in [`src/shared/constants.ts`](../../../src/shared/constants.ts).

## Responsibilities

- Load `settings.json` from the user-data directory on construction.
- Deep-merge with `DEFAULT_SETTINGS` so new keys appear automatically.
- Clamp numeric ranges to valid bounds; migrate on a version change.
- Broadcast changes to all renderers and notify in-process listeners.

## Public surface

- `getAll()`, `set(patch)`, `reset()` — reached via the `settings:*` channels.
- In-process listeners — for example the Agent Manager re-tunes its heartbeat when
  connection settings change.

## Shape

`AppSettings` groups: `appearance`, `layout`, `behavior`, `agent` (including
`connection`, `plan`, and `terminal`), `git` (including `push` and `pull`), and
`memory`. The current `SETTINGS_VERSION` is 7. See the
[settings reference](../../reference/settings.md) for fields, defaults, and clamps.

## Persistence and propagation

Settings are written back to disk immediately after construction (so migrations
persist) and on every change. A change broadcasts `settings:changed` to all windows;
`useSettingsStore` mirrors it and applies appearance side effects (font-scale CSS
variable, density and reduced-motion attributes). Renderer writes go through
`settings:set` (write-through). The layout store persists live widths into
`settings.layout` debounced.

## Security boundary

`set` rejects patches containing prototype-polluting keys, and the deep-merge skips
`__proto__` / `constructor` / `prototype`. This guard is the template for every
future renderer-supplied object that is merged or used as a key. See
[the security model](../security-model.md).
