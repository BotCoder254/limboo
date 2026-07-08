/**
 * Session-scoped generated-file lifecycle for Cursor runs.
 *
 * Every file Limboo materializes inside a session worktree for the duration of
 * a run (`.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/mcp.json`,
 * `.cursor/rules/limboo-context.mdc`) goes through {@link withSessionFile}:
 * containment-checked against the session root, written atomically
 * (tmp + rename), and restored to the exact pre-run bytes — or removed, along
 * with any directories we created — in `finally`, so the working tree ends the
 * run exactly as it started and `git status` stays clean.
 */
import fs from 'node:fs';
import path from 'node:path';

/** JSON keys that must never be copied out of a repo-authored config. */
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Parse repo-authored JSON defensively: object or `{}` — never throws. */
export function safeParseObject(bytes: Buffer | null): Record<string, unknown> {
  if (!bytes) return {};
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

/** Copy an object's own keys, skipping prototype-pollution vectors. */
export function copySafeKeys(
  source: Record<string, unknown>,
  skip: ReadonlySet<string> = UNSAFE_KEYS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key) || skip.has(key)) continue;
    out[key] = source[key];
  }
  return out;
}

/**
 * Materialize `content(original)` at `<root>/<relPath>` for the duration of
 * `fn`, then restore the pre-run bytes (or remove the file plus any
 * directories this call created). `content` receives the original bytes so
 * callers can merge defensively over a repo-authored file; returning `null`
 * skips the write entirely (fn still runs).
 */
export async function withSessionFile<T>(
  root: string,
  relPath: string,
  content: (originalBytes: Buffer | null) => string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const file = path.join(root, relPath);
  // The target is constructed from root — belt-and-braces containment check.
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`session file target escaped the session root: ${relPath}`);
  }

  let originalBytes: Buffer | null = null;
  try {
    originalBytes = await fs.promises.readFile(file);
  } catch {
    originalBytes = null;
  }

  const body = content(originalBytes);
  if (body === null) return fn();

  // Create missing parent directories, remembering which ones WE created so
  // cleanup removes only those (deepest-first), never a repo-authored dir.
  const createdDirs: string[] = [];
  {
    const rootResolved = path.resolve(root);
    let dir = path.dirname(file);
    const missing: string[] = [];
    while (!fs.existsSync(dir)) {
      missing.unshift(dir);
      const parent = path.dirname(dir);
      if (parent === dir || path.resolve(dir) === rootResolved) break;
      dir = parent;
    }
    for (const d of missing) {
      await fs.promises.mkdir(d);
      createdDirs.unshift(d); // deepest last-created ends up first
    }
  }

  const tmp = `${file}.limboo-tmp`;
  await fs.promises.writeFile(tmp, body, 'utf8');
  await fs.promises.rename(tmp, file);

  try {
    return await fn();
  } finally {
    try {
      if (originalBytes) {
        await fs.promises.writeFile(file, originalBytes);
      } else {
        await fs.promises.rm(file, { force: true });
        for (const d of createdDirs) {
          // Fails (and stops) if anything else landed in the dir meanwhile.
          await fs.promises.rmdir(d).catch(() => undefined);
        }
      }
    } catch {
      // Restore is best-effort; leftover content is deny-only / context-only
      // (fail-safe) and the next run rewrites it.
    }
  }
}
