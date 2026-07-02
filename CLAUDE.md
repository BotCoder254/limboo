# CLAUDE.md

Operational guide and deep context for any AI coding agent (Claude, etc.) working
in this repository. Read this first. It explains **what Limboo is**, **how the
code is organized**, **the rules you must follow**, and **what is and is not built
yet**.

> Companion document: [`project.md`](project.md) holds the full product/architecture
> vision. `CLAUDE.md` (this file) is the practical, code-level contract for working
> in the repo. When the two disagree about *current reality*, trust `CLAUDE.md`.

---

## 1. What is Limboo?

Limboo is a **local-first desktop application** that acts as the *operating system
for AI software development*. It is **not an AI model**. Instead, it provides the
environment around a connected coding agent: project management, sessions, file
watching, repository indexing, git operations, terminal execution, memory,
permissions, context, search, and UI.

Core idea: **every development task happens inside a Session**. A session bundles a
repository, branch, chat history, agent, terminal history, checkpoints,
permissions, context, memory, tasks, and generated files into one workspace.

Guiding principles (from `project.md` §4): Fast, Local, Private, Modular, Secure,
Responsive, Observable, Predictable, Recoverable. There is **no backend** — the
only network traffic is the connected coding agent talking to its AI provider.

---

## 2. Tech stack (current)

| Layer            | Choice                                      |
| ---------------- | ------------------------------------------- |
| Shell / desktop  | **Electron 42** (via **Electron Forge 7**)  |
| Bundler          | **Vite 5** (`@electron-forge/plugin-vite`)  |
| UI framework     | **React 19**                                |
| Language         | **TypeScript** (`~4.5`)                      |
| Styling          | **Tailwind CSS v4** (CSS-first, no config)  |
| State            | **Zustand 5** (slice-per-domain stores)     |
| Icons            | **lucide-react**                            |
| Packaging/makers | Squirrel (win), ZIP (mac), deb, rpm (linux) |

Notes / gotchas:

- `@vitejs/plugin-react` is pinned to the **v4** line on purpose. v6 requires
  Vite 8, but Electron Forge's Vite plugin pins **Vite 5** — installing v6 breaks
  peer resolution. If you bump Vite, re-check this.
- Tailwind v4 is **CSS-first**: there is **no `tailwind.config.js`** and **no
  `postcss.config.js`**. All design tokens live in an `@theme` block inside
  [`src/renderer/styles/index.css`](src/renderer/styles/index.css). The Vite
  plugin (`@tailwindcss/vite`) handles PostCSS/autoprefixer internally.
- TypeScript is old (`~4.5`). The renderer is transpiled by **esbuild via Vite**,
  not `tsc`, so type errors do **not** block the dev/build run. **Do not** rely on
  `tsc --noEmit` to verify — TS 4.5 cannot even parse the modern bundled
  `@types/node`. Verify instead with `npx vite build --config
  vite.renderer.config.mts` + `npm run lint` (and esbuild bundles for main/preload).
