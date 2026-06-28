/**
 * Minimal main-process logger. Writes timestamped lines to both the console and
 * a rolling log file under the app's userData directory so native errors, IPC
 * failures, and unexpected exceptions are observable after the fact.
 *
 * Kept dependency-free on purpose (Phase 1). It can later be swapped for a
 * structured logger without touching call sites.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

type Level = 'info' | 'warn' | 'error';

let logFile: string | null = null;

function resolveLogFile(): string | null {
  if (logFile) return logFile;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'limboo-main.log');
    return logFile;
  } catch {
    return null;
  }
}

function write(level: Level, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : stringify(a)))
    .join(' ')}`;

  // Always echo to the console for `npm start` visibility.
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);

  const file = resolveLogFile();
  if (file) {
    try {
      fs.appendFileSync(file, line + '\n');
    } catch {
      /* logging must never throw */
    }
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};

/**
 * Install last-resort handlers so a thrown error in the main process is logged
 * rather than silently crashing the app.
 */
export function installGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
  });
}
