# Coding standards

These standards keep the codebase consistent with its existing patterns. Match the
surrounding code: its naming, comment density, and idioms.

## TypeScript

- The repo's TypeScript is intentionally old (`~4.5`) and the renderer is transpiled
  by esbuild via Vite, not `tsc`. **Do not** rely on `tsc --noEmit` to verify — it
  cannot parse the modern bundled `@types/node`. Verify with the Vite renderer build
  and ESLint. See [testing and verification](testing-and-verification.md).
- Prefer explicit, exported types for cross-process data, and put shared types in
  [`src/shared/types.ts`](../../src/shared/types.ts).

## Path aliases

`@` maps to `src` and `@shared` maps to `src/shared`, configured in all three Vite
configs and `tsconfig.json`. ESLint's `import/no-unresolved` ignores `^@/` and
`^@shared/`. Use the aliases rather than long relative paths.

## React and state

- Components are presentational. Business logic and state live in Zustand slice
  stores under `src/renderer/stores/`; do not put data fetching or IPC calls directly
  in components when a store is the right home.
- New domains get their own store and `features/<domain>/` folder.
- Guard bridge calls with optional chaining (`window.limboo?.…`) so the UI still
  renders without the preload.

## Tailwind v4 (CSS-first)

- There is no `tailwind.config.js` and no `postcss.config.js`. Design tokens live in
  the `@theme` block of [`src/renderer/styles/index.css`](../../src/renderer/styles/index.css).
- Use tokens (`bg-surface`, `text-muted`, `border-line`, ...). No light mode, no
  `dark:` variants, no gradients, no off-palette hex. Use `@utility` /
  `@custom-variant` in that CSS file for custom utilities. See
  [design tokens](../reference/design-tokens.md).

## Main process

- Respect the boundary: no renderer Node access; OS work lives in a manager.
- One responsibility per manager; wire managers together explicitly (see
  [the main process](../architecture/main-process.md)).
- Validate every renderer-supplied input; use bound SQL; spawn argv-only; guard
  paths; reject prototype-polluting keys; redact secrets. See
  [the security model](../architecture/security-model.md).

## Dependencies

Pin to versions compatible with Vite 5 / Electron 42. After installing, check peer
warnings (especially anything touching Vite). Electron and Vite are intentionally
pinned and bumped deliberately, not via automated PRs.

## Build-output naming

Both process entries are `index.ts`; their output names are pinned in the Vite
configs (`main.js`, `preload.js`) to avoid a collision on `index.js`. Do not
introduce a new entry that collides on basename. See [`CLAUDE.md`](../../CLAUDE.md)
§6.
