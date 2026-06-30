#!/usr/bin/env node
/**
 * generate-release-notes.mjs — produce human-readable, categorized release notes
 * from git history between the previous tag and a target ref.
 *
 * Provider-neutral (Node builtins + git only). Rather than dumping raw commit
 * messages, it groups Conventional-Commit-style subjects into sections (Features,
 * Fixes, Performance, Security, …), lists other notable commits, surfaces
 * BREAKING CHANGES, and credits contributors. The output is Markdown suitable for
 * a GitHub/GitLab Release body.
 *
 * Usage:
 *   node ci/scripts/generate-release-notes.mjs [toRef=HEAD] [outFile]
 *   # toRef is typically the tag being released, e.g. v1.2.0
 *   # If outFile is omitted, notes are printed to stdout.
 */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const toRef = process.argv[2] ?? 'HEAD';
const outFile = process.argv[3];

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** The most recent tag strictly before `toRef`, or null for the first release. */
function previousTag() {
  const r = spawnSync('git', ['describe', '--tags', '--abbrev=0', `${toRef}^`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const SECTIONS = [
  { key: 'feat', title: 'Features' },
  { key: 'perf', title: 'Performance' },
  { key: 'fix', title: 'Bug Fixes' },
  { key: 'security', title: 'Security' },
  { key: 'refactor', title: 'Refactoring' },
  { key: 'docs', title: 'Documentation' },
  { key: 'build', title: 'Build & CI' },
  { key: 'ci', title: 'Build & CI' },
  { key: 'deps', title: 'Dependencies' },
  { key: 'chore', title: 'Maintenance' },
];

const TITLE_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title]));
const ORDER = ['Features', 'Performance', 'Bug Fixes', 'Security', 'Refactoring', 'Documentation', 'Build & CI', 'Dependencies', 'Maintenance', 'Other'];

function parse(subject) {
  // type(scope)!: description   — Conventional Commits, scope/`!` optional.
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  if (!m) return { section: 'Other', breaking: false, text: subject };
  const [, type, , bang, desc] = m;
  const section = TITLE_BY_KEY[type.toLowerCase()] ?? 'Other';
  return { section, breaking: !!bang, text: desc };
}

function main() {
  const prev = previousTag();
  const range = prev ? `${prev}..${toRef}` : toRef;
  const sep = '';
  // subject<US>author-name per commit (exclude merge commits for cleaner notes)
  const raw = git(['log', range, '--no-merges', `--pretty=format:%s${sep}%an`]);

  const buckets = new Map();
  const breaking = [];
  const contributors = new Set();
  let commitCount = 0;

  for (const line of raw.split('\n').filter(Boolean)) {
    const [subject, author] = line.split(sep);
    commitCount++;
    if (author) contributors.add(author);
    const { section, breaking: isBreaking, text } = parse(subject);
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section).push(text);
    if (isBreaking) breaking.push(text);
    if (/BREAKING[ -]CHANGE/i.test(subject)) breaking.push(text);
  }

  const version = toRef.replace(/^v/, '');
  const date = new Date().toISOString().slice(0, 10);
  const out = [`## Limboo ${version} (${date})`, ''];

  if (prev) out.push(`Changes since **${prev}**.`, '');
  else out.push('Initial release.', '');

  if (breaking.length) {
    out.push('### ⚠ Breaking Changes', '');
    for (const b of [...new Set(breaking)]) out.push(`- ${b}`);
    out.push('');
  }

  for (const section of ORDER) {
    const items = buckets.get(section);
    if (!items?.length) continue;
    out.push(`### ${section}`, '');
    for (const item of items) out.push(`- ${item}`);
    out.push('');
  }

  if (contributors.size) {
    out.push('### Contributors', '');
    out.push([...contributors].sort().map((c) => `@${c}`).join(', '), '');
  }

  out.push('### Verifying this release', '');
  out.push(
    'Each artifact is listed in `SHA256SUMS`. Verify with `sha256sum -c SHA256SUMS`,',
    'and verify build provenance with `gh attestation verify <file> --repo BotCoder254/limboo`.',
    '',
    `_${commitCount} commit(s) in this release._`,
  );

  const text = out.join('\n') + '\n';
  if (outFile) {
    return writeFile(outFile, text, 'utf8').then(() => console.error(`Wrote release notes to ${outFile}`));
  }
  process.stdout.write(text);
}

try {
  await main();
} catch (err) {
  console.error('generate-release-notes failed:', err.message);
  process.exit(1);
}
