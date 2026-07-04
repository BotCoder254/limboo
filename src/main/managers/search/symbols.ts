/**
 * Lightweight, language-aware symbol extractor for the Search Engine. Runs during
 * background content indexing to build a navigable index of declarations
 * (functions, classes, interfaces, types, …) without pulling in a full parser or
 * native grammars — a pragmatic, regex-based first cut, mirroring the Local Memory
 * System's "no heavyweight deps" stance.
 *
 * Accuracy is best-effort: it recognizes the common declaration forms per language
 * and falls back to a language-agnostic pass. It never executes code and only ever
 * reads the (already size-capped, text-only) content handed to it.
 */
import { SEARCH_LIMITS } from '@shared/constants';
import type { SymbolKind } from '@shared/types';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;
}

interface Rule {
  re: RegExp;
  kind: SymbolKind;
  /** Which capture group holds the symbol name (default 1). */
  group?: number;
}

/**
 * Extract symbols from a file's text. `lang` selects the rule set; anything
 * unknown uses a conservative generic pass. Deduped by name+line, capped to
 * {@link SEARCH_LIMITS.maxSymbolsPerFile}.
 */
export function extractSymbols(content: string, lang: string | undefined): ExtractedSymbol[] {
  const rules = RULES[lang ?? ''] ?? GENERIC_RULES;
  const lines = content.split(/\r?\n/);
  const out: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    if (out.length >= SEARCH_LIMITS.maxSymbolsPerFile) break;
    const raw = lines[i];
    // Skip obvious comment-only lines to cut noise (best-effort).
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    for (const rule of rules) {
      const m = rule.re.exec(raw);
      if (!m) continue;
      const name = m[rule.group ?? 1];
      if (!name || !isIdentifier(name)) continue;
      const key = `${name}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        kind: rule.kind,
        line: i + 1,
        signature: trimmed.slice(0, 200),
      });
      break; // one symbol per line
    }
  }
  return out;
}

function isIdentifier(s: string): boolean {
  // Internal hyphens are allowed for PowerShell-style Verb-Noun names.
  return s.length > 0 && s.length <= 128 && /^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/.test(s);
}

/* -------------------------------------------------------- language rule sets */

const TS_RULES: Rule[] = [
  { re: /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  { re: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
  { re: /\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  {
    re: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    kind: 'function',
  },
  { re: /\b(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*=/, kind: 'constant' },
  // Class method: `name(args) {` or `async name(args)`.
  { re: /^\s*(?:public|private|protected|static|readonly|async|\*|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, kind: 'method' },
];

const PY_RULES: Rule[] = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: 'function' },
];

const GO_RULES: Rule[] = [
  { re: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/, kind: 'function' },
  { re: /\btype\s+([A-Za-z_][\w]*)\s+struct\b/, kind: 'struct' },
  { re: /\btype\s+([A-Za-z_][\w]*)\s+interface\b/, kind: 'interface' },
  { re: /\btype\s+([A-Za-z_][\w]*)\b/, kind: 'type' },
];

const RUST_RULES: Rule[] = [
  { re: /\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/, kind: 'function' },
  { re: /\b(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, kind: 'struct' },
  { re: /\b(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/, kind: 'enum' },
  { re: /\b(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/, kind: 'trait' },
  { re: /\b(?:pub\s+)?type\s+([A-Za-z_][\w]*)/, kind: 'type' },
];

const JVM_RULES: Rule[] = [
  { re: /\b(?:public|private|protected|\s)*(?:abstract\s+|final\s+)?class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  { re: /\b(?:public|private|protected|\s)*interface\s+([A-Za-z_][\w]*)/, kind: 'interface' },
  { re: /\b(?:public|private|protected|\s)*enum\s+([A-Za-z_][\w]*)/, kind: 'enum' },
  {
    re: /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)+[\w<>[\].]+\s+([A-Za-z_][\w]*)\s*\(/,
    kind: 'method',
  },
];

const RUBY_RULES: Rule[] = [
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  { re: /^\s*module\s+([A-Za-z_][\w]*)/, kind: 'module' },
  { re: /^\s*def\s+([A-Za-z_][\w?!]*)/, kind: 'method' },
];

const POWERSHELL_RULES: Rule[] = [
  { re: /^\s*function\s+(?:[A-Za-z]+:)?([A-Za-z_][\w-]*)/i, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_][\w]*)/i, kind: 'class' },
];

const LUA_RULES: Rule[] = [
  { re: /^\s*(?:local\s+)?function\s+(?:[\w.:]+[.:])?([A-Za-z_][\w]*)/, kind: 'function' },
];

/** Conservative fallback for languages without a dedicated rule set. */
const GENERIC_RULES: Rule[] = [
  { re: /\b(?:class|struct|interface|enum|trait)\s+([A-Za-z_][\w]*)/, kind: 'class' },
  { re: /\b(?:function|func|def|fn|sub)\s+([A-Za-z_][\w]*)/, kind: 'function' },
];

const RULES: Record<string, Rule[]> = {
  typescript: TS_RULES,
  javascript: TS_RULES,
  vue: TS_RULES,
  svelte: TS_RULES,
  python: PY_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
  java: JVM_RULES,
  kotlin: JVM_RULES,
  scala: JVM_RULES,
  csharp: JVM_RULES,
  ruby: RUBY_RULES,
  astro: TS_RULES,
  powershell: POWERSHELL_RULES,
  lua: LUA_RULES,
};
