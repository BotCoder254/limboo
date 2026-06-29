# Support

Thanks for using Limboo. This document explains where to get help and how to ask so
you get a useful answer quickly.

## Where to go

- **Documentation** — most questions are answered in the [docs](docs/README.md).
  Start with [getting started](docs/getting-started/installation.md), the
  [guides](docs/guides/using-the-agent.md), and the
  [reference](docs/reference/window-limboo-api.md).
- **Questions and ideas** — use GitHub Discussions on the
  [repository](https://github.com/BotCoder254/limboo) for usage questions, ideas,
  and general help.
- **Bugs** — open an issue using the **Bug report** template.
- **Feature requests** — open an issue using the **Feature request** template.
- **Security** — do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Before opening an issue

- Search existing issues and discussions for a duplicate.
- Confirm you are on the latest version.
- Re-test from a clean start (`npm start`) where possible.

## What to include in a bug report

- What you expected to happen and what actually happened.
- Exact steps to reproduce.
- Your platform (OS and version) and Limboo version.
- Relevant logs. The main-process logger writes to a file under the OS user-data
  directory; see [docs/operations/debugging.md](docs/operations/debugging.md).
- A screenshot or short recording for UI issues.

## What this project does not support

- Limboo does not provide the AI model. Questions about the coding agent's behavior,
  pricing, or authentication belong with the agent / provider, not here. Limboo only
  orchestrates the agent. See
  [docs/guides/using-the-agent.md](docs/guides/using-the-agent.md).
