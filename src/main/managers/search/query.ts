/**
 * Safe FTS5 query construction for the Search Engine. Mirrors the Local Memory
 * System's approach: every token is quoted so it is treated as a literal (never an
 * FTS operator), the result is always passed as a *bound* parameter, and callers
 * fall back to a bounded LIKE scan when there is nothing usable to match.
 *
 * We reuse Memory's {@link toFtsQuery} for content (default unicode tokenizer,
 * BM25) and add a trigram-aware builder for the symbol index (substring/fuzzy).
 */
import { toFtsQuery } from '../memory/MemoryManager';

export { toFtsQuery };

/** Lowercased detected language for a workspace-relative path, or undefined. */
export function langForPath(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext];
}

/**
 * Build a trigram MATCH expression for the symbol index. The trigram tokenizer
 * needs at least 3 characters; shorter queries return null so the caller can fall
 * back to a LIKE scan. The phrase is double-quoted so punctuation in the query is
 * treated literally. Always used as a bound parameter — this is query semantics,
 * not SQL safety.
 */
export function toTrigramQuery(text: string): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/"/g, '');
  if (trimmed.length < 3) return null;
  return `"${trimmed}"`;
}

/** A `%…%` LIKE pattern with FTS/LIKE wildcards escaped, capped in length. */
export function toLikePattern(text: string, max = 128): string {
  const cleaned = text.trim().slice(0, max).replace(/[%_\\]/g, (m) => `\\${m}`);
  return `%${cleaned}%`;
}

/** A `…%` prefix LIKE pattern (strict, non-fuzzy): matches only from the start. */
export function toPrefixPattern(text: string, max = 128): string {
  const cleaned = text.trim().slice(0, max).replace(/[%_\\]/g, (m) => `\\${m}`);
  return `${cleaned}%`;
}

/** Extension → language label. Kept small and pragmatic (drives the symbol parser). */
const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  swift: 'swift',
  scala: 'scala',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  vue: 'vue',
  svelte: 'svelte',
};

/** True for text extensions treated as documentation (drives the `doc` kind). */
export function isDocPath(path: string): boolean {
  const lang = langForPath(path);
  return lang === 'markdown' || /(^|\/)(readme|changelog|contributing|license)/i.test(path);
}
