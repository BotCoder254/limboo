# Documentation standards

Documentation is a first-class deliverable in Limboo. This page defines how to write
it so the docs stay consistent, accurate, and maintainable.

## The five layers

The documentation is a subsystem in five layers, not a single file:

1. **Landing page** — the root [README](../../README.md). Concise; answers what /
   why / install / run / contribute / where-are-the-docs. Implementation detail is
   pushed into the docs.
2. **Documentation site** — this `docs/` tree: getting started, concepts, guides,
   and reference.
3. **Contributor documentation** — the root community-health files and this
   `contributing/` folder.
4. **Architecture documentation** — `docs/architecture/`, including a page per
   subsystem.
5. **Operational documentation** — `docs/operations/`, for maintainers.

Put new content in the layer it belongs to; do not grow the README into a manual.

## Writing style

- **No emojis.** Anywhere.
- **Terse and technical.** Short declarative sentences. Match the voice of
  [`CLAUDE.md`](../../CLAUDE.md).
- **Why before how.** Open each subsystem / architecture page with a short paragraph
  on why it exists before the mechanics.
- **Current reality, not aspiration.** Describe what is built. Mark genuinely unbuilt
  work as "Planned" and link [ROADMAP.md](../../ROADMAP.md).
- **Concrete references.** Write file paths as repo-relative inline code and link
  them. Use tables for enumerations and fenced ASCII for diagrams, matching
  [`project.md`](../../project.md).
- **Cross-link, do not duplicate.** Link to `CLAUDE.md`, `project.md`, and other
  pages rather than restating them. Keep one source of truth per fact.

## Accuracy

Reference pages (IPC channels, the `window.limboo` API, settings, design tokens,
commands) must match the source. When you change code that a reference page
describes, update the page in the same PR. The source files named on each reference
page are authoritative; the docs mirror them.

## Structure of a subsystem page

Follow the existing pages: Purpose -> Responsibilities -> Public surface (key
methods) -> Submodules (if any) -> Dependencies and wiring -> Data flow -> Security
boundary -> Planned. See, for example,
[the Git Engine page](../architecture/subsystems/git-engine.md).

## Links

Use relative markdown links so they work both on GitHub and in any static-site
generator the docs are later fed to. Verify links resolve before opening the PR.
