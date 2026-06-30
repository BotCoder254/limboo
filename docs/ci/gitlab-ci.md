# GitLab CI/CD

Defined in [`.gitlab-ci.yml`](../../.gitlab-ci.yml). Same stages, order and artifacts as
the GitHub Actions implementation, via the same `ci/scripts/*.mjs`.

## Stages

`validate` -> `build` -> `test` -> `package` -> `secure` -> `release`

- **validate**: `lint`, `compliance` (licenses + Electron invariants + manifest),
  `audit` (non-blocking), `secret-scan` (gitleaks image).
- **build**: renderer build + `npm run package`.
- **test**: `test:linux` runs the Electron smoke test under `xvfb`.
- **package**: `package:linux` runs `npm run make` (tags or manual web runs only).
- **secure**: SBOM (CycloneDX), checksums, signing verification.
- **release**: notes generation + a GitLab Release via `release-cli`.

## Prerequisites

- A GitLab project with CI/CD enabled and at least one Linux runner (the shared
  `node:20-bookworm` image is used by default).
- For macOS/Windows installers: register platform-specific runners and add
  `package:macos` / `package:windows` jobs that mirror `package:linux` with a `tags:`
  selector for those runners. GitLab's shared runners are Linux-only.

## CI/CD variables (secrets)

Set under **Settings -> CI/CD -> Variables**, always **Masked** and **Protected**
(protected so they are only exposed on protected branches/tags):

| Variable | Use |
| -------- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*` | macOS signing |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Windows signing |
| `GITLAB_TOKEN` | provided automatically to `release-cli` for releases |

Never place secrets in `.gitlab-ci.yml`. Use **environment protection** rules on the
release environment so only authorized maintainers can trigger publishes.

## Triggers

- Push / MR pipelines run `validate` -> `build` -> `test`.
- A tag (`CI_COMMIT_TAG`) runs the full pipeline through `release`.
- A manual pipeline started from the web UI (`CI_PIPELINE_SOURCE == "web"`) runs the
  packaging dry-run without publishing.

## Caching

`npm` cache is keyed on `package-lock.json`. `GIT_DEPTH: 0` ensures full history so
`generate-release-notes.mjs` can diff from the previous tag.

## Optional GitLab <- GitHub mirroring

If GitHub is primary, configure **Settings -> Repository -> Mirroring** to pull from
GitHub, and the tag-triggered `release` stage will mirror releases into GitLab Releases.
