# Installation

This page covers running Limboo from source for development and building installable
artifacts. Limboo is an Electron application; running it from source is the primary
supported path today.

## Prerequisites

- **Node.js 20 or newer** and **npm**.
- **A C/C++ build toolchain** for `better-sqlite3`, the local database — it ships
  prebuilt binaries for common platforms/ABIs, so `npm install` usually doesn't
  need to compile it, but a fallback compile is still possible on an
  unsupported platform/arch.
  - **Linux** — `build-essential` and `python3` (for example
    `sudo apt-get install -y build-essential python3`).
  - **macOS** — the Xcode Command Line Tools (`xcode-select --install`).
  - **Windows** — the "Desktop development with C++" workload from the Visual Studio
    Build Tools.

  **You should not need this toolchain for the integrated terminal.** It's
  backed by `node-pty`, pinned to the `1.2.0-beta` line, which Microsoft
  rewrote on Node-API (`node-addon-api`) instead of NAN — the compiled addon
  is ABI-stable across Node.js *and* Electron major versions, so the
  per-platform prebuilt bundled in the npm package works as-is, with no
  `node-gyp` rebuild ever, for any Electron version including future ones.
  Older `node-pty` releases (and NAN-based forks of it, like
  `@homebridge/node-pty-prebuilt-multiarch`) don't have this property — they
  rebuild via `node-gyp` for any Electron ABI without a matching prebuilt,
  which needs the same toolchain as above. Because `@electron/rebuild` (used
  by Electron Forge) doesn't know `node-pty@1.2.0-beta` is exempt, `node-pty`
  is explicitly excluded from its rebuild pass via `ignoreModules` in
  [`forge.config.ts`](../../forge.config.ts) — without that, Forge would still
  try (and fail without Visual Studio) to recompile a module that doesn't need
  it.

- **A coding agent sign-in.** Limboo orchestrates the Claude Code agent through
  `@anthropic-ai/claude-agent-sdk` and never stores credentials. It reads an existing
  sign-in, detected from environment variables (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, or `CLAUDE_CODE_OAUTH_TOKEN`) or the Claude Code
  credentials file in your home directory. See
  [Using the agent](../guides/using-the-agent.md).

## Run from source

```bash
git clone https://github.com/BotCoder254/limboo.git
cd limboo
npm install     # installs deps and compiles the native modules
npm start       # launches Electron + the Vite dev server (renderer on :5173)
```

There is **no** `npm run dev`. `npm start` is driven by Electron Forge, which starts
Vite (with HMR for the renderer) and launches the Electron shell. On first launch you
should see the pure-black three-pane shell with empty states until you open a
workspace.

## Build artifacts

```bash
npm run package   # package the app into a runnable bundle (no installers)
npm run make      # build platform installers
```

`npm run make` produces installers via Electron Forge makers: Squirrel (Windows),
ZIP (macOS), and deb / rpm (Linux). Code signing and notarization are not yet
configured; see
[packaging and signing](../operations/packaging-and-signing.md).

## Where data lives

Limboo is local-first. On first run it creates, under the OS user-data directory:

- `limboo.db` — the SQLite database (sessions, transcripts, memories, git
  checkpoints, and more). See [the database reference](../architecture/subsystems/database.md).
- `settings.json` — persistent settings. See [Settings](../reference/settings.md).
- `window-state.json` — window geometry.
- A log file written by the main-process logger. See
  [debugging](../operations/debugging.md).

Nothing is sent to a Limboo server, because there is none. See
[Local-first](../concepts/local-first.md).

## Troubleshooting

- **`better-sqlite3` build fails** — confirm the C/C++ toolchain is installed, then
  remove `node_modules` and reinstall. A Node major-version change requires a
  reinstall so it rebuilds against the new ABI. `@electron/rebuild` (a
  devDependency) drives this rebuild for Forge's `start`/`package`/`make` steps
  — it's configured in [`forge.config.ts`](../../forge.config.ts) to skip
  `node-pty`, which doesn't need it (see above).
- **The dev server is not reachable** — the main process retries the Vite dev server
  on launch and shows a diagnostic page if it never comes up. Restart `npm start`.
- **Lint or build verification** — verify a checkout with `npm run lint` and
  `npx vite build --config vite.renderer.config.mts`. Do not rely on `tsc`; see
  [testing and verification](../contributing/testing-and-verification.md).
