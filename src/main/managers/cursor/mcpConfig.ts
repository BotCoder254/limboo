/**
 * Session-scoped Cursor MCP config (`<root>/.cursor/mcp.json`).
 *
 * Registers the `limboo_memory` / `limboo_search` stdio bridge servers for
 * the run so Cursor queries the SAME platform services Claude does (memory
 * captured while one agent works is retrievable by the other). Servers run
 * the bundled mcpBridge.cjs via Electron-as-node; the per-run pipe/token ride
 * each server's env (explicit — never argv).
 *
 * Merge semantics: a repo-authored mcp.json keeps its own servers (they are
 * declarative endpoints, gated at call time by Cursor's Mcp() permission
 * rules — unlike hooks they don't execute on registration alone); ours are
 * added, never overwriting a same-named repo key. Restored byte-for-byte
 * after the run.
 */
import { copySafeKeys, safeParseObject, UNSAFE_KEYS, withSessionFile } from './sessionFile';

export interface McpBridgeSpec {
  nodeCommand: string;
  bridgePath: string;
  /** LIMBOO_BRIDGE_PIPE / LIMBOO_BRIDGE_TOKEN from the run's pipe server. */
  bridgeEnv: Record<string, string>;
  memory: boolean;
  search: boolean;
}

/** Build the merged mcp.json body (null = nothing to register). */
export function buildMcpConfig(originalBytes: Buffer | null, spec: McpBridgeSpec): string | null {
  const servers: Record<string, unknown> = {};
  const serverEntry = (kind: 'memory' | 'search'): Record<string, unknown> => ({
    command: spec.nodeCommand,
    args: [spec.bridgePath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      ...spec.bridgeEnv,
      LIMBOO_BRIDGE_SERVER: kind,
    },
  });
  if (spec.memory) servers.limboo_memory = serverEntry('memory');
  if (spec.search) servers.limboo_search = serverEntry('search');
  if (Object.keys(servers).length === 0) return null;

  const original = safeParseObject(originalBytes);
  const out = copySafeKeys(original, new Set(['mcpServers']));
  const originalServers =
    original.mcpServers && typeof original.mcpServers === 'object' && !Array.isArray(original.mcpServers)
      ? (original.mcpServers as Record<string, unknown>)
      : {};
  const mergedServers: Record<string, unknown> = {};
  for (const key of Object.keys(originalServers)) {
    if (UNSAFE_KEYS.has(key)) continue;
    mergedServers[key] = originalServers[key];
  }
  for (const [key, value] of Object.entries(servers)) {
    // Never clobber a repo-authored server of the same name.
    if (!(key in mergedServers)) mergedServers[key] = value;
  }
  out.mcpServers = mergedServers;
  return JSON.stringify(out, null, 2);
}

/**
 * Materialize the session mcp.json for the duration of `fn`, then restore the
 * pre-run bytes. Passing `spec: null` skips the write entirely.
 */
export async function withSessionMcpJson<T>(
  root: string,
  spec: McpBridgeSpec | null,
  fn: () => Promise<T>,
): Promise<T> {
  return withSessionFile(
    root,
    '.cursor/mcp.json',
    (originalBytes) => (spec ? buildMcpConfig(originalBytes, spec) : null),
    fn,
  );
}
