# Repository structure

Contributors should be able to understand why every directory exists without
inferring it from names. This page is the map. It complements
[`CLAUDE.md`](../../CLAUDE.md) §3, which carries the same structure at the code level.

## Top level

```
limboo/
|-- CLAUDE.md                 code-level working contract for agents/contributors
|-- project.md                full product / architecture vision
|-- README.md                 landing page
|-- docs/                     the documentation subsystem (this site)
|-- index.html                renderer HTML entry (loads src/renderer/main.tsx)
|-- forge.config.ts           Electron Forge config (entries, makers, icon)
|-- vite.main.config.ts       Vite build: main process
|-- vite.preload.config.ts    Vite build: preload
|-- vite.renderer.config.mts  Vite build: renderer (React + Tailwind); ESM (.mts)
|-- tsconfig.json             TS config (jsx, DOM libs, path aliases)
|-- .eslintrc.json            ESLint
|-- .github/                  repository automation and policy (CI, templates, ...)
|-- assets/                   bundled static assets (icon.svg/png, tray.png)
|-- package.json
`-- src/                      all application source
```

The renderer Vite config is `.mts` (ESM) because `@tailwindcss/vite` is ESM-only and
the project is CommonJS; the extension forces ESM loading. Both process entries are
`index.ts`, so their output names are pinned in the Vite configs to avoid a
basename collision on `index.js` (see [`CLAUDE.md`](../../CLAUDE.md) §6).

## `src/`

```
src/
|-- global.d.ts          ambient types for window.limboo (from preload)
|-- shared/              code shared across ALL processes
|   |-- ipc-channels.ts    channel name constants (the contract)
|   |-- types.ts           domain models (Session, Workspace, AgentEvent, Memory, ...)
|   `-- constants.ts       DEFAULT_SETTINGS, limits, clamp()
|-- main/                MAIN process (Node / OS owner)
|   |-- index.ts           entry: lifecycle, hardening, wires managers + IPC
|   |-- logger.ts          logging + secret redaction + global handlers
|   |-- storage.ts         atomic JSON read/write under userData
|   |-- paths.ts           asset path resolver
|   |-- sendCommand.ts     native menu/tray -> renderer command bridge
|   |-- window/            createWindow.ts (frameless, sandbox) + windowState.ts
|   |-- db/                database.ts (SQLite schema + migrations)
|   |-- managers/          one manager per responsibility (+ git/, fs/, memory/,
|   |                      search/, voice/, workspace/, worktree/ (worktree
|   |                      lifecycle + limboo.json), services/ (Scripts &
|   |                      Services supervisor + localhost proxy) submodules;
|   |                      git/refs.ts sanitizes user-supplied refs)
|   `-- ipc/               registry.ts (handle wrapper) + *Handlers (incl.
|                          worktreeHandlers, serviceHandlers) + registerAllIpc
|-- preload/
|   `-- index.ts           the ONLY bridge — exposes window.limboo.*
`-- renderer/            React UI (presentation only)
    |-- main.tsx           entry: ErrorBoundary + hydration gate
    |-- App.tsx            composes the shell + overlays + hooks
    |-- styles/index.css   Tailwind import + pure-black tokens
    |-- app/AppShell.tsx   the resizable 3-region layout
    |-- components/        ui primitives, layout, brand, feedback
    |-- features/          one folder per domain (sessions, workspace, activity,
    |                      git, terminal, memory, agent, command-palette, settings)
    |-- stores/            Zustand slice stores (one per domain)
    |-- hooks/             useResizable, useKeyboardShortcuts, useCommandBridge, ...
    `-- lib/               cn, debounce, format, commands (registry), highlight
```

## Where to make a change

| You want to change... | Go to |
| --------------------- | ----- |
| UI / layout / a panel | `src/renderer/**` (features, components, app/AppShell) |
| View state for a domain | `src/renderer/stores/` |
| An OS-touching capability | `src/main/**` (a manager + an `ipc/*Handlers.ts`) |
| The renderer-main contract | `src/preload/index.ts` + `src/shared/ipc-channels.ts` |
| A shared type / default | `src/shared/{types,constants}.ts` |
| The theme | `src/renderer/styles/index.css` (`@theme`) |
| Repository automation | `.github/` |
| Documentation | `docs/` and the root community-health files |

Do not edit generated output in `.vite/` or `node_modules/`. See
[the main](main-process.md) and [renderer](renderer-process.md) pages for the detail.
