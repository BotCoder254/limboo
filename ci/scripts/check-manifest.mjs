#!/usr/bin/env node
/**
 * check-manifest.mjs — package-manifest and documentation integrity gate.
 *
 * Provider-neutral (Node builtins only). Catches the cheap, high-signal mistakes
 * before the expensive build runs:
 *   - package.json is valid JSON and declares name + version + the scripts CI uses.
 *   - The Forge entry points referenced in the build still exist on disk.
 *   - package-lock.json is present and in sync with package.json's version.
 *   - The CI docs index references every provider guide that exists.
 *
 * Usage: node ci/scripts/check-manifest.mjs
 */
import { readFile, access } from 'node:fs/promises';

const errors = [];
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => {
  errors.push(m);
  console.log(`  FAIL ${m}`);
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let pkg;
  try {
    pkg = JSON.parse(await readFile('package.json', 'utf8'));
    ok('package.json is valid JSON');
  } catch (e) {
    fail(`package.json is not valid JSON: ${e.message}`);
    finish();
    return;
  }

  if (pkg.name) ok(`name: ${pkg.name}`);
  else fail('package.json is missing "name"');

  if (/^\d+\.\d+\.\d+/.test(pkg.version ?? '')) ok(`version: ${pkg.version}`);
  else fail(`package.json version is not semver: ${pkg.version}`);

  // On a release (v* tag) pipeline, the build derives every artifact — the app's
  // app.getVersion() and electron-builder's latest.yml — from package.json, while
  // the GitHub/GitLab Release is tagged from the git tag. If the two disagree the
  // Release ships mislabeled binaries and electron-updater never detects the new
  // version. Versioning is TAG-DRIVEN: ci/scripts/apply-tag-version.mjs runs EARLIER
  // in the job and stamps the tag version into package.json, so this check is now a
  // post-apply safety net — it verifies the stamp landed rather than demanding a
  // manual pre-bump. Only enforced when a release tag is present, so ordinary commit
  // pipelines are unaffected. Reads the CI tag env (GitLab: CI_COMMIT_TAG;
  // GitHub Actions: GITHUB_REF_NAME when GITHUB_REF_TYPE=tag; Bitbucket
  // Pipelines: BITBUCKET_TAG).
  const releaseTag =
    process.env.CI_COMMIT_TAG ||
    (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '') ||
    process.env.BITBUCKET_TAG ||
    '';
  if (releaseTag) {
    const tagVersion = releaseTag.replace(/^v/, '');
    if (tagVersion === pkg.version) ok(`release tag ${releaseTag} matches package.json version`);
    else
      fail(
        `release tag ${releaseTag} (=${tagVersion}) does not match package.json version ` +
          `${pkg.version} — apply-tag-version.mjs should have stamped it; ensure it runs ` +
          `before this check in the job`,
      );
  }

  for (const s of ['start', 'package', 'make', 'lint']) {
    if (pkg.scripts?.[s]) ok(`script "${s}" present`);
    else fail(`package.json is missing the "${s}" script`);
  }

  if (pkg.main) {
    if (await exists(pkg.main) || pkg.main.startsWith('.vite/')) ok(`main entry declared: ${pkg.main}`);
    else fail(`package.json "main" points at a missing file: ${pkg.main}`);
  }

  // Source entry points the build relies on (compiled by the Forge Vite plugin).
  for (const f of [
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/renderer/main.tsx',
    'vite.renderer.config.mts',
    'forge.config.ts',
  ]) {
    if (await exists(f)) ok(`entry exists: ${f}`);
    else fail(`missing build entry: ${f}`);
  }

  if (await exists('package-lock.json')) ok('package-lock.json present (npm ci will work)');
  else fail('package-lock.json is missing — CI uses `npm ci` and requires it');

  // Docs integrity: index should link the guides that exist.
  if (await exists('docs/ci/README.md')) {
    const idx = await readFile('docs/ci/README.md', 'utf8');
    for (const g of ['github-actions', 'gitlab-ci', 'bitbucket-pipelines', 'release-process', 'security']) {
      if (await exists(`docs/ci/${g}.md`)) {
        if (idx.includes(`${g}.md`)) ok(`docs index links ${g}.md`);
        else fail(`docs/ci/README.md does not link ${g}.md`);
      }
    }
  }

  finish();
}

function finish() {
  if (errors.length) {
    console.error(`\nManifest integrity check failed (${errors.length} problem(s)).`);
    process.exit(1);
  }
  console.log('\nManifest + docs integrity OK.');
}

main().catch((err) => {
  console.error('check-manifest failed:', err);
  process.exit(1);
});
