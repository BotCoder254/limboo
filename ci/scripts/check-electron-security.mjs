#!/usr/bin/env node
/**
 * check-electron-security.mjs — assert Limboo's Electron security invariants are
 * still in place. These mirror CLAUDE.md §6 and Electron's own hardening
 * recommendations; the point is that a careless edit can never silently weaken
 * the security boundary without turning CI red.
 *
 * Provider-neutral (Node builtins only). Static source assertions — fast,
 * deterministic, no app launch required.
 *
 * Usage: node ci/scripts/check-electron-security.mjs
 */
import { readFile } from 'node:fs/promises';

/** Each rule: a file, a human label, and a predicate over the file's source. */
const RULES = [
  {
    file: 'src/main/window/createWindow.ts',
    checks: [
      ['contextIsolation is enabled', (s) => /contextIsolation:\s*true/.test(s) && !/contextIsolation:\s*false/.test(s)],
      ['nodeIntegration is disabled', (s) => !/nodeIntegration:\s*true/.test(s)],
      ['sandbox is enabled', (s) => /sandbox:\s*true/.test(s) && !/sandbox:\s*false/.test(s)],
      ['webSecurity is not disabled', (s) => !/webSecurity:\s*false/.test(s)],
      ['window open handler is denied', (s) => /setWindowOpenHandler/.test(s)],
      ['navigation is guarded', (s) => /will-navigate/.test(s)],
    ],
  },
  {
    file: 'src/main/index.ts',
    checks: [
      ['dark theme is forced', (s) => /themeSource\s*=\s*['"]dark['"]/.test(s)],
      ['a Content-Security-Policy is applied', (s) => /Content-Security-Policy/i.test(s)],
      ['permission requests are denied by default', (s) => /setPermissionRequestHandler/.test(s)],
    ],
  },
  {
    file: 'src/main/ipc/registry.ts',
    checks: [
      ['IPC sender origin is validated', (s) => /senderFrame/.test(s) && /origin/.test(s)],
    ],
  },
];

async function main() {
  const failures = [];
  for (const rule of RULES) {
    let src;
    try {
      src = await readFile(rule.file, 'utf8');
    } catch {
      failures.push(`${rule.file}: file not found`);
      continue;
    }
    for (const [label, predicate] of rule.checks) {
      if (predicate(src)) {
        console.log(`  ok   ${rule.file} — ${label}`);
      } else {
        failures.push(`${rule.file} — ${label}`);
        console.log(`  FAIL ${rule.file} — ${label}`);
      }
    }
  }

  if (failures.length) {
    console.error(`\nElectron security invariants violated (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nSee CLAUDE.md §6 and docs/ci/security.md. Do NOT weaken these.');
    process.exit(1);
  }
  console.log('\nAll Electron security invariants hold.');
}

main().catch((err) => {
  console.error('check-electron-security failed:', err);
  process.exit(1);
});
