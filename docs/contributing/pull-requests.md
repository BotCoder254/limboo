# Pull requests

A good pull request is small, single-responsibility, verified, and documented. This
page describes what reviewers expect. The PR template prompts for all of it.

## Before opening

- Branch off `main`; never commit to `main` directly.
- Run the verification: `npm run lint` and
  `npx vite build --config vite.renderer.config.mts`. For main / preload changes,
  confirm `npm start` works.
- Update the relevant documentation under [docs/](../README.md) and add a
  [CHANGELOG](../../CHANGELOG.md) entry if the change is user-facing.

## What the PR should contain

- **Summary** — what and why, linking any issue.
- **Architectural reasoning** — for non-trivial changes: how it fits the process
  boundary, whether it adds an IPC channel (and the full path), any new store or
  feature folder, and any new dependency (and its Vite 5 / Electron 42
  compatibility).
- **Verification** — the commands you ran and manual testing steps.
- **Screenshots** — for any UI change.
- **Security checklist** — for main-process changes (input validation, bound SQL,
  argv spawns, path guards, no weakening of isolation / sandbox / CSP). See
  [the security model](../architecture/security-model.md).

## Review process

- A maintainer reviews for correctness, the contribution contracts, and fit with the
  architecture and theme.
- Address review comments by pushing follow-up commits; keep the discussion in the
  open.
- A change is merged when it meets the contracts, passes verification, and is
  approved by a maintainer. Governance details are in
  [GOVERNANCE.md](../../GOVERNANCE.md).

## Commit messages

Write clear, imperative messages that explain the why. Keep commits coherent — prefer
several focused commits over one large mixed commit.

## Scope discipline

If you notice an unrelated issue while working, prefer a separate PR or issue rather
than bundling it. Small, reviewable PRs merge faster and regress less.
