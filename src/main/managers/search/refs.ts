/**
 * Lightweight, language-aware import/reference extractor for the Search Engine's
 * dependency layer. Runs during the same background content-indexing pass that
 * owns {@link extractSymbols} to build a coarse edge list — one row per
 * `import`/`require`/`use`/`from` statement — without pulling in a full parser
 * or native grammars (same "no heavyweight deps" stance as the symbol extractor).
 *
 * Accuracy is best-effort: it recognizes the common import forms per language.
 * It never executes code and only reads the (already size-capped, text-only)
 * content handed to it. Resolution of a relative specifier to a workspace path
 * happens in the SearchManager against the already-indexed path set (pure path
 * math, no filesystem I/O) — this module only reports the raw specifier + kind.
 */
import { SEARCH_LIMITS } from '@shared/constants';

export type RefKind = 'import' | 'require' | 'use' | 'include';

export interface ExtractedRef {
  /** The raw module specifier as written (e.g. './foo', 'react', 'crypto'). */
  ref: string;
  kind: RefKind;
}

interface RefRule {
  re: RegExp;
  kind: RefKind;
  group?: number;
}

/**
 * Extract import/reference edges from a file's text. `lang` selects the rule
 * set; anything unknown yields no edges (conservative). Deduped by specifier,
 * capped to {@link SEARCH_LIMITS.maxRefsPerFile}.
 */
export function extractRefs(content: string, lang: string | undefined): ExtractedRef[] {
  const rules = RULES[lang ?? ''];
  if (!rules) return [];
  const lines = content.split(/\r?\n/);
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    if (out.length >= SEARCH_LIMITS.maxRefsPerFile) break;
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    for (const rule of rules) {
      // Reset lastIndex — rules may be global for multiple specifiers per line.
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(raw)) !== null) {
        const ref = m[rule.group ?? 1];
        if (ref && isSpecifier(ref)) {
          const key = `${rule.kind}:${ref}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ ref, kind: rule.kind });
            if (out.length >= SEARCH_LIMITS.maxRefsPerFile) break;
          }
        }
        if (!rule.re.global) break;
      }
    }
  }
  return out;
}

/** A plausible module specifier: bounded, printable, no whitespace/quotes/NUL. */
function isSpecifier(s: string): boolean {
  return s.length > 0 && s.length <= 512 && !/[\s"'`\0]/.test(s);
}

/* -------------------------------------------------------- language rule sets */

// TS/JS: `import … from 'x'`, `import 'x'`, `export … from 'x'`,
// `require('x')`, dynamic `import('x')`. Global so multiple per line are caught.
const TS_RULES: RefRule[] = [
  { re: /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, kind: 'import' },
  { re: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, kind: 'require' },
  { re: /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, kind: 'import' },
];

const PY_RULES: RefRule[] = [
  { re: /^\s*from\s+([.\w]+)\s+import\b/, kind: 'import' },
  { re: /^\s*import\s+([.\w]+)/, kind: 'import' },
];

const GO_RULES: RefRule[] = [{ re: /^\s*(?:[A-Za-z_.]+\s+)?"([^"]+)"/, kind: 'import' }];

const RUST_RULES: RefRule[] = [{ re: /^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/, kind: 'use' }];

const RUBY_RULES: RefRule[] = [
  { re: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/, kind: 'require' },
];

const JVM_RULES: RefRule[] = [{ re: /^\s*import\s+(?:static\s+)?([\w.]+)/, kind: 'import' }];

const CFAMILY_RULES: RefRule[] = [{ re: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/, kind: 'include' }];

const RULES: Record<string, RefRule[]> = {
  typescript: TS_RULES,
  javascript: TS_RULES,
  vue: TS_RULES,
  svelte: TS_RULES,
  astro: TS_RULES,
  python: PY_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
  ruby: RUBY_RULES,
  java: JVM_RULES,
  kotlin: JVM_RULES,
  scala: JVM_RULES,
  csharp: JVM_RULES,
  c: CFAMILY_RULES,
  cpp: CFAMILY_RULES,
};

/**
 * Resolve a *relative* specifier (`./x`, `../y`) to a workspace-relative POSIX
 * path against the set of already-indexed paths. Bare/package specifiers return
 * null. Pure path math — no filesystem I/O, no symlink risk. Any `..` escape
 * outside the workspace is rejected (null).
 */
export function resolveRelativeRef(
  srcPath: string,
  ref: string,
  indexed: Set<string>,
): string | null {
  if (!ref.startsWith('.')) return null;
  const srcDir = srcPath.includes('/') ? srcPath.slice(0, srcPath.lastIndexOf('/')) : '';
  const combined = srcDir ? `${srcDir}/${ref}` : ref;

  // Normalize `.`/`..` segments manually (POSIX, no Node path to avoid OS sep).
  const segments: string[] = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null; // escapes the workspace root
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  const base = segments.join('/');
  if (!base) return null;

  // Exact hit, then common source extensions, then a directory index file.
  if (indexed.has(base)) return base;
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb'];
  for (const ext of exts) {
    if (indexed.has(base + ext)) return base + ext;
  }
  for (const ext of exts) {
    if (indexed.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  return null;
}
