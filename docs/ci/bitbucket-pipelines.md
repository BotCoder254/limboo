# Bitbucket Pipelines — Linux pipeline + GitHub Release co-publisher

Defined in [`bitbucket-pipelines.yml`](../../bitbucket-pipelines.yml). Bitbucket is
the third implementation of the canonical pipeline
([`ci/pipeline.yml`](../../ci/pipeline.yml)): a **deep mirror of the GitLab
pipeline** running the same stages via the same provider-neutral
[`ci/scripts/*.mjs`](../../ci/scripts). **GitLab remains the single source of truth
and the sole GitLab-Release publisher**; Bitbucket is a co-equal Linux pipeline that
**co-publishes the GitHub Release** on every `v*` tag.

## Stages

`validate` -> `build` -> `test` -> `package` -> `secure` -> `release`

- **validate** (parallel): `lint`, `compliance` (tag-version stamp + tag-unique
  guard + licenses + Electron invariants + manifest), `audit` (non-blocking),
  `secret-scan` (gitleaks image).
- **build**: renderer build + `npm run package`.
- **test**: the Electron smoke test under `xvfb` (same GTK/ATK/CUPS/ALSA + t64
  fallback package set as GitLab's `test:linux`).
- **package**: `package-linux` only — Bitbucket cloud runners are **Linux-only**,
  so Windows/macOS packaging stays on the GitLab SaaS runners. Runs
  `npm run dist -- --publish never`, generates the CycloneDX SBOM, verifies
  signing, and stages `artifacts/linux/`.
- **secure**: flattens `artifacts/*/* -> dist/`, `SHA256SUMS`, signing check.
- **release**: `release-notes` -> `release-github` (co-publish) ->
  `release-bitbucket-downloads` (optional, token-guarded).

## Co-publisher semantics (the race, by design)

On a `v*` tag **both** GitLab and Bitbucket pipelines run. Both GitHub-release jobs
use the same idempotent logic (create if missing, otherwise upload with
`--clobber`), so whichever finishes **last** owns the identically-named assets.
GitLab's all-OS pipeline normally finishes last, keeping its byte-for-byte
multi-OS build authoritative; Bitbucket guarantees a GitHub Release exists even if
the GitLab pipeline is unavailable. Tags containing a hyphen (e.g. `v1.4.0-rc.1`)
publish as **pre-releases**, same as GitLab.

## Repository variables (secrets)

Set under **Repository settings -> Pipelines -> Repository variables**, always
**Secured** (never in the YAML):

| Variable | Use |
| -------- | --- |
| `GITHUB_TOKEN` | **Required.** GitHub PAT (repo scope / Contents: read+write on `BotCoder254/limboo`). Used by `release-github` and the manual `sync-github` custom pipeline. |
| `BITBUCKET_ACCESS_TOKEN` | Optional repository access token. When present, installers are also uploaded to **Bitbucket Downloads**; when absent that step skips cleanly. |

## Triggers

- Push / pull-request pipelines run `validate` -> `build` -> `test`.
- A `v*` tag (`BITBUCKET_TAG`) runs the full pipeline through `release`.
- **Custom (manual) pipelines** from the Pipelines UI:
  - `dry-run` — package + secure without publishing (mirror of GitLab's web
    dry-run).
  - `sync-github` — pushes the current branch + tags to GitHub with
    `--force-with-lease` (never bare `--force`) using a per-invocation
    `http.extraheader`; the token is never written to `.git/config`. Manual-only
    so it can never fight GitLab's push mirroring.

## Tag detection in the shared scripts

Bitbucket exposes `BITBUCKET_TAG` / `BITBUCKET_COMMIT` instead of GitLab's
`CI_COMMIT_TAG` / `CI_COMMIT_SHA`. The provider-neutral scripts
(`apply-tag-version.mjs`, `check-tag-unique.mjs`, `check-manifest.mjs`) resolve all
three providers' envs, so the YAML never has to translate.

## Caching / clone

The npm cache lives in `.npm` (same as GitLab, keyed by the lockfile via `npm ci
--cache .npm --prefer-offline`). `clone: depth: full` gives
`generate-release-notes.mjs` and `check-tag-unique.mjs` the full history + tag
namespace they need.

## First-time setup

1. Add the remote and push (nothing is removed from existing remotes):

   ```bash
   git remote add bitbucket https://<user>@bitbucket.org/limboo_/limboo.git
   git remote set-url --add --push origin https://<user>@bitbucket.org/limboo_/limboo.git
   git push bitbucket main
   ```

2. Enable Pipelines: **Repository settings -> Pipelines -> Settings -> Enable**.
3. Add `GITHUB_TOKEN` (Secured) under **Repository settings -> Repository
   variables**; optionally add `BITBUCKET_ACCESS_TOKEN` for Downloads uploads.
4. Cut a release exactly as on GitLab — push a `v*` tag (see
   [release-process.md](release-process.md)); never hand-bump `package.json`.

## Security posture (unchanged invariants)

Secrets only in Secured repository variables; no secrets in YAML; `--force-with-lease`
only; the same deny-by-default, argv-only, redaction rules as the rest of the
project (see [security.md](security.md)).
