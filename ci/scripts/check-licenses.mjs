#!/usr/bin/env node
/**
 * check-licenses.mjs — fail the pipeline if a dependency carries a disallowed
 * (e.g. strong-copyleft / unknown) license.
 *
 * Provider-neutral (Node builtins only). Reads the license field of every
 * installed package under node_modules and checks it against an allowlist of
 * SPDX identifiers known to be safe for a distributed desktop application. This
 * is a fast, offline gate — it is NOT a substitute for legal review, just a
 * regression guard so a surprising license never lands silently.
 *
 * Usage: node ci/scripts/check-licenses.mjs
 * Override the allowlist with ALLOWED_LICENSES="MIT,ISC,..." if needed.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_ALLOWED = [
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0',
  'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'Unlicense', 'Python-2.0', 'BlueOak-1.0.0',
  'MIT-0', 'WTFPL', 'Zlib', 'BSD', 'Apache 2.0',
  // Weak / file-level copyleft — safe to distribute alongside a desktop app.
  'MPL-2.0', 'LGPL-3.0-or-later', 'LGPL-2.1-or-later',
];

// Packages whose license is non-SPDX ("SEE LICENSE IN ...") or otherwise needs a
// reviewed, name-scoped exception. The Anthropic Agent SDK is a first-party
// dependency the whole app is built around. Extend via PACKAGE_EXCEPTIONS env.
const DEFAULT_PACKAGE_EXCEPTIONS = [
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
];

const allowed = new Set(
  (process.env.ALLOWED_LICENSES?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_ALLOWED),
);
const packageExceptions = new Set([
  ...DEFAULT_PACKAGE_EXCEPTIONS,
  ...(process.env.PACKAGE_EXCEPTIONS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
]);

/** Pull a comparable license string out of a package.json `license`/`licenses`. */
function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

/** Treat SPDX expressions leniently: pass if ANY listed license is allowed. */
function isAllowed(expr) {
  return expr
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.replace(/\+$/, '').trim())
    .some((id) => allowed.has(id));
}

async function* packages(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      yield* packages(join(root, entry.name));
      continue;
    }
    const dir = join(root, entry.name);
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name) yield pkg;
    } catch {
      /* not a package dir — skip */
    }
    // Nested node_modules (hoisting fallbacks).
    yield* packages(join(dir, 'node_modules'));
  }
}

async function main() {
  const violations = [];
  let count = 0;
  for await (const pkg of packages('node_modules')) {
    count++;
    if (packageExceptions.has(pkg.name)) continue;
    const lic = licenseOf(pkg);
    if (lic === 'UNKNOWN' || !isAllowed(lic)) {
      violations.push(`${pkg.name}@${pkg.version ?? '?'}: ${lic}`);
    }
  }

  console.log(`Scanned ${count} installed package(s).`);
  if (violations.length) {
    console.error(`\nDisallowed / unknown licenses (${violations.length}):`);
    for (const v of violations.sort()) console.error(`  - ${v}`);
    console.error('\nAdd a reviewed exception via ALLOWED_LICENSES or replace the dependency.');
    process.exit(1);
  }
  console.log('All dependency licenses are on the allowlist.');
}

main().catch((err) => {
  console.error('check-licenses failed:', err);
  process.exit(1);
});
