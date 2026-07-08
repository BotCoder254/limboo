#!/usr/bin/env node
/**
 * Limboo stdio MCP bridge — the process `cursor-agent` spawns for the
 * `limboo_memory` / `limboo_search` servers declared in the generated
 * session `.cursor/mcp.json`. It speaks minimal MCP (JSON-RPC 2.0 over
 * newline-delimited stdio: initialize / tools/list / tools/call / ping) and
 * forwards tool traffic over Limboo's per-run bridge pipe, so the actual
 * Memory/Search data access stays in the main process (one better-sqlite3
 * owner, no cross-process WAL contention).
 *
 * MUST stay self-contained (node:net / node:process only — no imports from
 * the app bundle): it is emitted as a standalone asset beside main.js and
 * executed via `ELECTRON_RUN_AS_NODE=1 <electron> mcpBridge.cjs`, including
 * from a packaged app. Which server it fronts rides LIMBOO_BRIDGE_SERVER
 * ('memory' | 'search') — set per entry in the generated mcp.json.
 */
'use strict';

const net = require('node:net');

const PIPE = process.env.LIMBOO_BRIDGE_PIPE || '';
const TOKEN = process.env.LIMBOO_BRIDGE_TOKEN || '';
const SERVER = process.env.LIMBOO_BRIDGE_SERVER === 'memory' ? 'memory' : 'search';
const PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 60 * 1000;
const MAX_LINE = 4 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Pipe client (lazy, single connection, id-correlated)                */
/* ------------------------------------------------------------------ */

let socket = null;
let nextId = 1;
const pending = new Map(); // id -> {resolve, reject, timer}

function failAllPending(message) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}

function ensureSocket() {
  if (socket && !socket.destroyed) return socket;
  socket = net.connect(PIPE);
  socket.setEncoding('utf8');
  let buffer = '';
  // Written BEFORE any request so the queued-write order guarantees the
  // auth hello is the first line the server sees (writes issued pre-connect
  // are flushed in order once the socket opens).
  socket.write(JSON.stringify({ token: TOKEN, role: 'mcp', server: SERVER }) + '\n');
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE) {
      socket.destroy();
      failAllPending('bridge reply too large');
      return;
    }
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      const p = reply && pending.get(reply.id);
      if (!p) continue;
      pending.delete(reply.id);
      clearTimeout(p.timer);
      if (reply.ok === true) p.resolve(reply.result);
      else p.reject(new Error(typeof reply.error === 'string' ? reply.error : 'bridge error'));
    }
  });
  socket.on('error', () => failAllPending('Limboo bridge unreachable'));
  socket.on('close', () => {
    failAllPending('Limboo bridge closed');
    socket = null;
  });
  return socket;
}

function bridgeRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('bridge request timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      ensureSocket().write(
        JSON.stringify({ id, kind: 'mcp', server: SERVER, method, params: params || {} }) + '\n',
      );
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}

/* ------------------------------------------------------------------ */
/* MCP over stdio (JSON-RPC 2.0, newline-delimited)                    */
/* ------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion:
          params && typeof params.protocolVersion === 'string'
            ? params.protocolVersion
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: `limboo_${SERVER}`, version: '1.0.0' },
      });
      return;
    case 'ping':
      sendResult(id, {});
      return;
    case 'tools/list':
      try {
        sendResult(id, await bridgeRequest('tools/list', {}));
      } catch (err) {
        sendError(id, -32603, err && err.message ? err.message : 'bridge failure');
      }
      return;
    case 'tools/call':
      try {
        sendResult(id, await bridgeRequest('tools/call', params || {}));
      } catch (err) {
        // Tool-level failures ride the MCP result contract, not JSON-RPC errors.
        sendResult(id, {
          content: [
            { type: 'text', text: err && err.message ? err.message : 'The Limboo bridge failed.' },
          ],
          isError: true,
        });
      }
      return;
    default:
      // Notifications are ignorable; unknown REQUESTS get a proper error.
      if (isRequest) sendError(id, -32601, `Method not found: ${String(method).slice(0, 80)}`);
  }
}

if (!PIPE || !TOKEN) {
  // Without the bridge env this process is useless — exit before the client
  // wastes its startup budget. cursor-agent reports the server as failed.
  process.exit(1);
}

let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  if (stdinBuffer.length > MAX_LINE) process.exit(1);
  let nl;
  while ((nl = stdinBuffer.indexOf('\n')) >= 0) {
    const line = stdinBuffer.slice(0, nl).trim();
    stdinBuffer = stdinBuffer.slice(nl + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message && typeof message === 'object' && typeof message.method === 'string') {
      void handle(message);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(1));
