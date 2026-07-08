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

/**
 * Cheap trigger pre-check before running the redaction regexes: only lines
 * containing one of these substrings are scanned at all (logging is hot).
 */
const REDACT_TRIGGERS = ['sk-', 'bearer', 'token', 'secret', 'password', 'apikey', 'api_key', 'gh', '://', 'crsr'];

/**
 * Central secret redaction (CLAUDE.md §6: secrets/tokens are redacted before
 * they reach the logger). Call-site redaction still exists where structure is
 * known; this is the defense-in-depth choke point covering console + file.
 * Bounded quantifiers only — no catastrophic backtracking.
 */
const REDACT_PATTERNS: RegExp[] = [
  // Anthropic API keys.
  /\bsk-ant-[A-Za-z0-9_-]{8,200}\b/g,
  // Generic sk- / GitHub / GitLab / Slack style tokens.
  /\b(?:sk|gh[pousr]|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{8,200}\b/g,
  // Bearer / token authorization headers.
  /\b(bearer|authorization)\s*[:=]?\s+[A-Za-z0-9._~+/-]{8,400}=*/gi,
  // key=value style secrets (token=, api_key:, password= …). CURSOR_API_KEY
  // needs its own alternate — the `_` in `cursor_api_key` defeats \bapi_key\b.
  /\b(token|secret|password|passwd|apikey|api_key|cursor_api_key|access_key|private_key)\b(\s*[:=]\s*)(["']?)[^\s"'&]{4,400}\3/gi,
  // URL userinfo credentials (https://user:pass@host).
  /(\w+:\/\/)([^\s/:@]{1,128}):([^\s/@]{1,256})@/g,
  // Cursor API keys (crsr_… — lenient shape; the prefix is not contractual).
  /\bcrsr_[A-Za-z0-9_-]{8,200}\b/g,
];

function redactSecrets(line: string): string {
  const lower = line.toLowerCase();
  if (!REDACT_TRIGGERS.some((t) => lower.includes(t))) return line;
  let out = line;
  out = out.replace(REDACT_PATTERNS[0], '[redacted]');
  out = out.replace(REDACT_PATTERNS[1], '[redacted]');
  out = out.replace(REDACT_PATTERNS[2], '$1 [redacted]');
  out = out.replace(REDACT_PATTERNS[3], '$1$2[redacted]');
  out = out.replace(REDACT_PATTERNS[4], '$1$2:[redacted]@');
  out = out.replace(REDACT_PATTERNS[5], '[redacted]');
  return out;
}

function write(level: Level, args: unknown[]): void {
  const line = redactSecrets(
    `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : stringify(a)))
      .join(' ')}`,
  );

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
