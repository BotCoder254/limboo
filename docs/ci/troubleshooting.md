# CI/CD troubleshooting

## Native module build fails (`better-sqlite3`)

`better-sqlite3` ships prebuilt binaries for common platform/ABI combos, so
`npm install` usually doesn't compile it — but on an unsupported platform/arch
it needs a C/C++ toolchain + Python:

- Linux: ensure `build-essential python3` is installed (the workflows do this).
- macOS: Xcode Command Line Tools (`xcode-select --install`).
- Windows: the GitHub `windows-latest` runner ships MSVC build tools; locally you may
  need the "Desktop development with C++" workload.

**`node-pty` should never hit this.** It's pinned to the `1.2.0-beta` line —
Microsoft's Node-API rewrite of the addon, which is ABI-stable across Node.js
and Electron, so the bundled per-platform prebuilt loads as-is for any Electron
ABI, no `node-gyp` rebuild. `forge.config.ts`'s `rebuildConfig.ignoreModules`
explicitly excludes it from `@electron/rebuild`'s pass (which would otherwise
try to recompile it and fail with `Could not find any Visual Studio
installation to use`, since it doesn't know the bundled prebuilt is already
correct). If you ever see that error mentioning `node-pty`, check that
`ignoreModules` in `forge.config.ts` still lists it and that `package.json`
still pins the `1.2.0-beta` line, not a NAN-based release/fork.

If a prebuilt binary mismatches the Electron ABI, Forge's
`plugin-auto-unpack-natives` + the maker rebuild handles it during `npm run package` /
`npm run make`. A stale `node_modules` is the usual culprit — delete it and `npm ci`.

## Electron smoke test fails or hangs on Linux

The renderer needs a display and GTK/NSS/GBM libraries.

- Wrap the command in `xvfb-run -a`.
- Install `libnss3 libgbm1 libasound2` (Debian/Ubuntu; the package may be
  `libasound2t64` on newer Ubuntu — the `ci.yml` test job uses that name).
- Increase `SMOKE_TIMEOUT_MS` on a slow runner.

## `check-electron-security.mjs` fails

A security invariant regressed. The output names the exact file and rule (e.g.
"sandbox is enabled"). Restore the setting in `src/main/window/createWindow.ts` /
`src/main/index.ts`; do not weaken the boundary. See [security.md](security.md).

## `check-licenses.mjs` flags a dependency

A new dependency carries a license not on the allowlist. Either replace it, or — after
review — add the SPDX id to `ALLOWED_LICENSES` or the package name to
`PACKAGE_EXCEPTIONS` (env vars consumed by the script). Document why in the PR.

## Release notes are empty or wrong

`generate-release-notes.mjs` diffs from the previous tag. Ensure the checkout has full
history (`fetch-depth: 0` in `release.yml`, `GIT_DEPTH: 0` in GitLab). Non-Conventional
commit subjects fall into the "Other" section — adopt `type(scope): subject` to get clean
categorization.

## Attestation step fails

`actions/attest-*` require `id-token: write` + `attestations: write` (set in
`_package.yml`) and are gated to the release path (`attest: true`). On private repos,
attestations require GitHub Advanced Security / the appropriate plan. If unavailable,
remove the `attest` flag in `release.yml` — checksums and SBOM still ship.

## Signing "skipped" unexpectedly

`verify-signing.mjs` only verifies when signing env/secrets are present. If you expected
signing, confirm the secrets exist in the provider store and are exposed to the job
(protected/masked vars are only available on protected branches/tags). See
[code-signing.md](code-signing.md).

## A secret leaked / gitleaks fired

Rotate the credential immediately at its source, then purge it from history if needed.
Because Limboo keeps no secrets in the repo, a hit almost always means an accidental paste
— never "allowlist" a real secret.
