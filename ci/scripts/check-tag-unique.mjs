#!/usr/bin/env node
/**
 * check-tag-unique.mjs — refuse a release that re-tags an already-tagged commit.
 *
 * The failure mode this prevents: v1.2.8 and v1.2.9 were both created on the SAME
 * commit, so v1.2.9's release was byte-for-byte identical to v1.2.8 and shipped ZERO
 * new code. A stale/duplicate tag silently produces an "empty" release. This gate
 * fails FAST (in the validate stage, before the expensive build) when the commit
 * being released already carries another v* tag.
 *
 * Provider-neutral (Node builtins only). Runs only on a release (v* tag) pipeline;
 * a no-op (exit 0) on ordinary commit pipelines and branch dry-runs. Tag source and
 * matching mirror ci/scripts/apply-tag-version.mjs.
 *
 * Usage: node ci/scripts/check-tag-unique.mjs [tag]
 */
import { execFileSync } from 'node:child_process';

// vMAJOR.MINOR.PATCH with an optional -prerelease / +build suffix.
const TAG_RE = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function resolveTag() {
  const explicit = process.argv[2]?.trim();
  if (explicit) return explicit;
  if (process.env.CI_COMMIT_TAG?.trim()) return process.env.CI_COMMIT_TAG.trim();
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME?.trim())
    return process.env.GITHUB_REF_NAME.trim();
  return '';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const tag = resolveTag();
  if (!tag) {
    console.log('[check-tag-unique] no release tag in context — nothing to check.');
    return;
  }
  if (!TAG_RE.test(tag)) {
    console.log(`[check-tag-unique] "${tag}" is not a vX.Y.Z tag — skipping.`);
    return;
  }

  // Make sure every tag is available locally — CI checkouts of a single tag ref
  // don't fetch the rest of the tag namespace, which we need to detect collisions.
  try {
    git(['fetch', '--tags', '--force']);
  } catch (e) {
    // Non-fatal: fall back to whatever tags are already present locally.
    console.log(`[check-tag-unique] warning: 'git fetch --tags' failed (${e.message.split('\n')[0]}); using local tags only.`);
  }

  // Resolve the commit the release is built from. CI exposes it directly; otherwise
  // dereference the tag (or HEAD) to its underlying commit.
  let sha;
  try {
    const ref = process.env.CI_COMMIT_SHA?.trim() || tag;
    sha = git(['rev-parse', `${ref}^{commit}`]);
  } catch {
    sha = git(['rev-parse', 'HEAD^{commit}']);
  }

  // Every v* tag pointing at this exact commit, other than the one being released.
  const others = git(['tag', '--points-at', sha])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t && t !== tag && TAG_RE.test(t));

  if (others.length) {
    console.error(
      `\n[check-tag-unique] FAIL: commit ${sha.slice(0, 12)} is already tagged by ` +
        `${others.join(', ')}.\n` +
        `Releasing ${tag} here would ship a build identical to ${others[0]} (no new code) — ` +
        `the exact v1.2.8/v1.2.9 mistake.\n` +
        `Tag a commit that carries the changes you intend to release (usually the tip of main).`,
    );
    process.exit(1);
  }

  console.log(`[check-tag-unique] OK: ${tag} points at ${sha.slice(0, 12)}, not shared with any other v* tag.`);
}

try {
  main();
} catch (err) {
  console.error('check-tag-unique failed:', err.message || err);
  process.exit(1);
}
