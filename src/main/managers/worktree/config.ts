/**
 * `limboo.json` — the repo-authored worktree/session runtime config: setup and
 * teardown hooks, named scripts, and supervised services.
 *
 * Security (CLAUDE.md §6): this file is REPO-AUTHORED and therefore untrusted
 * until the user acknowledges it. Parsing is size-capped, every field is
 * validated by shape (names whitelisted `[a-z0-9-]`, commands length-capped,
 * counts bounded, prototype-pollution keys rejected), and nothing here is ever
 * executed directly — execution goes through the confirm/acknowledgment gate in
 * the WorktreeManager and runs argv-only through the TerminalManager.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WORKTREE_LIMITS } from '@shared/constants';
import type { RepoConfig, RepoServiceConfig } from '@shared/types';
import { logger } from '../../logger';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Read + strictly validate `<root>/limboo.json`. Null when absent/invalid. */
export function readRepoConfig(root: string): RepoConfig | null {
  const file = path.join(root, 'limboo.json');
  let raw: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > WORKTREE_LIMITS.configBytesMax) return null;
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(`limboo.json parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const config: RepoConfig = { setup: [], teardown: [], scripts: {}, services: {} };

  config.setup = readCommandList(parsed.setup);
  config.teardown = readCommandList(parsed.teardown);

  if (isPlainObject(parsed.scripts)) {
    for (const [name, cmd] of safeEntries(parsed.scripts)) {
      if (!NAME_RE.test(name) || typeof cmd !== 'string') continue;
      const command = cmd.trim();
      if (!command || command.length > WORKTREE_LIMITS.commandMax) continue;
      config.scripts[name] = command;
      if (Object.keys(config.scripts).length >= WORKTREE_LIMITS.maxCommands) break;
    }
  }

  if (isPlainObject(parsed.services)) {
    for (const [name, svc] of safeEntries(parsed.services)) {
      const service = readService(svc);
      if (!NAME_RE.test(name) || !service) continue;
      config.services[name] = service;
      if (Object.keys(config.services).length >= WORKTREE_LIMITS.maxServices) break;
    }
  }

  return config;
}

/**
 * Stable hash over the EXECUTABLE portions of the config (hooks + scripts +
 * services). The renderer displays the commands, the user acknowledges, and
 * this hash is what gets stored/compared — so an edited limboo.json always
 * re-confirms (TOCTOU guard between display and run).
 */
export function hashRepoConfig(config: RepoConfig | null): string {
  if (!config) return '';
  const canonical = JSON.stringify({
    setup: config.setup,
    teardown: config.teardown,
    scripts: sortedEntries(config.scripts),
    services: sortedEntries(config.services),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/* -------------------------------------------------------------- helpers */

function readCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cmd = item.trim();
    if (!cmd || cmd.length > WORKTREE_LIMITS.commandMax || cmd.includes('\0')) continue;
    out.push(cmd);
    if (out.length >= WORKTREE_LIMITS.maxCommands) break;
  }
  return out;
}

function readService(value: unknown): RepoServiceConfig | null {
  if (typeof value === 'string') {
    const command = value.trim();
    if (!command || command.length > WORKTREE_LIMITS.commandMax) return null;
    return { command, autoStart: false, restart: 'no' };
  }
  if (!isPlainObject(value) || typeof value.command !== 'string') return null;
  const command = value.command.trim();
  if (!command || command.length > WORKTREE_LIMITS.commandMax || command.includes('\0')) {
    return null;
  }
  return {
    command,
    autoStart: value.autoStart === true,
    restart: value.restart === 'on-failure' ? 'on-failure' : 'no',
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-keys iteration with prototype-pollution keys dropped. */
function safeEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
  return Object.keys(obj)
    .filter((k) => !FORBIDDEN_KEYS.has(k))
    .map((k) => [k, obj[k]]);
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.keys(record)
    .sort()
    .map((k) => [k, record[k]]);
}
