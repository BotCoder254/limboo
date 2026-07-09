/**
 * Cursor print-mode runtime — spawns `cursor-agent --print --output-format
 * stream-json --stream-partial-output` and translates its NDJSON stream into
 * the run-scoped bridge AgentManager hands it. Process management only:
 * lifecycle, persistence, plan artifacts, and event emission stay owned by
 * AgentManager.
 *
 * Security (CLAUDE.md §6): argv-only spawn (never shell), the prompt rides
 * stdin (never argv), secrets ride the environment composed at spawn time via
 * CursorAuthManager.getSpawnEnv() (the only sanctioned decrypt site), cwd and
 * --workspace are the same WorktreeManager-resolved session root, and every
 * captured byte passes redactCursor before a log/diagnostic line.
 */
import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { CURSOR_LIMITS, CURSOR_MODEL_ID_RE, CURSOR_RESUME_ID_RE } from '@shared/constants';
import type { CursorAuthManager } from './CursorAuthManager';
import { redactCursor, runCursorAgent, spawnCursorRun } from './exec';
import { NO_RESULT_MARKER } from './errors';
import { readNdjson } from './stream';
import {
  assistantText,
  classifyAssistantChunk,
  isAssistantEvent,
  isProposedMutation,
  isToolCallEvent,
  mapToolCall,
  toolResultOf,
} from './translate';
import type { CursorRunOutcome, CursorRunSpec, ProviderRunBridge } from './types';

export interface CursorRunHandle {
  /** Satisfies the ActiveRun.query contract — stop() calls close(). */
  close: () => void;
  /** Resolves when the child has exited and the stream is drained. */
  done: Promise<CursorRunOutcome>;
}

export class CursorRuntime {
  private readonly children = new Set<ChildProcess>();

  constructor(private readonly auth: CursorAuthManager) {}

  /** Spawn one print-mode run. Throws early (unresolved CLI / .cmd shim). */
  async start(spec: CursorRunSpec, bridge: ProviderRunBridge): Promise<CursorRunHandle> {
    const argv = buildArgv(spec);
    const child = await spawnCursorRun(argv, {
      cwd: spec.cwd,
      // Composed at spawn time; {} under cli-login (the CLI uses its own store).
      // The bridge overlay (pipe/token) rides here too — env only, never argv.
      env: { ...this.auth.getSpawnEnv(), ...(spec.extraEnv ?? {}) },
    });
    this.children.add(child);

    const close = (): void => killTree(child);
    const onAbort = (): void => close();
    spec.abort.signal.addEventListener('abort', onAbort, { once: true });

    const done = this.consume(spec, bridge, child).finally(() => {
      this.children.delete(child);
      spec.abort.signal.removeEventListener('abort', onAbort);
    });
    return { close, done };
  }

  /**
   * Pre-create an empty Cursor chat and return its id (`create-chat` — the
   * design doc's "mint the chat id before any prompt is sent"). Best-effort:
   * any failure (older CLI without the subcommand, timeout, unparseable
   * output) returns null and the caller falls back to harvesting the id from
   * the first run's system/init event. The returned id must pass the same
   * strict gate as a stored resume token before it can ever reach argv.
   */
  async createChat(): Promise<string | null> {
    const r = await runCursorAgent(['create-chat'], {
      timeout: CURSOR_LIMITS.statusTimeoutMs,
      env: this.auth.getSpawnEnv(),
    });
    if (!r.ok) return null;
    const id = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim() ?? '';
    return CURSOR_RESUME_ID_RE.test(id) ? id : null;
  }

  /** Kill every live run child. Called on app quit. */
  dispose(): void {
    for (const child of [...this.children]) killTree(child);
    this.children.clear();
  }

