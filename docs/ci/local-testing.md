# Local pipeline testing

Run every CI stage on your machine before pushing. All checks are provider-neutral Node
scripts, so they behave identically to CI.

## Validate

```bash
npm ci
npm run lint
node ci/scripts/check-licenses.mjs
node ci/scripts/check-electron-security.mjs
node ci/scripts/check-manifest.mjs
npm audit --audit-level=high      # advisory; non-blocking in CI
```

## Build

```bash
npx vite build --config vite.renderer.config.mts
npm run package        # compiles main + preload via the Forge Vite plugin
```

> Do **not** use `tsc --noEmit` to verify — TypeScript is ~4.5 and the renderer is
> esbuild-bundled (CLAUDE.md §2).

## Test (Electron smoke)

```bash
node ci/scripts/smoke-test.mjs
# Headless Linux:
xvfb-run -a node ci/scripts/smoke-test.mjs
```

The smoke test boots Electron, creates a window, and asserts the renderer sandbox is
intact. Set `SMOKE_TIMEOUT_MS` to adjust the timeout.

## Package + secure

```bash
npm run make
node ci/scripts/make-checksums.mjs out/make out/make/SHA256SUMS
node ci/scripts/verify-signing.mjs out/make    # skips cleanly when unsigned
```

## Release notes preview

```bash
node ci/scripts/generate-release-notes.mjs v1.2.0
```

## Running the GitHub workflows locally

[`act`](https://github.com/nektos/act) can run the workflows in Docker:

```bash
act pull_request -W .github/workflows/ci.yml
```

Note that attestation, signing, and `download-artifact` cross-job steps behave
differently under `act`; use it for the `validate`/`build` jobs and rely on a real branch
push to exercise `cd.yml` / `release.yml`. The primary release path is the GitLab
pipeline (`.gitlab-ci.yml`); validate it with `glab ci lint` or GitLab's Pipeline
editor / CI Lint.

## Linting the workflows

```bash
# YAML well-formedness
python3 -c "import yaml,glob; [list(yaml.safe_load_all(open(f))) for f in glob.glob('.github/workflows/*.yml')]"
# Deeper Actions linting (optional install)
actionlint
```
