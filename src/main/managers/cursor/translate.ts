/**
 * Pure translators: Cursor stream-json events → Limboo's existing tool/message
 * identities. Cursor tool payloads are reshaped to the Claude-shaped input
 * keys (`file_path`, `command`, `content`, …) so every existing AgentManager
 * helper — summarizeTool, changeFromInput, editFromInput, terminal mirroring,
 * the attachment read hook — works on Cursor runs unmodified.
 */
import type { CursorAssistantEvent, CursorEvent, CursorToolCallEvent } from './types';
import { isReadOnlyShellCommand } from '../agent/readOnlyCommands';

/**
 * Disambiguate `--stream-partial-output` assistant events (official contract):
 *  - `timestamp_ms` present, `model_call_id` absent → streaming delta (consume)
 *  - both present → buffered flush before a tool call (skip — deltas carried it)
 *  - both absent → final flush at turn end (authoritative full text)
 */
export function classifyAssistantChunk(
  ev: CursorAssistantEvent,
): 'delta' | 'buffered-flush' | 'final-flush' {
  const hasTimestamp = typeof ev.timestamp_ms === 'number';
  const hasModelCall = typeof ev.model_call_id === 'string' && ev.model_call_id.length > 0;
  if (hasTimestamp && !hasModelCall) return 'delta';
  if (hasTimestamp && hasModelCall) return 'buffered-flush';
  return 'final-flush';
}

/** Join the text blocks of an assistant message (mirrors the Claude path). */
export function assistantText(ev: CursorAssistantEvent): string {
  const blocks = ev.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

/** Cursor union key → Limboo tool name. Unknown keys fall through generically. */
const TOOL_NAME_MAP: Record<string, string> = {
  readToolCall: 'Read',
  writeToolCall: 'Write',
  editToolCall: 'Edit',
  searchReplaceToolCall: 'Edit',
  strReplaceToolCall: 'Edit',
  multiEditToolCall: 'MultiEdit',
  deleteToolCall: 'Delete',
  deleteFileToolCall: 'Delete',
  shellToolCall: 'Bash',
  bashToolCall: 'Bash',
  terminalToolCall: 'Bash',
  grepToolCall: 'Grep',
  ripgrepToolCall: 'Grep',
  globToolCall: 'Glob',
  globFileSearchToolCall: 'Glob',
  lsToolCall: 'LS',
  listDirToolCall: 'LS',
  fetchToolCall: 'WebFetch',
  webFetchToolCall: 'WebFetch',
  readsemsearchfilesToolCall: 'Grep',
  codebaseSearchToolCall: 'Grep',
  applyPatchToolCall: 'Edit',
  webSearchToolCall: 'WebSearch',
  searchWebToolCall: 'WebSearch',
  updateTodosToolCall: 'TodoWrite',
  todoWriteToolCall: 'TodoWrite',
  taskToolCall: 'TodoWrite',
};

export interface MappedToolCall {
  callId: string;
  name: string;
  input: Record<string, unknown>;
}

/** Extract + normalize the single typed entry of a tool_call event. */
export function mapToolCall(ev: CursorToolCallEvent): MappedToolCall | null {
  const callId = typeof ev.call_id === 'string' && ev.call_id ? ev.call_id : null;
  const union = ev.tool_call;
  if (!callId || !union || typeof union !== 'object') return null;

  const key = Object.keys(union).find((k) => union[k] && typeof union[k] === 'object');
  if (!key) return null;
  const payload = union[key] as { args?: Record<string, unknown> };
  const args = payload.args && typeof payload.args === 'object' ? payload.args : {};

  if (key === 'mcpToolCall') {
    const server = strField(args, 'server') ?? strField(args, 'serverName') ?? 'server';
    const tool = strField(args, 'tool') ?? strField(args, 'toolName') ?? 'tool';
    return { callId, name: `mcp__${server}__${tool}`, input: { ...args } };
  }

  // Documented generic union entry: { function: { name, arguments } } where
  // `arguments` may be an object or a JSON string. Map the declared name
  // through the same identity tables as the typed keys.
  if (key === 'function') {
    const fn = union[key] as Record<string, unknown>;
    const rawName = (strField(fn, 'name') ?? '').trim();
    if (!rawName) return null;
    let fnArgs: Record<string, unknown> = {};
    const rawArgs = fn.arguments ?? fn.args;
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      fnArgs = rawArgs as Record<string, unknown>;
    } else if (typeof rawArgs === 'string') {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          fnArgs = parsed as Record<string, unknown>;
        }
      } catch {
        /* unparseable arguments stay empty — the chip still renders the name */
      }
    }
    const name =
      HOOK_TOOL_NAME_MAP[rawName.toLowerCase()] ?? TOOL_NAME_MAP[rawName] ?? genericToolName(rawName);
    return { callId, name, input: reshapeArgs(name, fnArgs) };
  }

  const name = TOOL_NAME_MAP[key] ?? genericToolName(key);
  return { callId, name, input: reshapeArgs(name, args) };
}