- **Path aliases**: `@` → `src` and `@shared` → `src/shared`. Configured in all
  three Vite configs (`resolve.alias`) and `tsconfig.json` (`paths`). ESLint's
  `import/no-unresolved` is set to ignore `^@/` and `^@shared/` (the pinned
  ESLint 8 toolchain can't take the TS resolver plugin).
- **Zustand 5** drives renderer state. It's transpiled by esbuild so the old TS
  version is a non-issue.

---

## 3. Project structure

```
limboo/
├── CLAUDE.md                  # you are here
├── project.md                 # full product/architecture vision
├── index.html                 # renderer HTML entry (script → src/renderer/main.tsx)
├── forge.config.ts            # Electron Forge config (entries: src/main/index.ts, src/preload/index.ts; icon)
├── vite.main.config.ts        # Vite config: main process build (+ @ / @shared alias)
├── vite.preload.config.ts     # Vite config: preload build (+ @ / @shared alias)
├── vite.renderer.config.mts   # Vite config: renderer (React + Tailwind + alias) — see note
├── tsconfig.json              # TS config (jsx: react-jsx, DOM libs, path aliases)
├── .eslintrc.json             # ESLint (typescript + import; ignores @ aliases)
├── assets/                    # static assets bundled with the app
│   ├── icon.svg               # source Orbit mark (lucide geometry, transparent, solid accent)
│   ├── icon.png               # 512px window/app icon (rsvg-convert from icon.svg)
│   └── tray.png               # 32px tray icon
├── package.json
└── src/
    ├── global.d.ts            # ambient types for window.limboo (from preload)
    ├── shared/                # code shared across ALL processes
    │   ├── ipc-channels.ts    #   IpcChannels (invoke) + IpcEvents (push) name constants
    │   ├── types.ts           #   AppSettings, WindowStateData, Session, FileChange, CommandId, …
    │   └── constants.ts       #   DEFAULT_SETTINGS, limits, clamp()
    ├── main/                  # MAIN process (Node / OS owner)
    │   ├── index.ts           #   entry: lifecycle, single-instance, CSP, wires managers + IPC
    │   ├── logger.ts          #   file+console logger + global uncaught handlers
    │   ├── storage.ts         #   atomic JSON read/write under userData
    │   ├── paths.ts           #   assetPath() resolver
    │   ├── sendCommand.ts     #   native menu/tray → renderer command bridge
    │   ├── window/            #   createWindow.ts (frameless, sandbox, icon) + windowState.ts
    │   ├── managers/          #   Settings, Notification, AppMenu, Tray managers
    │   └── ipc/               #   registry.ts (handle wrapper) + *Handlers + registerAllIpc()
    ├── preload/
    │   └── index.ts           # the ONLY bridge — exposes window.limboo.{window,settings,system,app,events}
    └── renderer/              # React UI (presentation only)
        ├── main.tsx           #   entry: ErrorBoundary + LoadingScreen hydration gate
        ├── App.tsx            #   composes AppShell + palette + settings modal + toaster + shortcut hooks
        ├── styles/index.css   #   Tailwind import + pure-black tokens + drag/anim utilities
        ├── app/AppShell.tsx   #   the resizable 3-region layout
        ├── components/        #   ui/ (primitives), layout/ (TitleBar, WindowControls), brand/ (Logo), feedback/
        ├── features/          #   sessions/, workspace/, activity/, command-palette/, settings/
        ├── stores/            #   Zustand: useSettings/useLayout/useSession/useUI
        ├── hooks/             #   useResizable, useKeyboardShortcuts, useCommandBridge
        └── lib/               #   cn, debounce, format, commands (registry)
```

> The renderer Vite config is `vite.renderer.config.**mts**` (ESM), not `.ts`.
> Reason: `@tailwindcss/vite` is ESM-only and this project is CommonJS, so a `.ts`
> config gets loaded via `require()` and fails. The `.mts` extension forces ESM
> loading. `forge.config.ts` points at the `.mts` file. The main/preload configs
> stay `.ts` (they import no ESM-only packages).

### The three Electron contexts (critical mental model)

```
 Renderer (Chromium + React)   <-- src/renderer/** (entry: main.tsx)
        │  window.limboo.*
        ▼
 Preload (contextBridge)        <-- src/preload/index.ts  (the ONLY bridge)
        │  ipcRenderer <-> ipcMain
        ▼
 Main (Node.js + OS access)     <-- src/main/** (entry: index.ts)
```

Hard rules:

- **Renderer = UI only.** No `fs`, no `child_process`, no git, no terminal logic,
  no direct Node APIs. It asks; it never performs.
- **Main = OS owner.** All filesystem, git, shell, SQLite, indexing, and
  background work lives here (or in worker/utility processes spawned from here).
- **Everything crosses via IPC**, exposed through `contextBridge` in
  `src/preload/index.ts`. `contextIsolation` is ON, `nodeIntegration` OFF, and the
  window runs with `sandbox: true`. Never weaken these.
- **Channel names** live only in [`src/shared/ipc-channels.ts`](src/shared/ipc-channels.ts)
  so handlers (main) and invokers (preload) can never drift.

---

## 4. Theming: pure-black, dark mode ONLY

This is a **strict product requirement**: the app is **dark mode only, on a true
`#000000` background**. There is **no light mode and no theme toggle**. Do not add
`dark:` variants, a theme switcher, or a light palette.

How it is enforced (defense in depth):

1. **Main process** — [`src/main/index.ts`](src/main/index.ts) sets
   `nativeTheme.themeSource = 'dark'` and [`createWindow.ts`](src/main/window/createWindow.ts)
   uses `backgroundColor: '#000000'` with `show: false` + `ready-to-show` to
   prevent a white launch flash.
2. **HTML** — [`index.html`](index.html) sets `<html class="dark">` and
   `<meta name="color-scheme" content="dark">`.
3. **CSS** — [`src/renderer/styles/index.css`](src/renderer/styles/index.css) sets
   `color-scheme: dark`, a black `body` background, dark scrollbars, and the token
   palette.

### Design tokens (Tailwind v4 `@theme` in `src/renderer/styles/index.css`)

These become utilities automatically (e.g. `bg-base`, `text-fg`, `border-line`).

| Token                  | Value     | Use                                  |
| ---------------------- | --------- | ------------------------------------ |
| `--color-base`         | `#000000` | App background (`bg-base`)           |
| `--color-surface`      | `#0a0a0a` | Panels / sidebars (`bg-surface`)     |
| `--color-surface-2`    | `#111111` | Cards, inputs, hover wells           |
| `--color-elevated`     | `#161616` | Popovers / active rows               |
| `--color-line`         | `#1c1c1c` | Hairline borders (`border-line`)     |
| `--color-line-strong`  | `#2a2a2a` | Emphasized borders / scrollbar thumb |
| `--color-fg`           | `#ededed` | Primary text (`text-fg`)             |
| `--color-muted`        | `#9a9a9a` | Secondary text (`text-muted`)        |
| `--color-faint`        | `#6b6b6b` | Tertiary / disabled (`text-faint`)   |
| `--color-accent`       | `#6e9bff` | Accent / primary action              |
| `--color-success`      | `#3fb950` | Success / additions / active status  |
| `--color-warning`      | `#d29922` | Warning / idle status                |
| `--color-danger`       | `#f85149` | Errors / deletions                   |

**Contrast / visibility rule:** everything must remain clearly legible on pure
black. Use `text-fg` for primary content, `text-muted` for secondary, and keep
borders at `border-line` (visible but subtle). Never put dark-gray text directly on
black for primary content. When adding a new surface, step up the gray ramp
(`base → surface → surface-2 → elevated`) rather than inventing new hex values.

---

## 4b. App shell layout (Codex-style)

The shell lives in [`src/renderer/app/AppShell.tsx`](src/renderer/app/AppShell.tsx),
composed by [`src/renderer/App.tsx`](src/renderer/App.tsx). It is a single column
with a custom title bar on top and a horizontal row of resizable regions below it:

```
┌──────────────────────────────────────────────────────────────┐
│  TitleBar (frameless, draggable)         [search][_][□][x]    │
├────────┬──────────────────────────────────────────┬──────────┤
│Sessions│  header / conversation / Composer         │ drawer │▐ rail
└────────┴──────────────────────────────────────────┴──────────┘
```

- **Left + right columns are full height**; the **Composer lives only inside the
  center column** (it does not span the whole window).
- **Right side = a fixed ~48px icon rail (`ActivityRail`) + a collapsible drawer
  (`ActivityDrawer`)**. Tabs: Files / Changes / Tasks / Activity. Clicking the
  active tab toggles the drawer closed (`activeTab` in the layout store, nullable);
  the center expands when it is closed.
- **Sessions** render as flat **message-style rows** (status dot + title + meta),
  not cards. The active row uses a left accent bar + `bg-surface-2`.
- **No mock data.** Every region starts EMPTY and renders an `EmptyState` (Phase 1
  has no git/agent yet). Sessions come from `useSessionStore` (empty by default);
  Files/Changes/Tasks/Activity are placeholder empty states until later phases.
- **Diff counts** use the shared `DiffStat` (`+adds` in `text-success`, `-dels` in
  `text-danger`). Change data is modeled as `{ path, status, adds, dels }`.

### Brand / logo

The logo is an organic **pink "blob"** mark (`--color-brand` = `#ff0066`), rendered
as an inline SVG (solid fill, no background, no gradient) via
[`components/brand/Logo.tsx`](src/renderer/components/brand/Logo.tsx). This pink is
the **one intentional exception** to the "no off-palette colors" rule in §4 — it's a
dedicated `--color-brand` token (→ `text-brand`/`fill-brand`) used only for the
brand mark, not for UI chrome (which still uses the blue `--color-accent`). `Logo`
defaults to `tone="brand"` but keeps `accent`/`fg`/`muted` tones for contexts that
need the mark to blend into text.

The OS-level window/tray/app icon is [`assets/icon.png`](assets/icon.png) (512),
`icon@256.png`, and `tray.png` (32), rasterized from the same-shape
[`assets/icon.svg`](assets/icon.svg). Regenerate the runtime PNGs with
`npm run gen:icons` (a cross-platform `sharp` script,
[`scripts/gen-icons.mjs`](scripts/gen-icons.mjs)) after editing the SVG — this
replaces the old `rsvg-convert` one-liner, which isn't available on Windows. The
Windows *installer* art (`.ico`, NSIS sidebar/header BMPs) derives from the same
`icon.svg` via `npm run gen:installer`
([`scripts/gen-installer-assets.mjs`](scripts/gen-installer-assets.mjs)) — also
cross-platform: sharp + resvg rasterize, `opentype.js` outlines the wordmarks from
the vendored Inter TTFs in `assets/installer/fonts/`, and a built-in 24-bit writer
emits the BMP3 files NSIS needs (no rsvg-convert / ImageMagick anywhere).

### Frameless window + the `window.limboo` bridge

The window is **frameless** (`frame: false` in
[`createWindow.ts`](src/main/window/createWindow.ts)); we draw our own title bar.
Dragging uses Tailwind utilities in `styles/index.css`: `drag-region`
(`-webkit-app-region: drag`) on the bar, `no-drag` on every interactive child.

The preload exposes a typed, namespaced API on `window.limboo`:

```ts
window.limboo.window.{minimize,maximize,close,isMaximized,onMaximizedChange}
window.limboo.settings.{getAll,set,reset,onChange}      // persisted prefs
window.limboo.system.{notify,openExternal,clipboardWrite,clipboardRead}
window.limboo.app.getInfo()                             // version/electron/…
window.limboo.events.onCommand(cb)                      // native menu/tray → command
```

Types flow from `src/preload/index.ts` (`LimbooApi`) into the renderer via
[`src/global.d.ts`](src/global.d.ts). Renderer calls guard with optional chaining
(`window.limboo?.…`) so the UI still renders in a plain browser preview where the
preload is absent.

### State (Zustand) + persistence

Renderer state is split into slice stores under `src/renderer/stores/`:

- `useSettingsStore` — mirrors the main `SettingsManager`; `hydrate()` loads on
  boot, applies appearance (font-scale CSS var, density/reduced-motion attrs),
  seeds the layout store, and subscribes to `settings:changed`. Writes go through
  `window.limboo.settings.set` (write-through).
- `useLayoutStore` — live sidebar widths + open drawer tab; persisted (debounced)
  into `settings.layout`.
- `useSessionStore` — in-memory session list (empty in Phase 1) + selection.
- `useUIStore` — command palette open, active modal, toast queue.

Persistence lives in the **main** process: `SettingsManager`
(`userData/settings.json`, deep-merged with `DEFAULT_SETTINGS`, clamped, migrated)
and `WindowStateManager` (`userData/window-state.json`, restores size/position/
maximized, validated against connected displays).

### Command palette + shortcuts

[`lib/commands.ts`](src/renderer/lib/commands.ts) is the command registry (run on
Zustand `getState()` so they work anywhere). `useKeyboardShortcuts` binds combos
(`Mod` = Cmd/Ctrl), `CommandPalette` (Cmd/Ctrl+K) lists them, and
`useCommandBridge` runs commands dispatched from the native menu/tray via the
`command:invoke` event. To add a command: add it to `COMMANDS`, then (optionally)
add a native menu/tray item that calls `sendCommand(id)` in main.

### Resizing

Both side columns resize via the hand-rolled `useResizable({ edge, getWidth,
setWidth })` hook (no dependency). On handle `mousedown` it attaches
`mousemove`/`mouseup` to `window`, inverts the delta for the right
(`edge: 'right'`) drawer, and pushes the clamped width into `useLayoutStore` (which
persists it). `ResizeHandle` is the 1px divider with a wider hover hit area.

---

## 5. Commands

```bash
npm start              # run the app in dev (Electron + Vite HMR). Renderer on :5173
npm run lint           # eslint over .ts/.tsx
npm run package        # package the app (no installers)
npm run dist           # package + electron-builder → branded installers in dist/
npm run gen:icons      # regenerate runtime PNG icons from assets/icon.svg
npm run gen:installer  # regenerate Windows installer art (.ico + NSIS BMPs)
npm run make           # legacy Forge makers (unused — makers: [] in forge.config.ts)
npm run publish        # legacy Forge publish (unused; releases ship via CircleCI)
```

There is **no `npm run dev`** — use `npm start` (Electron Forge drives Vite).
Releases: pushing a `v*` tag triggers the CircleCI `release` workflow (all-OS
installers → GitHub Release); see `docs/ci/release-process.md`.

---

## 6. Conventions for agents working here

- **Respect the process boundary.** New OS-touching capability = add a channel in
  `src/shared/ipc-channels.ts`, a handler in `src/main/ipc/*Handlers.ts` (via the
  `handle()` wrapper), a typed method in `src/preload/index.ts`, then call it from
  the renderer. Do not reach for Node APIs in the renderer.
- **Keep the renderer presentational.** Components hold no business logic; state
  lives in Zustand stores and data crosses via the preload bridge. New domains get
  their own slice store + `features/<domain>/` folder.
- **Theme discipline.** Use tokens (`bg-surface`, `text-muted`, ...). No light mode,
  no hardcoded off-palette colors, no `dark:` variants, no gradients.
- **Tailwind v4.** Add design tokens in the `@theme` block of
  `src/renderer/styles/index.css`, not a config file. Use `@utility` /
  `@custom-variant` in that CSS file if you need custom utilities/variants.
- **Security.** Keep `contextIsolation` on, `nodeIntegration` off, and `sandbox`
  on. Validate all IPC inputs in the main process (handlers already reject bad
  input). A CSP is applied in `src/main/index.ts` (header) with a meta fallback in
  `index.html`. Secrets/API keys should use Electron `safeStorage` (see
  `project.md` §17) — never plain files. **Hardening already in place** (keep it):
  - **Deny-by-default permissions** — `hardenSession()` in
    [`src/main/index.ts`](src/main/index.ts) sets
    `setPermissionRequestHandler`/`setPermissionCheckHandler` to refuse all
    web-platform permissions (camera/mic/geo/USB/…). This is a local app.
  - **IPC sender validation** — the `handle()` wrapper in
    [`src/main/ipc/registry.ts`](src/main/ipc/registry.ts) rejects any message
    whose `senderFrame.origin` is not our own renderer (dev-server origin in dev,
    `file://` in prod). New handlers go through `handle()` and inherit this.
  - **Navigation / webview lockdown** —
    [`src/main/window/createWindow.ts`](src/main/window/createWindow.ts) guards
    `will-navigate` **and** `will-redirect`, denies `setWindowOpenHandler`, and
    blocks `<webview>` via `will-attach-webview`. `webPreferences` pins
    `webSecurity`, `allowRunningInsecureContent: false`, `spellcheck: false`.
  - **Prototype-pollution guard** — `deepMerge` in
    [`SettingsManager.ts`](src/main/managers/SettingsManager.ts) skips
    `__proto__`/`constructor`/`prototype`, and
    [`settingsHandlers.ts`](src/main/ipc/settingsHandlers.ts) rejects any patch
    containing them. **Apply the same guard to every future renderer-supplied
    object that gets merged or used as a key.**
  - **System-handler input caps** —
    [`systemHandlers.ts`](src/main/ipc/systemHandlers.ts) caps URL/clipboard/
    notify lengths and rejects `openExternal` URLs with embedded credentials.

  **Contracts for the not-yet-built managers** (§8) — every future agent must follow:
  - **Local DB** (`better-sqlite3`): use **parameterized/bound statements only**;
    never string-concatenate or interpolate values into SQL.
  - **Agent Manager / any outbound `fetch`**: enforce an **SSRF allowlist** — block
    private, loopback, and link-local IP ranges, and do not follow redirects to
    internal hosts. Resolve+check the target before connecting.
  - **Secrets / API keys**: encrypt with Electron `safeStorage`, never plaintext
    files; **redact secrets/tokens** before they reach
    [`logger.ts`](src/main/logger.ts).
  - **Terminal / Git engines**: spawn with **no `shell: true`** — pass argv arrays
    (`spawn(cmd, [args])`); validate every `cwd`/path stays inside the session
    repo (path-traversal guard) before touching the filesystem.
- **Dependencies.** Pin to versions compatible with **Vite 5 / Electron 42**. After
  installs, sanity-check peer warnings (esp. anything touching Vite).
- **Build-output naming gotcha.** Forge's Vite plugin names each build
  `[name].js` from the entry basename. Both process entries are `index.ts`, so
  they would collide on `index.js`; the output names are pinned in the Vite
  configs — `main.js` via `build.lib.fileName` in
  [`vite.main.config.ts`](vite.main.config.ts), `preload.js` via
  `rollupOptions.output.entryFileNames` in
  [`vite.preload.config.ts`](vite.preload.config.ts). These must match
  `package.json` `main` and the `preload.js` path in `createWindow.ts`. **Don't
  let any new entry collide on basename.**
- **Don't edit** generated output in `.vite/` or `node_modules/`.

---

## 7. Electron + Node APIs available to the main process

Electron (planned usage from `project.md` §17): `BrowserWindow`, `ipcMain`/
`ipcRenderer`, `contextBridge`, `dialog`, `shell`, `Menu`, `globalShortcut`,
`clipboard`, `Notification`, `Tray`, `nativeTheme` (already used to force dark),
`nativeImage`, `safeStorage`, `powerMonitor`, `powerSaveBlocker`, `session`,
`webContents`, `utilityProcess`.

Node core (§18): `fs`/`fs.promises`, `path`, `os`, `child_process` (agent, git,
terminals), `worker_threads`, `events`, `stream`, `crypto`.

---

## 8. Roadmap — current reality

**Phase 1 — Desktop Foundation (DONE).** Multi-process architecture with a typed
IPC layer (`shared/ipc-channels`, `main/ipc/*`, `preload`), frameless window with
custom controls, **window-state persistence** (`WindowStateManager`), **persistent
settings** (`SettingsManager`), **native menu + context menu** (`AppMenuManager`),
**system tray** (`TrayManager`), **desktop notifications** (`NotificationManager`),
single-instance lock, CSP + sandbox, main-process logging + global error handlers,
a React **ErrorBoundary** + **LoadingScreen** hydration gate, **Zustand** stores, a
**command palette** + keyboard shortcuts, the **Orbit** logo/icon, and the
Codex-style shell.

**Phases 2–4 — Platform services (BUILT).** Most managers from `project.md` are now
operational in the **main process**, reached from the renderer via IPC and backing
the real (no-mock) UI. Each owns one responsibility:

- **Local Database** (`db/database.ts`) — `better-sqlite3` at `{userData}/limboo.db`,
  WAL, versioned schema (`WORKSPACE_SCHEMA_VERSION`), idempotent migrations. Bound
  parameters only.
- **Session Manager** (`managers/SessionManager.ts`) — create/list/switch/trash
  sessions; persists transcript + activity per session.
- **Workspace Manager** (`managers/WorkspaceManager.ts`) — repos, lifecycle, active
  workspace.
- **Git Engine** (`managers/GitManager.ts` + `managers/git/*`) — status/diff/stage/
  commit/log/branches/tags/blame/fetch/init, lightweight **checkpoints**, and now
  **push / pull** (`git:push` / `git:pull`). Git runs argv-only via `runGit`
  (no shell). Push uses `--force-with-lease` (never bare `--force`) and the user's
  own credential helper / SSH agent — Limboo stores **no** remote credentials, and
  embedded-credential remote URLs are redacted from results/logs. The UI shows an
  ahead/behind pill, an unpushed badge on the Git rail tab, and "publish branch"
  for an untracked branch. Push/pull preferences live under `settings.git.push` /
  `settings.git.pull`.
- **Terminal Engine** (`managers/TerminalManager.ts`) — `node-pty` sessions,
  pinned to the `1.2.0-beta` line (Microsoft's Node-API rewrite): the bundled
  per-platform prebuilt is ABI-stable across Node.js/Electron, so it never
  needs a `node-gyp` rebuild; `forge.config.ts` excludes it from
  `@electron/rebuild` accordingly.
- **File System Layer** (`managers/FileSystemManager.ts`) — `chokidar` watch +
  tree index + guarded reads; pushes live git status into sessions.
- **Agent Manager** (`managers/AgentManager.ts`) — drives `@anthropic-ai/claude-
  agent-sdk` (plan/implement modes), risk-gated `canUseTool`, path-guarded to the
  workspace, persists transcript/activity/diagnostics, resumes SDK sessions.
- **Memory System** (`managers/memory/MemoryManager.ts`) — the **Local Memory
  System** (see below).
- **Search Engine** (`managers/search/SearchManager.ts`) — the **Search Engine**
  platform service (see below).

### Local Memory System

A provider-independent **platform service owned by the app**, not the agent. It
preserves durable project knowledge across sessions/providers and injects the most
relevant entries into the agent prompt *before* it reaches the harness.

- **Storage** — three tables in `limboo.db`: `memories` (tiered knowledge with
  confidence/usage/status/expiry), `memories_fts` (FTS5 over title+body, kept in
  sync by triggers, for **BM25** keyword retrieval — fully offline, no embeddings
  API), and `memory_links` (back-links to source). `workspace_id` is NULL for
  global/user-scope (e.g. preferences). All access is parameterized.
- **Tiers** — `session < workspace < project < preference < convention < decision
  < solution`, plus manual `note`. Higher tiers outrank lower ones in retrieval.
- **Retrieval + ranking** (`retrieve`) — builds an FTS query from the prompt (+
  active files + branch), then composite-scores candidates by BM25 relevance ×
  recency × confidence × usage × tier weight × pinned/workspace boosts, returns
  top-K within a char budget, and `buildContextBlock` renders a `<project-memory>`
  block appended to the Claude Code system preset in `AgentManager.buildOptions`.
- **Auto-capture** — commits and conversations become **proposals** (`status =
  'proposed'`) that the user accepts/dismisses; policy is `settings.memory`
  (`propose` | `auto` | `off`, with a confidence auto-accept threshold). Never
  injected until `active`.
- **Defaults + maintenance** — `seedDefaults` creates starter memories per
  workspace and for global scope on first run (idempotent, meta-flagged) so the
  Memory panel is populated on install; an hourly `sweep` flags stale, unpinned
  entries (never deletes).
- **UI** — a **Memory** activity tab (`features/memory/MemoryPanel.tsx` + the
  `Brain` rail icon with a proposals badge), backed by `useMemoryStore`, with
  search / tier filters / proposals / inline note composer; settings under the
  **Memory** category.

### Search Engine

A provider-independent **platform service owned by the app** — the single retrieval
interface every subsystem (and the agent) queries instead of rolling its own
lookup. Fully local: no network, no embeddings. It **indexes** the large/expensive
sources itself (files, content, symbols) and **federates** the already-queryable
ones at query time (memory, git, sessions, commands).

- **Storage** — in `limboo.db`: `search_files`(+`search_files_fts`, FTS5 BM25 over
  path+content) and `search_symbols`(+`search_symbols_fts`, FTS5 **trigram** for
  substring/fuzzy on names), plus `search_history` and `saved_searches`. All access
  is parameterized; kept in sync by triggers (mirrors the memory FTS pattern).
- **Indexing** — a bounded, cooperative walk (reuses the guarded `readWorkspaceFile`
  reader + the workspace ignore matcher, never follows symlinks, capped by
  `FS_LIMITS`). Runs on active-workspace activation and re-runs (coalesced) on the
  `FileSystemManager` watcher's change signal. Symbols come from a lightweight,
  regex-based per-language extractor (`search/symbols.ts`) — no parser deps.
- **Retrieval + ranking** — `globalSearch` merges own-index + federated hits into
  ranked, per-source **groups**; ranking fuses BM25 relevance with filename/path
  affinity, symbol exact/prefix matches, and structure weight (source over
  generated). Git federation is cached with a short TTL to avoid spawning `git` per
  keystroke.
- **Agent context provider** — `retrieveContext` + `buildContextBlock` render a
  `<project-context>` block of ranked files/symbols that `AgentManager` appends to
  the Claude Code preset **alongside** the memory block (single `systemPrompt.append`).
  A read-only `limboo_search` MCP server (`search/searchTools.ts`:
  `search_project` / `find_files` / `find_symbols`) lets the agent query the index
  on demand; auto-allowed in `canUseTool`. Search **retrieves/ranks**; the SDK's
  Read/Grep/Glob remain authoritative.
- **UI** — **Global Search** (`features/search/GlobalSearch.tsx`, Cmd/Ctrl+P) is the
  universal command-palette-style entry point; a **Search** activity tab
  (`features/search/SearchPanel.tsx` + the `Search` rail icon) mirrors it with
  filters, recent + saved searches. Backed by `useSearchStore`. Settings live in the
  **Memory & Search** category (`settings.search`).

**Still open / future** — Repository clone/track UI, a dedicated Permission System
beyond the agent's `canUseTool`, merge-conflict resolution UI, remote management, and
stash. True per-file incremental search indexing (v1 does a coalesced full reindex on
change) and local vector embeddings on top of BM25 (both Memory and Search rankings
are already fusion-ready) are natural follow-ups.

---

## 9. Quick orientation checklist for a new agent

1. Read this file and skim [`project.md`](project.md).
2. Run `npm start`; confirm the pure-black 3-pane shell renders (empty states).
3. Find the relevant context: UI → `src/renderer/**` (entry `main.tsx`, shell
   `app/AppShell.tsx`, styles `styles/index.css`); state → `src/renderer/stores/`;
   OS/logic → `src/main/**` (+ future managers); the bridge → `src/preload/index.ts`;
   shared contracts → `src/shared/**`.
4. Keep the process boundary, dark-only theme, and no-gradient rule intact.
5. Verify with `npx vite build --config vite.renderer.config.mts` + `npm run lint`
   (not `tsc`). Prefer small, single-responsibility additions wired through IPC.
