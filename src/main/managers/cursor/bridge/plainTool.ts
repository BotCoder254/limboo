/**
 * Transport-neutral tool shape shared by the SDK-shaped in-process MCP servers
 * (Claude runs) and the stdio bridge dispatcher (Cursor runs) — one handler
 * implementation, two transports. All plain tools are read-only by contract.
 */
export interface PlainTool {
  name: string;
  description: string;
  /** Hand-written JSON Schema for MCP `tools/list` (mirrors the zod shape). */
  inputSchema: Record<string, unknown>;
  /** Validates its own args defensively; returns display text. */
  run(args: Record<string, unknown>): string;
}

/** Coerce an arg to a non-empty bounded string, or null. */
export function strArg(value: unknown, max = 1_000): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.slice(0, max) : null;
}

/** Coerce an arg to a clamped integer with a default. */
export function intArg(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