/** Reshape Cursor args to the Claude-shaped keys the existing helpers read. */
function reshapeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = { ...args };
  const filePath =
    strField(args, 'path') ??
    strField(args, 'file_path') ??
    strField(args, 'filePath') ??
    strField(args, 'target_file') ??
    strField(args, 'targetFile');

  switch (name) {
    case 'Read':
    case 'Delete':
      if (filePath) input.file_path = filePath;
      break;
    case 'LS': {
      const dir = filePath ?? strField(args, 'dir') ?? strField(args, 'directory');
      if (dir) input.file_path = dir;
      break;
    }
    case 'Write': {
      if (filePath) input.file_path = filePath;
      const content =
        strField(args, 'content') ?? strField(args, 'fileText') ?? strField(args, 'contents');
      if (content !== undefined) input.content = content;
      break;
    }
    case 'Edit':
    case 'MultiEdit': {
      if (filePath) input.file_path = filePath;
      const oldS = strField(args, 'old_string') ?? strField(args, 'oldString');
      const newS = strField(args, 'new_string') ?? strField(args, 'newString');
      if (oldS !== undefined) input.old_string = oldS;
      if (newS !== undefined) input.new_string = newS;
      break;
    }
    case 'Bash': {
      const command = strField(args, 'command') ?? strField(args, 'cmd');
      if (command !== undefined) input.command = command;
      break;
    }
    case 'Grep': {
      const pattern = strField(args, 'pattern') ?? strField(args, 'query') ?? strField(args, 'regex');
      if (pattern !== undefined) input.pattern = pattern;
      break;
    }
    case 'Glob': {
      const pattern = strField(args, 'pattern') ?? strField(args, 'globPattern');
      if (pattern !== undefined) input.pattern = pattern;
      break;
    }
    case 'WebFetch': {
      const url = strField(args, 'url');
      if (url !== undefined) input.url = url;
      break;
    }
    case 'WebSearch': {
      const query = strField(args, 'query') ?? strField(args, 'searchTerm');
      if (query !== undefined) input.query = query;
      break;
    }
    default:
      break;
  }
  return input;
}

/** Best-effort human name for an unmapped union key: strip suffix, capitalize. */
function genericToolName(key: string): string {
  const base = key.replace(/ToolCall$/, '') || key;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export interface MappedToolResult {
  status: 'done' | 'error';
  output?: string;
}

/** Extract the completion status + a bounded output string from a completed event. */
export function toolResultOf(ev: CursorToolCallEvent, outputMax: number): MappedToolResult {
  const union = ev.tool_call;
  const key = union ? Object.keys(union).find((k) => union[k] && typeof union[k] === 'object') : undefined;
  const result = key ? (union?.[key] as { result?: unknown })?.result : undefined;

  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.error !== undefined || r.failure !== undefined || r.rejected !== undefined) {
      return { status: 'error', output: resultText(r.error ?? r.failure ?? r.rejected, outputMax) };
    }
    if (r.success !== undefined) {
      return { status: 'done', output: resultText(r.success, outputMax) };
    }
  }
  return { status: 'done' };
}

