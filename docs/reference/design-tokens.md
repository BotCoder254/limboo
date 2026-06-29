# Reference: design tokens

Limboo is dark mode only, on a true `#000000` background. There is no light mode and
no theme toggle. Tokens are defined in the Tailwind v4 `@theme` block of
[`src/renderer/styles/index.css`](../../src/renderer/styles/index.css) and become
utilities automatically (for example `bg-base`, `text-fg`, `border-line`,
`text-accent`).

## Palette

| Token | Value | Use |
| ----- | ----- | --- |
| `--color-base` | `#000000` | app background (`bg-base`) |
| `--color-surface` | `#0a0a0a` | panels / sidebars (`bg-surface`) |
| `--color-surface-2` | `#111111` | cards, inputs, hover wells |
| `--color-elevated` | `#161616` | popovers / active rows |
| `--color-line` | `#1c1c1c` | hairline borders (`border-line`) |
| `--color-line-strong` | `#2a2a2a` | emphasized borders / scrollbar thumb |
| `--color-fg` | `#ededed` | primary text (`text-fg`) |
| `--color-muted` | `#9a9a9a` | secondary text (`text-muted`) |
| `--color-faint` | `#6b6b6b` | tertiary / disabled (`text-faint`) |
| `--color-accent` | `#6e9bff` | accent / primary action |
| `--color-accent-fg` | `#b9ccff` | text on accent |
| `--color-success` | `#3fb950` | success / additions / active status |
| `--color-warning` | `#d29922` | warning / idle status |
| `--color-danger` | `#f85149` | errors / deletions |

## Typography

- `--font-sans` — Inter, then system sans-serif fallbacks.
- `--font-mono` — `ui-monospace`, SF Mono, JetBrains Mono, Fira Code, and fallbacks.
- Root font size is `calc(16px * var(--limboo-font-scale, 1))`; the font scale is
  driven by `appearance.fontScale`.

## Enforcement (defense in depth)

Dark-only is enforced at several layers:

1. **Main process** — `nativeTheme.themeSource = 'dark'`; the window uses
   `backgroundColor: '#000000'` with a `ready-to-show` gate to avoid a white flash.
2. **HTML** — `<html class="dark">` and `<meta name="color-scheme" content="dark">`.
3. **CSS** — `:root { color-scheme: dark; }`, a black `body`, dark scrollbars, and
   the token palette. Reduced motion is honored via
   `html[data-reduced-motion="true"]`.

## Usage rules

- Use tokens, never off-palette hex. For a new surface, step up the gray ramp
  (`base -> surface -> surface-2 -> elevated`) rather than inventing a value.
- Keep everything legible on pure black: `text-fg` for primary content, `text-muted`
  for secondary, `border-line` for borders. Never put dark-gray text on black for
  primary content.
- No `dark:` variants (there is only one theme), no gradients.
- Add new tokens in the `@theme` block, not a config file; Tailwind v4 is CSS-first
  with no `tailwind.config.js`. Use `@utility` / `@custom-variant` in that CSS file
  for custom utilities.
