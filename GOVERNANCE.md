# Governance

This document describes how decisions are made in the Limboo project. It is
intentionally lightweight and will evolve as the community grows.

## Model

Limboo currently follows a **maintainer-led (BDFL-style)** model. The project
maintainer has final authority over technical direction, releases, and the
acceptance of contributions, and is responsible for keeping the project aligned with
its guiding principles: fast, local, private, modular, secure, responsive,
observable, predictable, and recoverable (see [`project.md`](project.md) §4).

## Roles

- **Maintainer** — owns the roadmap, reviews and merges contributions, cuts
  releases, and stewards the architecture. Currently [@BotCoder254](https://github.com/BotCoder254).
- **Contributors** — anyone who opens issues or pull requests. Contributors do not
  need any formal status to participate.

As the project grows, additional maintainers may be invited based on a sustained
track record of high-quality contributions and good judgment about the project's
direction.

## Decision making

- **Day-to-day changes** are decided through pull-request review. A change is
  accepted when it meets the [contribution contracts](CONTRIBUTING.md), passes
  verification, and is approved by a maintainer.
- **Significant changes** (new subsystems, dependency or architecture changes,
  anything that affects the process boundary, the security posture, or the dark-only
  theme) should start as an issue or discussion so the approach can be agreed before
  implementation.
- **Disagreements** are resolved through discussion in the open. If consensus is not
  reached, the maintainer makes the final call.

## Principles that constrain decisions

Some properties are not up for negotiation through ordinary review because they
define what Limboo is:

- The renderer never performs OS work; all such work crosses the IPC boundary.
- Local-first: no backend, no telemetry, no stored credentials.
- Dark mode only on a true `#000000` background.
- The security hardening documented in
  [docs/architecture/security-model.md](docs/architecture/security-model.md) is not
  weakened.

Changing any of these requires an explicit, well-justified proposal and maintainer
approval.

## Releases

Releases follow [Semantic Versioning](https://semver.org/) and the process in
[docs/operations/release-process.md](docs/operations/release-process.md). The
maintainer is responsible for tagging and publishing releases and updating the
[CHANGELOG](CHANGELOG.md).
