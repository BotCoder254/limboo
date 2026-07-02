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
// dependency the whole app is built around; it ships one optional native package
// per platform (`-linux-x64`, `-linux-x64-musl`, `-linux-arm64`,
// `-linux-arm64-musl`, `-darwin-x64`, `-darwin-arm64`, `-win32-x64`, …) that npm
// installs selectively, so we except the whole family by PREFIX rather than
// enumerating every OS/libc/arch combo (which drifts as new variants ship).
// Each entry matches the package itself and any `<entry>-*` platform variant.
// Extend via PACKAGE_EXCEPTIONS env.
const DEFAULT_PACKAGE_EXCEPTIONS = [
  '@anthropic-ai/claude-agent-sdk',
];

const allowed = new Set(
  (process.env.ALLOWED_LICENSES?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_ALLOWED),
);
const packageExceptions = new Set([
  ...DEFAULT_PACKAGE_EXCEPTIONS,
  ...(process.env.PACKAGE_EXCEPTIONS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
]);

/**
 * A package is excepted if its name equals an exception entry OR is a platform
 * variant of one (`<entry>-*`) — e.g. `@anthropic-ai/claude-agent-sdk-linux-x64-musl`
 * matches the `@anthropic-ai/claude-agent-sdk` entry.
 */
function isExcepted(name) {
  for (const ex of packageExceptions) {
    if (name === ex || name.startsWith(`${ex}-`)) return true;
  }
  return false;
}

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
    if (isExcepted(pkg.name)) continue;
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
