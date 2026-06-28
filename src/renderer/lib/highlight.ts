/**
 * Thin wrapper over Shiki's singleton highlighter. `codeToHtml` lazily loads the
 * requested language + the bundled dark theme on demand and caches them, so we
 * never bundle every grammar eagerly. Returns themed HTML (one `<span class=
 * "line">` per line, which the CSS turns into gutter line numbers) or `null`
 * when the language is unknown — callers fall back to plain text.
 */
import { codeToHtml } from 'shiki';

/** Tuned to read well on the pure-black surface. */
const THEME = 'github-dark-default';

export async function highlightCode(code: string, lang?: string): Promise<string | null> {
  const language = (lang || '').toLowerCase().trim();
  try {
    return await codeToHtml(code, {
      lang: language || 'text',
      theme: THEME,
    });
  } catch {
    // Unknown grammar — render as uncolored plaintext upstream.
    try {
      return await codeToHtml(code, { lang: 'text', theme: THEME });
    } catch {
      return null;
    }
  }
}
