/**
 * Per-run local IPC bridge for Cursor runs — the single channel the bundled
 * hook runner ({@link file://./hookRunner.cjs}) and stdio MCP bridge
 * ({@link file://./mcpBridge.cjs}) use to reach the main process. One server
 * per run, torn down in the run's `finally`.
 *
 * Security (CLAUDE.md §6):
 *  - The endpoint is a named pipe (win32) / a 0700-dir unix socket (posix) —
 *    never a TCP port.
 *  - Every connection must present a per-run random token as its FIRST line
 *    (timing-safe compare); anything else destroys the socket.
 *  - The pipe path + token ride only the child ENVIRONMENT
 *    (`LIMBOO_BRIDGE_PIPE` / `LIMBOO_BRIDGE_TOKEN`), never argv.
 *  - Bounded: max line length, max concurrent connections, per-request
 *    timeout. Handler errors answer the request; they never crash the server.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CURSOR_LIMITS } from '@shared/constants';

/** Decision shape written back to the hook runner (Cursor hook contract). */
export interface HookDecision {
  permission: 'allow' | 'deny';
  agentMessage?: string;
  userMessage?: string;
}

export interface BridgeHandlers {
  /** A hook fired inside the run (preToolUse / beforeShellExecution / …). */
  onHook(event: string, payload: Record<string, unknown>): Promise<HookDecision>;
  /**
   * An MCP request from the stdio bridge. `server` is `memory` | `search`;
   * `method` is `tools/list` | `tools/call`. Returns the MCP-shaped result.
   */
  onMcp(server: string, method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface RunBridgeServer {
  /** Env overlay for the run child (and the configs it spawns children from). */
  env: Record<string, string>;
  /** Capability probe: did any hook process ever connect during the run? */
  readonly hookConnected: boolean;
  /** Did the MCP bridge connect (i.e. cursor-agent actually started it)? */
  readonly mcpConnected: boolean;
  close(): Promise<void>;
}

interface WireRequest {
  id?: number;
  kind?: string;
  event?: string;
  payload?: Record<string, unknown>;
  server?: string;
  method?: string;
  params?: Record<string, unknown>;
}

/** Start the per-run bridge server. Always resolves or throws before spawn. */
export async function startBridgeServer(handlers: BridgeHandlers): Promise<RunBridgeServer> {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(token);
  const pipePath = makePipePath();

  let hookConnected = false;
  let mcpConnected = false;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    if (sockets.size >= CURSOR_LIMITS.bridgeMaxConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    let authed = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > CURSOR_LIMITS.bridgeLineMax) {
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        if (!authed) {
          // First line MUST be {token, role}. Anything else: drop the socket.
          const hello = parseLine(line);
          const presented = typeof hello?.token === 'string' ? hello.token : '';
          const presentedBuf = Buffer.from(presented);
          const ok =
            presentedBuf.length === tokenBuf.length &&
            crypto.timingSafeEqual(presentedBuf, tokenBuf);
          if (!ok) {
            socket.destroy();
            return;
          }
          authed = true;
          if (hello?.role === 'hook') hookConnected = true;
          if (hello?.role === 'mcp') mcpConnected = true;
          continue;
        }

        void serve(parseLine(line) as WireRequest | null, socket, handlers);
      }
    });
  });

  server.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    env: { LIMBOO_BRIDGE_PIPE: pipePath, LIMBOO_BRIDGE_TOKEN: token },
    get hookConnected() {
      return hookConnected;
    },
    get mcpConnected() {
      return mcpConnected;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of [...sockets]) s.destroy();
        sockets.clear();
        server.close(() => {
          cleanupSocketFile(pipePath);
          resolve();
        });
      }),
  };
}

/** Answer one authed request line; handler failures become error replies. */
async function serve(
  req: WireRequest | null,
  socket: net.Socket,
  handlers: BridgeHandlers,
): Promise<void> {
  if (!req || typeof req.id !== 'number') return;
  const reply = (body: Record<string, unknown>): void => {
    if (socket.destroyed) return;
    try {
      socket.write(`${JSON.stringify({ id: req.id, ...body })}\n`);
    } catch {
      socket.destroy();
    }
  };

  const timeout = new Promise<never>((_, rejectT) => {
    const t = setTimeout(
      () => rejectT(new Error('bridge request timed out')),
      CURSOR_LIMITS.bridgeRequestTimeoutMs,
    );
    t.unref?.();
  });

  try {
    if (req.kind === 'hook') {
      const event = typeof req.event === 'string' ? req.event.slice(0, 80) : '';
      const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
      const decision = await Promise.race([handlers.onHook(event, payload), timeout]);
      reply({ ok: true, result: decision });
      return;
    }
    if (req.kind === 'mcp') {
      const server = typeof req.server === 'string' ? req.server.slice(0, 40) : '';
      const method = typeof req.method === 'string' ? req.method.slice(0, 80) : '';
      const params = req.params && typeof req.params === 'object' ? req.params : {};
      const result = await Promise.race([handlers.onMcp(server, method, params), timeout]);
      reply({ ok: true, result });
      return;
    }
    reply({ ok: false, error: 'unknown request kind' });
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message.slice(0, 500) : 'bridge error' });
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** win32: named pipe; posix: socket file inside a fresh 0700 directory. */
function makePipePath(): string {
  const rand = crypto.randomBytes(9).toString('hex');
  if (process.platform === 'win32') return `\\\\.\\pipe\\limboo-bridge-${rand}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limboo-bridge-'));
  fs.chmodSync(dir, 0o700);
  return path.join(dir, `${rand}.sock`);
}

/** posix only: remove the socket file + its private temp dir. */
function cleanupSocketFile(pipePath: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.rmSync(path.dirname(pipePath), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