/** Pull a display string out of an arbitrary result payload (bounded). */
function resultText(value: unknown, outputMax: number): string | undefined {
  if (typeof value === 'string') return value.slice(0, outputMax);
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const field of ['content', 'stdout', 'output', 'message', 'text']) {
    if (typeof obj[field] === 'string' && (obj[field] as string).length > 0) {
      return (obj[field] as string).slice(0, outputMax);
    }
  }
  try {
    return JSON.stringify(obj).slice(0, outputMax);
  } catch {
    return undefined;
  }
}

/**
 * Tools whose successful "completion" in a non-force run means the change was
 * only PROPOSED (print mode without --force never applies edits or commands).
 * A provably read-only shell command (`git log`, `ls`, …) proposes nothing —
 * counting it would mint a bogus "Cursor proposed N changes" artifact from a
 * purely investigative run.
 */
export function isProposedMutation(name: string, input?: Record<string, unknown>): boolean {
  if (name === 'Bash') return !isReadOnlyShellCommand(input?.command);
  return name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'Delete';
}

function strField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

/** Hook `tool_name` values → Limboo tool names (same identities as the map above). */
const HOOK_TOOL_NAME_MAP: Record<string, string> = {
  read: 'Read',
  read_file: 'Read',
  write: 'Write',
  write_file: 'Write',
  create_file: 'Write',
  edit: 'Edit',
  edit_file: 'Edit',
  search_replace: 'Edit',
  str_replace: 'Edit',
  multi_edit: 'MultiEdit',
  delete: 'Delete',
  delete_file: 'Delete',
  shell: 'Bash',
  bash: 'Bash',
  terminal: 'Bash',
  run_terminal_cmd: 'Bash',
  grep: 'Grep',
  ripgrep: 'Grep',
  codebase_search: 'Grep',
  apply_patch: 'Edit',
  glob: 'Glob',
  glob_file_search: 'Glob',
  ls: 'LS',
  list_dir: 'LS',
  fetch: 'WebFetch',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
};

export interface MappedHookEvent {
  /** Limboo tool identity (feeds classifyTool / summarizeTool unchanged). */
  name: string;
  /** Claude-shaped input keys (file_path / command / …). */
  input: Record<string, unknown>;
  /** True for observe-only events (afterFileEdit) — never gated. */
  observeOnly: boolean;
}

/**
 * Translate a Cursor hook payload into the Limboo tool identity the existing
 * permission machinery understands. Unknown events return null (the caller
 * decides the fail posture — for gate events that is DENY).
 */
export function mapHookEvent(
  event: string,
  payload: Record<string, unknown>,
): MappedHookEvent | null {
  switch (event) {
    case 'beforeShellExecution': {
      const command = strField(payload, 'command') ?? strField(payload, 'cmd') ?? '';
      return { name: 'Bash', input: { command }, observeOnly: false };
    }
    case 'beforeReadFile': {
      const filePath =
        strField(payload, 'file_path') ?? strField(payload, 'path') ?? strField(payload, 'filePath');
      return { name: 'Read', input: filePath ? { file_path: filePath } : {}, observeOnly: false };
    }
    case 'afterFileEdit': {
      const filePath =
        strField(payload, 'file_path') ?? strField(payload, 'path') ?? strField(payload, 'filePath');
      return { name: 'Edit', input: filePath ? { file_path: filePath } : {}, observeOnly: true };
    }
    case 'preToolUse': {
      const rawName = (strField(payload, 'tool_name') ?? strField(payload, 'toolName') ?? '').trim();
      if (!rawName) return null;
      const rawInput = payload.tool_input ?? payload.toolInput;
      const args =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      const name =
        HOOK_TOOL_NAME_MAP[rawName.toLowerCase()] ??
        TOOL_NAME_MAP[rawName] ??
        genericToolName(rawName);
      return { name, input: reshapeArgs(name, args), observeOnly: false };
    }
    default:
      return null;
  }
}

/** Narrow an arbitrary parsed event to the assistant shape. */
export function isAssistantEvent(ev: CursorEvent): ev is CursorAssistantEvent {
  return ev.type === 'assistant';
}

/** Narrow an arbitrary parsed event to the tool_call shape. */
export function isToolCallEvent(ev: CursorEvent): ev is CursorToolCallEvent {
  return ev.type === 'tool_call';
}
