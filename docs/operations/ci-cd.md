# CI/CD

This page documents the repository automation under
[`.github/`](../../.github). CI is intentionally lightweight: it runs the project's
prescribed verification, not a heavy multi-OS build matrix.

## Workflows

### CI (`.github/workflows/ci.yml`)

Runs on pushes and pull requests to `main`. It installs the system build
dependencies (a C/C++ toolchain for the native modules), runs `npm ci`, then:

```bash
npm run lint
npx vite build --config vite.renderer.config.mts
```

This mirrors the local verification path (see
[testing and verification](../contributing/testing-and-verification.md)). It does
**not** run `tsc`, by design. Node 20, Ubuntu, with npm caching and in-progress
cancellation per ref.

### CodeQL (`.github/workflows/codeql.yml`)

Static analysis for `javascript-typescript` on pushes and PRs to `main`, plus a
weekly scheduled scan. Results surface in the repository Security tab.

## Dependabot (`.github/dependabot.yml`)

Weekly updates for the npm and github-actions ecosystems, grouped into production and
development dependency PRs. Electron and Vite are ignored on purpose — they are
pinned and bumped deliberately because of the toolchain coupling documented in
[`CLAUDE.md`](../../CLAUDE.md). See
[dependency updates](dependency-updates.md).

## Issue and PR templates

- Issue forms live under `.github/ISSUE_TEMPLATE/` (bug report, feature request,
  documentation), with `config.yml` disabling blank issues and linking Discussions
  and private security reporting.
- The pull-request template (`.github/PULL_REQUEST_TEMPLATE.md`) prompts for
  verification, the security checklist, screenshots, architectural reasoning, and a
  changelog entry.

## CODEOWNERS

`.github/CODEOWNERS` routes review requests to the maintainer.

## Planned

A documentation link-check, a release-on-tag pipeline, and a multi-OS installer
matrix (with code signing) are natural future additions once signing material exists;
see [packaging and signing](packaging-and-signing.md) and
[ROADMAP.md](../../ROADMAP.md).
