/**
 * Bounded NDJSON reader for `cursor-agent --print --output-format stream-json`.
 *
 * A manual buffered line-splitter (not readline) so a pathological line can be
 * dropped without ever being buffered unbounded: once the carry buffer passes
 * `maxLine` with no newline in sight, the whole oversized line is discarded as
 * it streams through. Unparseable lines are skipped — real errors arrive on
 * stderr and via the exit code, per the documented failure contract.
 */
import type { Readable } from 'node:stream';
import type { CursorEvent } from './types';

export interface NdjsonOptions {
  /** Lines longer than this are dropped (never accumulated). */
  maxLine: number;
  /** Called once per dropped/unparseable line (already size-bounded label). */
  onSkip?: (reason: 'oversized' | 'unparseable') => void;
}

/** Yield one parsed JSON object per stdout line; skip anything malformed. */
export async function* readNdjson(
  stdout: Readable,
  opts: NdjsonOptions,
): AsyncGenerator<CursorEvent> {
  let carry = '';
  let discarding = false;

  stdout.setEncoding('utf8');
  for await (const chunk of stdout as AsyncIterable<string>) {
    let data = chunk;
    // Finish discarding an oversized line before resuming normal parsing.
    if (discarding) {
      const nl = data.indexOf('\n');
      if (nl === -1) continue;
      data = data.slice(nl + 1);
      discarding = false;
    }
    carry += data;
    if (carry.length > opts.maxLine && !carry.includes('\n')) {
      carry = '';
      discarding = true;
      opts.onSkip?.('oversized');
      continue;
    }

    let idx = carry.indexOf('\n');
    while (idx !== -1) {
      const line = carry.slice(0, idx).replace(/\r$/, '');
      carry = carry.slice(idx + 1);
      const ev = parseLine(line, opts);
      if (ev) yield ev;
      idx = carry.indexOf('\n');
    }
  }

  // Flush a final unterminated line (the terminal result may omit the newline).
  const tail = carry.trim();
  if (tail && !discarding) {
    const ev = parseLine(tail, opts);
    if (ev) yield ev;
  }
}

function parseLine(line: string, opts: NdjsonOptions): CursorEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.length > opts.maxLine) {
    opts.onSkip?.('oversized');
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CursorEvent;
    }
  } catch {
    // fall through — non-JSON noise on stdout is ignored by contract
  }
  opts.onSkip?.('unparseable');
  return null;
}
