# GitLab CI/CD — the primary pipeline

Defined in [`.gitlab-ci.yml`](../../.gitlab-ci.yml). **GitLab is Limboo's single
source of truth and the whole release authority.** On every `v*` tag the pipeline
packages branded installers, consolidates checksums + SBOM, generates release notes,
and publishes the **same build** to **both** a GitLab Release and a GitHub Release.
GitHub is never built independently — the repository is kept in sync by
[push mirroring](#repository-sync-github-stays-a-mirror) and a local dual-push origin.

All logic lives in provider-neutral [`ci/scripts/*.mjs`](../../ci/scripts); the YAML
only orchestrates. GitHub Actions' [`release.yml`](github-actions.md) remains a
manual-dispatch fallback publisher only.

## Stages

`validate` -> `build` -> `test` -> `package` -> `secure` -> `release`

- **validate**: `lint`, `compliance` (licenses + Electron invariants + manifest),
  `audit` (non-blocking), `secret-scan` (gitleaks image).
- **build**: renderer build + `npm run package`.
- **test**: `test:linux` runs the Electron smoke test under `xvfb`.
- **package**: one job per OS — `package:linux` (shared runner) plus
  `package:windows` / `package:macos` on GitLab SaaS hosted runners. Each runs
  `npm run dist -- --publish never` and stages release files into a per-OS
  `artifacts/<os>/` dir. Runs on `v*` tags (Linux also on a manual web dry-run).
- **secure**: flattens `artifacts/*/* -> dist/`, generates the SBOM (CycloneDX),
  `SHA256SUMS`, and verifies signatures (skips when unsigned).
- **release**: `release-notes` (categorized notes) -> `upload:packages` (installers
  into the Generic Package Registry) -> `release:gitlab` (GitLab Release + linked
  assets) **and** `release:github` (GitHub Release via the `gh` CLI).

## Multi-OS packaging (GitLab-hosted runners — no self-hosted anywhere)

GitLab's shared runners are Linux-only, so `package:linux` always runs there.
`package:windows` and `package:macos` target **GitLab's official hosted (SaaS)
runners** by tag:

| Job | Runner tag | Notes |
| --- | ---------- | ----- |
| `package:linux` | shared (Linux) | always available, all tiers |
| `package:windows` | `saas-windows-medium-amd64` | **beta, all tiers (Free included)**; PowerShell shell |
| `package:macos` | `saas-macos-medium-m1` | **Premium/Ultimate only**; Apple silicon -> arm64 |

Two hosted-runner gotchas the jobs encode (don't undo them):

- Both jobs set `inherit: default: false` — the pipeline default
  `image: node:22-bookworm` must never reach them. Hosted **Windows** VMs are not
  Docker executors (an `image:` keyword is invalid there); on hosted **macOS**,
  `image:` selects the VM environment, pinned to `macos-15-xcode-16`.
- Both bootstrap Node 22 first (chocolatey on Windows, Homebrew on macOS) in case
  the VM image lacks it.

Both jobs are `allow_failure: true` and the `secure` job needs them
`optional: true`, so **a Linux(+Windows)-only release still succeeds** when the
macOS runner isn't available on the current plan.

## CI/CD variables (secrets)

Set under **Settings -> CI/CD -> Variables**, always **Masked** and **Protected**
(protected so they are only exposed on protected branches/tags — see
[Protected tags](#protect-the-v-tag)):

| Variable | Use |
| -------- | --- |
| `GH_TOKEN` | **Required** for the GitHub Release. Fine-grained GitHub PAT, **Contents: read+write** on `BotCoder254/limboo`. `release:github` pre-flights it: unset -> exact setup instructions (a Protected variable is invisible on unprotected tags — protect `v*` too); set -> a `gh api repos/…` validity probe fails fast on an expired/underscoped token. |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS signing / notarization (optional) |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Windows signing (optional) |

GitLab Releases authenticate with the built-in **`CI_JOB_TOKEN`** — no stored
secret. Never place secrets in `.gitlab-ci.yml`. Redaction, the deny-by-default
posture, and `--force-with-lease` pushes are unchanged from the rest of the project.

## Triggers

- Push / MR pipelines run `validate` -> `build` -> `test`.
- A tag (`CI_COMMIT_TAG`) runs the full pipeline through `release`.
- A manual pipeline started from the web UI (`CI_PIPELINE_SOURCE == "web"`) runs the
  Linux packaging + `secure` dry-run without publishing.
- Tags containing a hyphen (e.g. `v1.2.0-rc.1`) publish as **pre-releases** on both
  hosts — use one as a dry run before the first real tag.

## Caching

`npm` cache is keyed on `package-lock.json`. `GIT_DEPTH: 0` ensures full history so
`generate-release-notes.mjs` can diff from the previous tag.

## First-time setup

### 1. Create the GitLab project and push

```bash
git remote add gitlab https://gitlab.com/BotCoder254/limboo.git
git push gitlab HEAD
```

### 2. GitHub fine-grained PAT

Create a fine-grained Personal Access Token scoped to `BotCoder254/limboo` with
**Contents: Read and write** (add **Workflows: Read and write** only if you mirror
`.github/workflows/**`). This one token is used for both mirroring and the GitHub
Release.

### 3. Repository sync (GitHub stays a mirror)

**Settings -> Repository -> Mirroring repositories -> Add**:

- URL: `https://<github-username>@github.com/BotCoder254/limboo.git`
- Direction: **Push**
- Password: the PAT from step 2
- Optionally enable *Mirror only protected branches*.

Every push to GitLab now replicates commits, branches, and tags to GitHub
automatically. Developers should never commit directly to GitHub (divergence forces
manual conflict resolution on the mirror).

For belt-and-suspenders, also make a local `git push` fan out to both hosts:

```bash
git remote set-url --add --push origin https://github.com/BotCoder254/limboo.git
git remote set-url --add --push origin https://gitlab.com/BotCoder254/limboo.git
git remote -v   # origin should list two push URLs
```

### 4. CI/CD variable

Add `GH_TOKEN` (the PAT) under **Settings -> CI/CD -> Variables**, **Masked** +
**Protected**. Add any signing variables the same way.

### 5. Protect the `v*` tag

**Settings -> Repository -> Protected tags** -> add `v*`, so protected variables are
available to the release jobs.

### 6. Hosted macOS/Windows runners

`package:windows` runs on GitLab's hosted Windows runner (beta) on **every tier —
nothing to enable**. `package:macos` needs a **Premium/Ultimate** namespace; on Free
tier it is skipped (`allow_failure`) and Linux + Windows installers still ship.

## Cutting a release

```bash
# commit with Conventional Commit subjects (NEVER hand-bump package.json — the
# tag drives the version via apply-tag-version.mjs), then:
git tag v1.2.0
git push origin v1.2.0   # -> GitLab (source of truth) + GitHub (mirror)
```

The `v*` tag triggers the pipeline; `release:gitlab` and `release:github` publish
identical artifacts to both hosts. See [release-process.md](release-process.md).
