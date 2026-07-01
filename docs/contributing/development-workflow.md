# Development workflow

This page describes the day-to-day loop for working in Limboo. The high-level
contract is in the root [CONTRIBUTING.md](../../CONTRIBUTING.md); this expands it.

## Setup

```bash
npm install     # installs deps; may compile better-sqlite3 (node-pty ships a prebuilt)
npm start       # Electron + Vite (renderer on :5173). There is no npm run dev.
```

Prerequisites: Node 20+, npm, and a C/C++ toolchain. See
[installation](../getting-started/installation.md).

## Orient yourself

1. Read [`CLAUDE.md`](../../CLAUDE.md) and skim [`project.md`](../../project.md).
2. Read the [architecture overview](../architecture/overview.md) and the
   [process model](../architecture/process-model.md).
3. Find the relevant area using [repository structure](../architecture/repository-structure.md):
   UI is `src/renderer/**`, state is `src/renderer/stores/`, OS work is
   `src/main/**`, the bridge is `src/preload/index.ts`, contracts are
   `src/shared/**`.

## Make the change

- **UI / view state** — work in `src/renderer/**`; put logic in a Zustand store, not
  a component. New domains get a `features/<domain>/` folder and a store.
- **A new OS capability** — follow the full bridge path: channel
  (`src/shared/ipc-channels.ts`) -> handler (`src/main/ipc/*Handlers.ts` via
  `handle()`) -> preload method (`src/preload/index.ts`) -> renderer call. See
  [the IPC layer](../architecture/ipc-layer.md).
- **Theme** — use tokens; add new tokens in the `@theme` block of
  `src/renderer/styles/index.css`. See [design tokens](../reference/design-tokens.md).

Keep changes small and single-responsibility.

## Verify

```bash
npm run lint
npx vite build --config vite.renderer.config.mts
```

For main / preload changes, confirm the app still starts with `npm start`. Do not use
`tsc` to verify. See [testing and verification](testing-and-verification.md).

## HMR and dev notes

- The renderer hot-reloads through Vite; main / preload changes require a restart of
  `npm start`.
- The main process retries the Vite dev server on launch and shows a diagnostic page
  if it never comes up.
- Logs are written by the main-process logger to a file under the user-data
  directory; see [debugging](../operations/debugging.md).

## Open a pull request

Branch off `main`, push, and open a PR using the template. See
[pull requests](pull-requests.md).
