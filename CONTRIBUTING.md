# Contributing to Limboo

Thank you for your interest in contributing. This guide is the practical contract
for working in the repository. It is intentionally short; the deeper material lives
under [docs/contributing/](docs/contributing/development-workflow.md) and in
[`CLAUDE.md`](CLAUDE.md), the code-level working guide that this document
summarizes. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Read [`CLAUDE.md`](CLAUDE.md) and skim [`project.md`](project.md).
- Read the [architecture overview](docs/architecture/overview.md) so you understand
  the three-context process model before touching code.
- For anything non-trivial, open an issue first so the approach can be agreed on.

## Development setup

```bash
npm install     # installs deps; compiles native modules (better-sqlite3, node-pty)
npm start       # runs Electron + Vite (renderer on :5173). There is no npm run dev.
```

Prerequisites: Node.js 20+, npm, and a C/C++ build toolchain for the native
modules. See [docs/getting-started/installation.md](docs/getting-started/installation.md)
for platform specifics.

## The contracts you must follow

These rules are non-negotiable; they keep Limboo fast, private, and secure.

1. **Respect the process boundary.** The renderer is UI only — no `fs`,
   `child_process`, git, or other Node APIs. It asks; it never performs. All
   OS-touching work lives in the main process.

2. **Add capability through the bridge.** A new OS capability follows one path:
   add a channel in [`src/shared/ipc-channels.ts`](src/shared/ipc-channels.ts), a
   handler in `src/main/ipc/*Handlers.ts` (through the `handle()` wrapper), a typed
   method in [`src/preload/index.ts`](src/preload/index.ts), then call it from the
   renderer. See [docs/architecture/ipc-layer.md](docs/architecture/ipc-layer.md).

3. **Keep the renderer presentational.** Business logic and state live in Zustand
   slice stores under `src/renderer/stores/`; new domains get their own store and a
   `features/<domain>/` folder.

4. **Theme discipline.** The app is dark mode only on a true `#000000` background.
   Use the design tokens (`bg-surface`, `text-muted`, `border-line`, ...). No light
   mode, no `dark:` variants, no theme toggle, no gradients, no off-palette hex.
   See [docs/reference/design-tokens.md](docs/reference/design-tokens.md).

5. **Tailwind v4 is CSS-first.** There is no `tailwind.config.js` and no
   `postcss.config.js`. Add tokens in the `@theme` block of
   [`src/renderer/styles/index.css`](src/renderer/styles/index.css).

6. **Security is part of the change.** Validate every IPC input in the main
   process. Use bound SQL parameters only. Spawn git/terminal with argv arrays
   (never `shell: true`). Guard every renderer-supplied path against traversal.
   Filter `__proto__` / `constructor` / `prototype` from merged objects. Never
   weaken `contextIsolation`, `sandbox`, the CSP, or the navigation lockdown. See
   [docs/architecture/security-model.md](docs/architecture/security-model.md).

7. **Dependencies.** Pin to versions compatible with Vite 5 / Electron 42. After
   installs, check for peer warnings (especially anything touching Vite).

## Verification (required before every PR)

TypeScript is old (`~4.5`) and the renderer is transpiled by esbuild via Vite, so
`tsc --noEmit` is **not** a valid check. Verify with:

```bash
npm run lint
npx vite build --config vite.renderer.config.mts
```

Both must pass. For changes to the main or preload bundles, confirm the app still
starts with `npm start`. See
[docs/contributing/testing-and-verification.md](docs/contributing/testing-and-verification.md).

## Branches and commits

- Branch off `main`; never commit directly to `main`. Use a descriptive branch name
  (for example `feat/terminal-search` or `fix/git-push-lease`).
- Write clear, imperative commit messages that explain the why.
- Keep changes small and single-responsibility — prefer focused PRs.

## Pull requests

Open the PR against `main` and fill in the template. A good PR includes tests or a
clear verification trace, documentation updates for any user-facing or
architectural change, screenshots for UI changes, the architectural reasoning, and
a changelog entry where relevant. Details:
[docs/contributing/pull-requests.md](docs/contributing/pull-requests.md).

## Reporting issues

Use the issue templates: bug report, feature request, or documentation. For
security vulnerabilities, do not open a public issue — follow
[SECURITY.md](SECURITY.md).

## Documentation changes

Documentation is a first-class deliverable. If you change behavior, update the
relevant page under [docs/](docs/README.md). Follow the writing conventions in
[docs/contributing/documentation-standards.md](docs/contributing/documentation-standards.md)
(terse and technical, no emojis, why-before-how, accurate to current reality).
