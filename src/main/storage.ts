/**
 * Tiny atomic JSON persistence helper for the main process. Files live under
 * Electron's `userData` directory so they are per-user and survive upgrades.
 * Writes go to a temp file then rename, avoiding partially-written files if the
 * process dies mid-write.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger';

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Failed to read ${name}, using fallback`, err);
    }
    return fallback;
  }
}

export function writeJson(name: string, data: unknown): void {
  const target = filePath(name);
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    logger.error(`Failed to write ${name}`, err);
  }
}
