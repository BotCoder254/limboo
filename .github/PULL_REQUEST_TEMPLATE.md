<!--
Thanks for contributing to Limboo. Please fill in this template so reviewers have
the context they need. Keep the boxes honest — an unchecked box is fine, it just
tells the reviewer what is left.
-->

## Summary

<!-- What does this PR do, and why? Link any related issue (e.g. "Closes #123"). -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal change
- [ ] Documentation
- [ ] Build / CI / tooling

## Architectural reasoning

<!--
For anything non-trivial: how does this fit the process boundary? Did you add a new
IPC channel (channel -> handler -> preload method -> renderer call)? Any new Zustand
store or feature folder? Any new dependency, and is it compatible with Vite 5 /
Electron 42?
-->

## Verification

- [ ] `npm run lint` passes
- [ ] `npx vite build --config vite.renderer.config.mts` passes
- [ ] App still starts with `npm start` (for main/preload changes)
- [ ] Manual testing steps described below

<!-- Describe how you tested this. -->

## Security checklist (if touching main process)

- [ ] All renderer-supplied IPC inputs are validated in the main process
- [ ] SQL uses bound parameters only
- [ ] Any spawned process uses argv arrays (no `shell: true`)
- [ ] Renderer-supplied paths are guarded against traversal
- [ ] No weakening of `contextIsolation` / `sandbox` / CSP / navigation lockdown

## Documentation and changelog

- [ ] Updated the relevant page(s) under `docs/`
- [ ] Added a `CHANGELOG.md` entry (if user-facing)
- [ ] Screenshots attached (for UI changes)

## Theme discipline (for UI changes)

- [ ] Uses design tokens only (no off-palette hex, no `dark:` variants, no gradients)
