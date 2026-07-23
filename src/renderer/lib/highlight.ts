/**
 * Thin wrapper over a cached Shiki highlighter. We build the highlighter on
 * Shiki's **JavaScript RegExp engine** (`shiki/engine/javascript`) rather than
 * the default WASM Oniguruma engine: the production CSP is `script-src 'self'
 * blob:` (no `unsafe-eval`, no `wasm-unsafe-eval`), so WASM instantiation is
 * blocked and the WASM engine silently fails — leaving code blocks unhighlighted
 * in packaged builds. The JS engine needs neither WASM nor `unsafe-eval`, so it
 * works under the strict CSP. Languages are loaded lazily on first use and cached.
 *
 * Returns themed HTML (one `<span class="line">` per line, which the CSS turns
 * into gutter line numbers) or `null` when highlighting fails entirely — callers
 * fall back to plain text.
 */
import { createHighlighter, type Highlighter } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** Tuned to read well on the pure-black surface. */
const THEME = 'github-dark-default';

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

/** Lazily create the singleton highlighter (JS engine, no WASM). */
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/** Ensure `lang` is loaded; return the usable language id (falls back to text). */
async function ensureLang(hl: Highlighter, lang: string): Promise<string> {
  if (!lang || lang === 'text') return 'text';
  if (loadedLangs.has(lang)) return lang;
  try {
    await hl.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0]);
    loadedLangs.add(lang);
    return lang;
  } catch {
    // Unknown/unsupported grammar — render as uncolored plaintext.
    return 'text';
  }
}

export async function highlightCode(code: string, lang?: string): Promise<string | null> {
  const requested = (lang || '').toLowerCase().trim();
  try {
    const hl = await getHighlighter();
    const language = await ensureLang(hl, requested);
    return hl.codeToHtml(code, { lang: language, theme: THEME });
  } catch {
    // Total failure (engine/theme) — let the caller show plain text.
    return null;
  }
}
