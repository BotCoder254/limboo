#!/usr/bin/env node
/**
 * apply-tag-version.mjs — make the pushed git tag the single source of truth for
 * the release version.
 *
 * On a release (v* tag) pipeline this rewrites `version` in package.json AND
 * package-lock.json to match the tag, so nobody has to hand-bump package.json
 * before tagging. The rewrite is EPHEMERAL in the build (CI never commits it back):
 * every artifact — the app's app.getVersion(), electron-builder's installers, and
 * the latest*.yml auto-update metadata — is derived from package.json, so applying
 * the tag version here makes them all agree with the Release tag automatically.
 *
 * No-op (exit 0) when there is no release tag, or the ref is not a vX.Y.Z tag
 * (ordinary commit pipelines and branch dry-runs keep the repo's baseline version).
 *
 * Provider-neutral (Node builtins only). Version source, in priority order:
 *   1. process.argv[2]   — explicit (e.g. GitHub Actions `inputs.ref`)
 *   2. CI_COMMIT_TAG     — GitLab
 *   3. GITHUB_REF_NAME   — GitHub Actions, when GITHUB_REF_TYPE=tag
 *
 * Usage: node ci/scripts/apply-tag-version.mjs [tag]
 */
import { readFile, writeFile } from 'node:fs/promises';

// vMAJOR.MINOR.PATCH with an optional -prerelease / +build suffix. Capture the
// version without the leading `v`.
const TAG_RE = /^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

function resolveTag() {
  const explicit = process.argv[2]?.trim();
  if (explicit) return explicit;
  if (process.env.CI_COMMIT_TAG?.trim()) return process.env.CI_COMMIT_TAG.trim();
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME?.trim())
    return process.env.GITHUB_REF_NAME.trim();
  return '';
}

async function rewriteVersion(file, version, patch) {
  let json;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.log(`[apply-tag-version] ${file} not updated: ${e.message}`);
    return;
  }
  const prev = json.version;
  patch(json, version);
  // 2-space indent + trailing newline matches this repo's JSON style.
  await writeFile(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`[apply-tag-version] ${file} ${prev} -> ${version}`);
}

async function main() {
  const tag = resolveTag();
  if (!tag) {
    console.log('[apply-tag-version] no release tag in context — leaving version unchanged.');
    return;
  }
  const m = TAG_RE.exec(tag);
  if (!m) {
    // A non-version ref (branch dry-run) is not an error — just skip.
    console.log(`[apply-tag-version] "${tag}" is not a vX.Y.Z tag — leaving version unchanged.`);
    return;
  }
  const version = m[1];

  await rewriteVersion('package.json', version, (pkg, v) => {
    pkg.version = v;
  });
  // Keep the lockfile in lockstep so `npm ci` / `npm run dist` see one version.
  await rewriteVersion('package-lock.json', version, (lock, v) => {
    lock.version = v;
    if (lock.packages && lock.packages['']) lock.packages[''].version = v;
  });

  console.log(`[apply-tag-version] applied release version ${version} from tag ${tag}.`);
}

main().catch((err) => {
  console.error('apply-tag-version failed:', err);
  process.exit(1);
});
