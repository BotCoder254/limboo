# CI/CD security model

Security is a first-class, every-commit concern, not a post-release step. This mirrors
CLAUDE.md §6 and modern supply-chain guidance (GitHub Artifact Attestations / SLSA).

## Every commit

| Control | Where |
| ------- | ----- |
| Secret scanning | GitLab `secret-scan` (gitleaks) / `security.yml` (gitleaks) |
| Dependency audit | `npm audit --audit-level=high` in `validate` |
| Dependency review (PRs) | `actions/dependency-review-action` |
| License compliance | [`check-licenses.mjs`](../../ci/scripts/check-licenses.mjs) |
| SAST | `codeql.yml` |
| Electron security invariants | [`check-electron-security.mjs`](../../ci/scripts/check-electron-security.mjs) |
| Manifest integrity | [`check-manifest.mjs`](../../ci/scripts/check-manifest.mjs) |

## Electron invariants enforced in CI

`check-electron-security.mjs` fails the build if any of these regress (verified against
the real source): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity` not disabled, a denied window-open handler, guarded navigation, forced dark
theme, an applied Content-Security-Policy, deny-by-default permission handler, and IPC
sender-origin validation. The `smoke-test.mjs` runtime check additionally asserts that
Node globals (`require`/`module`/`process`) are absent from the renderer at boot.

## Every release

- **SBOM** (CycloneDX) generated and attached.
- **Checksums** (`SHA256SUMS`) for every artifact.
- **Code signing** verified where configured (see [code-signing.md](code-signing.md)).
- **Build-provenance + SBOM attestations** via GitHub artifact attestations
  (`id-token: write`, `attestations: write`). This provides SLSA Build L2 out of the box;
  the reusable `_package.yml` build is the basis for moving to L3.

Consumers verify with `gh attestation verify <file> --repo BotCoder254/limboo`. Adopt
verification in **audit mode** first (log, don't block), then enforce.

## Secrets and tokens

- Least privilege: workflows default to `permissions: contents: read`; jobs widen only
  what they need.
- Prefer the built-in `GITHUB_TOKEN` + OIDC over long-lived credentials.
- Secrets live ONLY in the provider secret store (GitLab masked+protected variables —
  primary; GitHub Secrets for the Actions fallback) — never in the repo or in YAML.
- Developer `gh` authentication is for manual workflows; it is never wired into automation.
- Pin third-party actions to a commit SHA where practical; protect release environments.

## Reporting vulnerabilities

See the top-level [SECURITY.md](../../SECURITY.md).
