#!/usr/bin/env node
/**
 * make-checksums.mjs — produce a SHA256SUMS manifest for release artifacts.
 *
 * Provider-neutral (Node builtins only) so GitLab CI and GitHub Actions all
 * generate byte-identical checksum files. Walks a directory, hashes every
 * regular file (excluding any pre-existing SHA256SUMS), and writes a manifest in
 * the standard `<hex>␠␠<relative-path>` format consumable by `sha256sum -c`.
 *
 * Usage:
 *   node ci/scripts/make-checksums.mjs [artifactDir=out/make] [outFile=<dir>/SHA256SUMS]
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const artifactDir = process.argv[2] ?? 'out/make';
const outFile = process.argv[3] ?? join(artifactDir, 'SHA256SUMS');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  try {
    await stat(artifactDir);
  } catch {
    console.error(`make-checksums: artifact dir not found: ${artifactDir}`);
    process.exit(1);
  }

  const lines = [];
  for await (const file of walk(artifactDir)) {
    if (file.endsWith('SHA256SUMS')) continue;
    const rel = relative(artifactDir, file).split(sep).join('/');
    const digest = await sha256(file);
    lines.push(`${digest}  ${rel}`);
    console.log(`${digest}  ${rel}`);
  }

  if (lines.length === 0) {
    console.error(`make-checksums: no artifacts found under ${artifactDir}`);
    process.exit(1);
  }

  lines.sort();
  await writeFile(outFile, lines.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${lines.length} checksum(s) to ${outFile}`);
}

main().catch((err) => {
  console.error('make-checksums failed:', err);
  process.exit(1);
});
