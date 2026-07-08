#!/usr/bin/env node
/**
 * Limboo hook runner — the tiny process Cursor spawns for every registered
 * hook (preToolUse / beforeShellExecution / beforeReadFile / afterFileEdit).
 * It reads the hook payload from stdin, forwards it over Limboo's per-run
 * bridge pipe, and writes the decision JSON to stdout.
 *
 * MUST stay self-contained (node:net / node:process only — no imports from
 * the app bundle): it is emitted as a standalone asset beside main.js and
 * executed via `ELECTRON_RUN_AS_NODE=1 <electron> hookRunner.cjs`, including
 * from inside a packaged app where the main bundle lives in an asar.
 *
 * FAIL CLOSED: any failure — missing env, pipe unreachable, bad token,
 * timeout, malformed reply — prints {"permission":"deny"} and exits 2 (Cursor
 * treats exit 2 as a hard block; hooks.json additionally sets failClosed).
 */
'use strict';

const net = require('node:net');

const PIPE = process.env.LIMBOO_BRIDGE_PIPE || '';
const TOKEN = process.env.LIMBOO_BRIDGE_TOKEN || '';
const TIMEOUT_MS = 10 * 60 * 1000; // interactive approval can take a while
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_REPLY = 1 * 1024 * 1024;

function denyAndExit(message) {
  try {
    process.stdout.write(
      JSON.stringify({ permission: 'deny', agentMessage: message || 'Limboo bridge unavailable.' }),
    );
  } catch {
    // nothing else to do
  }
  process.exit(2);
}

if (!PIPE || !TOKEN) denyAndExit('Limboo bridge environment missing.');

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
  if (stdin.length > MAX_INPUT) denyAndExit('Hook payload too large.');
});
process.stdin.on('error', () => denyAndExit('Failed to read the hook payload.'));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    denyAndExit('Malformed hook payload.');
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    denyAndExit('Malformed hook payload.');
    return;
  }

  const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';
  const socket = net.connect(PIPE);
  const timer = setTimeout(() => {
    socket.destroy();
    denyAndExit('Limboo did not answer in time.');
  }, TIMEOUT_MS);

  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => {
    clearTimeout(timer);
    denyAndExit('Limboo bridge unreachable.');
  });
  socket.on('connect', () => {
    socket.write(JSON.stringify({ token: TOKEN, role: 'hook' }) + '\n');
    socket.write(JSON.stringify({ id: 1, kind: 'hook', event, payload }) + '\n');
  });
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_REPLY) {
      clearTimeout(timer);
      socket.destroy();
      denyAndExit('Bridge reply too large.');
      return;
    }
    const nl = buffer.indexOf('\n');
    if (nl < 0) return;
    clearTimeout(timer);
    socket.end();

    let reply;
    try {
      reply = JSON.parse(buffer.slice(0, nl));
    } catch {
      denyAndExit('Malformed bridge reply.');
      return;
    }
    if (!reply || reply.ok !== true || !reply.result || typeof reply.result !== 'object') {
      denyAndExit(reply && typeof reply.error === 'string' ? reply.error : 'Bridge refused.');
      return;
    }
    const decision = reply.result;
    const permission = decision.permission === 'allow' ? 'allow' : 'deny';
    const out = { permission };
    if (typeof decision.agentMessage === 'string' && decision.agentMessage) {
      out.agentMessage = decision.agentMessage;
    }
    if (typeof decision.userMessage === 'string' && decision.userMessage) {
      out.userMessage = decision.userMessage;
    }
    process.stdout.write(JSON.stringify(out));
    process.exit(permission === 'allow' ? 0 : 2);
  });
  socket.on('close', () => {
    // Reply already handled above; a close without one is a failure.
    if (buffer.indexOf('\n') < 0) {
      clearTimeout(timer);
      denyAndExit('Bridge closed early.');
    }
  });
});
