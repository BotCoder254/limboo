#!/usr/bin/env node
/**
 * verify-signing.mjs — verify code signatures on built artifacts where signing is
 * configured, and exit cleanly (skip) where it is not.
 *
 * Provider-neutral. Limboo stores NO signing credentials in the repo; signing is
 * opt-in and driven entirely by provider secrets (see docs/ci/code-signing.md).
 * This script therefore:
 *   - On macOS: runs `codesign --verify` + `spctl` assessment on .app/.zip when
 *     a signing identity is expected (CSC_LINK / APPLE signing env present).
 *   - On Windows: runs `signtool verify` on .exe when WINDOWS_CERT* env present.
 *   - On Linux / when no signing env is set: prints "signing not configured" and
 *     exits 0 so unsigned dev/PR builds never fail the pipeline.
 *
 * Usage: node ci/scripts/verify-signing.mjs [artifactDir=out/make]
 */
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const artifactDir = process.argv[2] ?? 'out/make';
const platform = process.platform;

const macSigning = !!(process.env.CSC_LINK || process.env.APPLE_CERTIFICATE || process.env.APPLE_ID);
const winSigning = !!(process.env.WINDOWS_CERTIFICATE || process.env.WIN_CSC_LINK || process.env.SM_CODE_SIGNING_CERT_SHA1_HASH);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), missing: r.error?.code === 'ENOENT' };
}

async function collect(extensions) {
  const matches = [];
  for await (const file of walk(artifactDir)) {
    if (extensions.some((e) => file.toLowerCase().endsWith(e))) matches.push(file);
  }
  return matches;
}

async function main() {
  if (platform === 'darwin' && macSigning) {
    const targets = await collect(['.app', '.dmg', '.zip']);
    let failed = false;
    for (const t of targets) {
      const v = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', t]);
      console.log(`codesign ${t}: ${v.ok ? 'OK' : 'FAIL'}`);
      if (!v.ok && !v.missing) {
        console.error(v.out);
        failed = true;
      }
    }
    process.exit(failed ? 1 : 0);
  }

  if (platform === 'win32' && winSigning) {
    const targets = await collect(['.exe', '.msi', '.nupkg']);
    let failed = false;
    for (const t of targets) {
      const v = run('signtool', ['verify', '/pa', '/v', t]);
      console.log(`signtool ${t}: ${v.ok ? 'OK' : 'FAIL'}`);
      if (!v.ok && !v.missing) {
        console.error(v.out);
        failed = true;
      }
    }
    process.exit(failed ? 1 : 0);
  }

  console.log(`verify-signing: signing not configured for ${platform} — skipping (this is expected for dev/PR builds).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-signing failed:', err);
  process.exit(1);
});