  private async consume(
    spec: CursorRunSpec,
    bridge: ProviderRunBridge,
    child: ChildProcess,
  ): Promise<CursorRunOutcome> {
    const outcome: CursorRunOutcome = { proposedMutations: 0 };
    let stderrTail = '';
    let sawResult = false;

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-CURSOR_LIMITS.stderrTailMax);
    });

    const exited = new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code));
      child.once('error', () => resolve(null));
    });

    // The prompt rides stdin (never argv). EPIPE just means the child died
    // early — the exit path below reports the real failure.
    child.stdin?.on('error', () => undefined);
    child.stdin?.write(spec.prompt);
    child.stdin?.end();

    bridge.diag('lifecycle', 'debug', 'cursor-agent run started', argvLabel(spec));

    if (child.stdout) {
      for await (const ev of readNdjson(child.stdout, {
        maxLine: CURSOR_LIMITS.ndjsonLineMax,
        onSkip: (reason) =>
          bridge.diag('stream', 'warning', `Skipped a stream-json line (${reason})`),
      })) {
        if (spec.abort.signal.aborted) break;

        if (ev.type === 'system' && ev.subtype === 'init') {
          const chatId = typeof ev.session_id === 'string' ? ev.session_id : '';
          if (chatId && !outcome.chatId) {
            outcome.chatId = chatId;
            bridge.onInit(chatId);
          }
          continue;
        }

        if (isAssistantEvent(ev)) {
          const kind = classifyAssistantChunk(ev);
          if (kind === 'delta') {
            const text = assistantText(ev);
            if (text) bridge.queueDelta(text);
          } else if (kind === 'final-flush') {
            const text = assistantText(ev);
            if (text) {
              bridge.ensureStreaming();
              bridge.finishStreaming(text);
            }
          }
          // buffered-flush: skip — the deltas already carried this text.
          continue;
        }

        if (isToolCallEvent(ev)) {
          const mapped = mapToolCall(ev);
          if (!mapped) continue;
          if (ev.subtype === 'started') {
            // Close the current text segment so the chip lands between bubbles.
            bridge.finishStreaming();
            bridge.onToolUse(mapped.callId, mapped.name, mapped.input);
          } else if (ev.subtype === 'completed') {
            const result = toolResultOf(ev, CURSOR_LIMITS.outputMax);
            bridge.onToolResult(mapped.callId, result.status, result.output);
            if (
              !spec.force &&
              result.status === 'done' &&
              isProposedMutation(mapped.name, mapped.input)
            ) {
              outcome.proposedMutations += 1;
            }
          }
          continue;
        }

        if (ev.type === 'result') {
          sawResult = true;
          const r = ev as { is_error?: boolean; subtype?: string; result?: string };
          const ok = r.is_error !== true && (r.subtype === undefined || r.subtype === 'success');
          const text =
            typeof r.result === 'string' ? r.result.slice(0, CURSOR_LIMITS.runResultTextMax) : '';
          outcome.result = { ok, text };
          bridge.finishStreaming();
          bridge.onResult(ok, text);
          continue;
        }
        // Unknown event types are ignored by contract (forward-compat).
      }
    }

    const code = await exited;
    if (spec.abort.signal.aborted) return outcome;

    // Documented failure shape: non-zero exit, errors on stderr, and the
    // stream may end without a terminal result. Surface it as a throw so the
    // recovery loop classifies it (the marker flags it retry-worthy).
    if (!sawResult && code !== 0) {
      const detail = redactCursor(stderrTail.trim()) || 'cursor-agent exited without a result';
      throw new Error(`${detail} (exit code ${code ?? 'unknown'}) ${NO_RESULT_MARKER}`);
    }
    if (stderrTail.trim()) {
      bridge.diag('stream', 'debug', 'cursor-agent stderr tail', redactCursor(stderrTail.trim()).slice(0, 500));
    }
    return outcome;
  }
}

/**
 * Assemble print-mode argv from a run spec (no prompt — it rides stdin).
 * Backstop guards: AgentManager validates the model/resume id upstream, but
 * nothing that fails the strict charsets may reach argv from here either
 * (defense in depth — a corrupted DB row or settings value stops at this
 * line, not inside the CLI).
 */
function buildArgv(spec: CursorRunSpec): string[] {
  if (!CURSOR_MODEL_ID_RE.test(spec.model)) {
    throw new Error(`Refusing to run: invalid Cursor model id "${spec.model.slice(0, 80)}".`);
  }
  if (spec.resumeChatId && !CURSOR_RESUME_ID_RE.test(spec.resumeChatId)) {
    throw new Error('Refusing to run: stored Cursor chat id is malformed.');
  }
  const argv = [
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--workspace',
    spec.cwd,
    '--model',
    spec.model,
  ];
  // Literal mode whitelist (documented values: plan | ask; agent = default).
  if (spec.mode === 'plan') argv.push('--mode', 'plan');
  else if (spec.mode === 'ask') argv.push('--mode', 'ask');
  if (spec.resumeChatId) argv.push('--resume', spec.resumeChatId);
  // Read-only modes never force, whatever the caller computed.
  if (spec.force && spec.mode !== 'plan' && spec.mode !== 'ask') argv.push('--force');
  if (spec.trusted) argv.push('--trust');
  // Only ever set after supportsApproveMcps() probed the flag on this CLI.
  if (spec.approveMcps) argv.push('--approve-mcps');
  // Literal whitelist only — never interpolate the settings string itself.
  if (spec.sandbox === 'enabled') argv.push('--sandbox', 'enabled');
  else if (spec.sandbox === 'disabled') argv.push('--sandbox', 'disabled');
  return argv;
}

/** Secret-free run descriptor for diagnostics. */
function argvLabel(spec: CursorRunSpec): string {
  const flags = [
    spec.mode === 'plan' ? 'plan' : spec.mode,
    spec.force ? 'force' : 'propose-only',
    spec.trusted ? 'trusted' : 'untrusted',
    spec.resumeChatId ? 'resume' : 'fresh',
  ];
  if (spec.sandbox) flags.push(`sandbox=${spec.sandbox}`);
  if (spec.approveMcps) flags.push('approve-mcps');
  if (spec.extraEnv?.LIMBOO_BRIDGE_PIPE) flags.push('bridge');
  return `model=${spec.model} (${flags.join(', ')})`;
}

/** Kill the child and its whole process tree (cursor-agent spawns helpers). */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    // taskkill /T fells the whole tree; plain kill() orphans grandchildren.
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  const hardKill = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, CURSOR_LIMITS.killGraceMs);
  // Don't hold the event loop open for the grace timer.
  hardKill.unref?.();
}
