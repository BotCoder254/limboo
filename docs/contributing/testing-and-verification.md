# Testing and verification

Limboo has a specific verification path because of its toolchain. This page explains
how to verify a change correctly and why the obvious command (`tsc`) is the wrong
one.

## Why not `tsc`

TypeScript is pinned old (`~4.5`) and the renderer is transpiled by **esbuild via
Vite**, not `tsc`. TS 4.5 cannot even parse the modern bundled `@types/node`, so
`tsc --noEmit` produces noise unrelated to your change. Type errors do not block the
dev / build run. Use the tools below instead.

## The verification commands

```bash
npm run lint
npx vite build --config vite.renderer.config.mts
```

- `npm run lint` runs ESLint over `.ts` / `.tsx`.
- The Vite renderer build is the authoritative check that the renderer compiles and
  bundles.

For changes to the **main** or **preload** bundles, also confirm the app starts and
behaves:

```bash
npm start
```

esbuild bundles the main and preload entries; a runtime smoke test through
`npm start` is the practical check that they load and the IPC path works.

## Manual testing

There is no automated test suite yet. Verify behavior by exercising it in the running
app:

- Reproduce the original problem, then confirm the fix.
- For IPC changes, test the full path from the renderer through the handler.
- For UI changes, check the pure-black theme holds and the layout resizes correctly.
- For agent / git / terminal / memory changes, run a real session against a scratch
  workspace.

The [verify](#) and [run](#) project skills can launch the app and observe behavior
if you use Claude Code.

## What to include in the PR

State exactly what you ran and what you observed. An honest verification trace (the
commands, their results, and the manual steps) is what a reviewer needs. If something
was not tested, say so. See [pull requests](pull-requests.md).

## Planned

A formal automated test suite and a documentation link-check in CI are natural future
additions; today CI runs lint plus the renderer build (see
[CI/CD](../operations/ci-cd.md)).
