/**
 * The conversation timeline for a session — rendered as ONE continuous event
 * stream rather than a set of separate cards. Each user prompt opens a *turn*;
 * everything the agent does in response (streamed text, tool execution, file/
 * git changes, terminal activity, memory/checkpoint markers, completion) is
 * interleaved chronologically inside that turn's single assistant block, under
 * one avatar. There are no bordered "tool cards" or a detached approval dialog:
 * tool calls, status markers, and the permission prompt all read as lightweight
 * inline continuations of the assistant's response.
 *
 * Pure presentation — all data comes from the agent store, which applies the
 * structured event stream from the main process. Assistant text renders as
 * full-width Markdown (with streaming-aware highlighted code blocks); the user's
 * turn renders as a compact right-aligned bubble.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, CircleAlert } from 'lucide-react';
import type { AgentActivityItem, AgentToolCall, AttachmentMeta, ChatMessage, PermissionRequest } from '@shared/types';
import { Logo } from '@/renderer/components/brand/Logo';
import { Spinner } from '@/renderer/components/ui';
import { DiffStat } from '@/renderer/components/ui/DiffStat';
import { cn } from '@/renderer/lib/cn';
import { useAgentStore, EMPTY_SNAPSHOT } from '@/renderer/stores/useAgentStore';
import { phaseLabel } from '@/renderer/features/agent/status';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useAttachmentStore } from '@/renderer/stores/useAttachmentStore';
import { AttachmentChip } from './AttachmentChip';
import { Markdown } from './Markdown';
import { MessageSkeleton, ThinkingPulse } from './MessageSkeleton';
import { InlineApproval } from './InlineApproval';
import { ToolDiff } from './ToolDiff';

/** Human label for a file-edit tool's change status, shown inline in the stream. */
const CHANGE_WORD: Record<string, string> = {
  added: 'Created',
  modified: 'Edited',
  deleted: 'Deleted',
};

/** Activity types that surface inline in the conversation as status markers.
 *  Tool / prompt / file-change / permission activity is intentionally excluded —
 *  those are already represented by the tool rows and the user bubble, so showing
 *  them again would double up the timeline. `clarification` is included so a
 *  resolved AskUserQuestion leaves an answered summary in the stream. */
const MARKER_TYPES: ReadonlySet<AgentActivityItem['type']> = new Set([
  'result',
  'status',
  'error',
  'clarification',
]);

/** A single chronological item inside an assistant block. */
type Block =
  | { kind: 'text'; at: number; message: ChatMessage }
  | { kind: 'tool'; at: number; call: AgentToolCall }
  | { kind: 'marker'; at: number; item: AgentActivityItem };

/** A conversation turn: the user's prompt (if any) + the assistant's response. */
interface Turn {
  key: string;
  user: ChatMessage | null;
  blocks: Block[];
}

/** Items actually rendered inside an assistant block: text and markers pass
 *  through, but consecutive tool calls fold into ONE group so a long run of
 *  tools reads as a single compact line instead of a wall of rows. */
type RenderItem =
  | { kind: 'text'; message: ChatMessage }
  | { kind: 'marker'; item: AgentActivityItem }
  | { kind: 'tool-group'; key: string; calls: AgentToolCall[] };

/** Collapse consecutive tool blocks into one group; text/markers break a run.
 *  The group key is the FIRST call's id — stable while a live group appends. */
function groupBlocks(blocks: Block[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const b of blocks) {
    if (b.kind === 'tool') {
      const last = out[out.length - 1];
      if (last && last.kind === 'tool-group') last.calls.push(b.call);
      else out.push({ kind: 'tool-group', key: b.call.id, calls: [b.call] });
    } else if (b.kind === 'text') {
      out.push({ kind: 'text', message: b.message });
    } else {
      out.push({ kind: 'marker', item: b.item });
    }
  }
  return out;
}

/** Fold the session snapshot into chronological turns. A user message opens a
 *  new turn; assistant text, tool calls, and status markers attach to the turn
 *  in flight (sorted by their own timestamps so they interleave naturally). */
function buildTurns(
  messages: ChatMessage[],
  toolCalls: AgentToolCall[],
  activity: AgentActivityItem[],
): Turn[] {
  const blocks: Block[] = [
    ...messages
      .filter((m) => m.role !== 'user')
      .map((message) => ({ kind: 'text' as const, at: message.createdAt, message })),
    ...toolCalls.map((call) => ({ kind: 'tool' as const, at: call.startedAt, call })),
    ...activity
      .filter((item) => MARKER_TYPES.has(item.type))
      .map((item) => ({ kind: 'marker' as const, at: item.at, item })),
  ].sort((a, b) => a.at - b.at);

  const users = messages
    .filter((m) => m.role === 'user')
    .sort((a, b) => a.createdAt - b.createdAt);

  const turns: Turn[] = [];
  let cursor = 0; // index into `blocks`
  // Any assistant activity that predates the first user prompt (rare) becomes a
  // leading authorless turn so nothing is dropped.
  const leading: Block[] = [];
  const firstUserAt = users[0]?.createdAt ?? Infinity;
  while (cursor < blocks.length && blocks[cursor].at < firstUserAt) {
    leading.push(blocks[cursor++]);
  }
  if (leading.length) turns.push({ key: 'lead', user: null, blocks: leading });

  users.forEach((user, i) => {
    const nextAt = users[i + 1]?.createdAt ?? Infinity;
    const turnBlocks: Block[] = [];
    while (cursor < blocks.length && blocks[cursor].at < nextAt) {
      turnBlocks.push(blocks[cursor++]);
    }
    turns.push({ key: user.id, user, blocks: turnBlocks });
  });

  return turns;
}

export function ConversationView({ sessionId }: { sessionId: string }) {
  const snapshot = useAgentStore((s) => s.bySession[sessionId]) ?? EMPTY_SNAPSHOT;
  const pending = useAgentStore((s) => s.pendingBySession[sessionId] ?? null);
  // The active run's phase for THIS session — drives the pre-first-token skeleton
  // so the connect→first-token gap (the part that actually feels slow) shows the
  // shimmer instead of nothing. `ensureStreaming` only fires on the first token,
  // so without this the skeleton's empty-text window never paints. Reads the
  // per-session phase map — sessions can run concurrently, so this must never
  // fall back to a single global "the active request" field.
  const thinking = useAgentStore((s) => {
    const phase = s.requestsBySession[sessionId]?.phase;
    return (
      phase === 'submitting' ||
      phase === 'connecting' ||
      phase === 'streaming' ||
      phase === 'recovering'
    );
  });
  // The run is paused on an AskUserQuestion for this session — the card lives
  // above the composer; here we only show a lightweight inline "waiting" status.
  const clarifying = useAgentStore((s) => !!s.pendingClarificationBySession[sessionId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Id of the last user message we pinned to — lets us force-follow the user's own
  // prompt into view even if they had scrolled up reading the previous reply.
  const lastUserId = useRef<string | null>(null);

  const turns = useMemo(
    () => buildTurns(snapshot.messages, snapshot.toolCalls, snapshot.activity),
    [snapshot.messages, snapshot.toolCalls, snapshot.activity],
  );

  // Auto-stick to the bottom while streaming, but only if the user hasn't
  // scrolled up — preserving their scroll position is the whole point.
  useEffect(() => {
    const el = findScrollParent(bottomRef.current);
    if (!el) return;
    const onScroll = () => {
      // A modest threshold keeps auto-follow sticky through fast streaming while
      // still releasing it the moment the user scrolls up to read.
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // When the user has just sent a new prompt, always pull it above the composer —
    // regardless of prior scroll position. Otherwise honor the sticky threshold so we
    // don't yank the view while the user is reading a streaming reply scrolled-up.
    const lastUser = [...snapshot.messages].reverse().find((m) => m.role === 'user');
    const sentNew = !!lastUser && lastUser.id !== lastUserId.current;
    if (sentNew) {
      lastUserId.current = lastUser.id;
      stick.current = true;
    }
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending, snapshot.messages]);

  const approval = pending && pending.sessionId === sessionId ? pending : null;
  const lastKey = turns.length ? turns[turns.length - 1].key : null;

  return (
    <div className="flex flex-col gap-6 pb-4">
      {turns.map((turn) => (
        <TurnView
          key={turn.key}
          sessionId={sessionId}
          turn={turn}
          // The pending approval / clarification wait docks inside the most recent
          // turn's assistant block, immediately beneath the latest streamed content.
          approval={approval && turn.key === lastKey ? approval : null}
          waiting={clarifying && !approval && turn.key === lastKey}
          // Pre-first-token shimmer for the in-flight turn, only while it has no
          // content of its own yet (tools / text supersede it).
          thinking={thinking && !approval && !clarifying && turn.key === lastKey}
        />
      ))}
      {/* Approval / clarification arriving before any assistant content has a turn
          to attach to. */}
      {!turns.length && approval && (
        <AssistantBlock blocks={[]} trailing={<InlineApproval request={approval} />} />
      )}
      {!turns.length && !approval && clarifying && (
        <AssistantBlock blocks={[]} trailing={<WaitingForDecision />} />
      )}
      {!turns.length && !approval && !clarifying && thinking && (
        <AssistantBlock
          blocks={[]}
          trailing={
            <>
              <LiveStatusRow sessionId={sessionId} />
              <MessageSkeleton />
            </>
          }
        />
      )}
      {/* Scroll anchor — a small bottom margin keeps the last line off the very
          edge when auto-scrolling (honored by scrollIntoView). The composer is
          docked in flow below the scroller, so no large reserve is needed. */}
      <div ref={bottomRef} style={{ scrollMarginBottom: '1rem' }} />
    </div>
  );
}

/** Walk up to the nearest vertically-scrollable ancestor. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

// Memoized so a streaming delta (which re-renders ConversationView every frame)
// only re-renders the in-flight turn: settled turns receive referentially-stable
// props (their `turn` object keeps identity across rebuilds, and approval/waiting/
// thinking are only truthy for the last turn) and skip re-rendering entirely.
const TurnView = memo(function TurnView({
  sessionId,
  turn,
  approval,
  waiting,
  thinking,
}: {
  sessionId: string;
  turn: Turn;
  approval: PermissionRequest | null;
  waiting?: boolean;
  thinking?: boolean;
}) {
  // The shimmer is the pre-first-token placeholder: only surface it while this
  // turn has produced no blocks of its own (a tool row or streamed text replaces it).
  const showSkeleton = !!thinking && turn.blocks.length === 0;
  // Mid-turn gap: the run is still active but nothing in this turn is visibly
  // in flight (no streaming text, no running tool) — e.g. between a tool ending
  // and the next token. Surface a compact pulse so "working" never looks stalled.
  const hasStreamingText = turn.blocks.some((b) => b.kind === 'text' && b.message.streaming);
  const hasRunningTool = turn.blocks.some((b) => b.kind === 'tool' && b.call.status === 'running');
  const showGapPulse =
    !!thinking && turn.blocks.length > 0 && !hasStreamingText && !hasRunningTool;
  const showAssistant = turn.blocks.length > 0 || !!approval || !!waiting || showSkeleton;
  // While the run is active and no text is visibly streaming, the live status
  // row names what the agent is doing right now (phase- and tool-aware) beside
  // the shimmer/pulse. It stays mounted across skeleton → gap → tool
  // transitions so its elapsed clock never resets mid-run.
  const live = !!thinking && !hasStreamingText;
  const trailing = approval ? (
    <InlineApproval request={approval} />
  ) : waiting ? (
    <WaitingForDecision />
  ) : live ? (
    <>
      <LiveStatusRow sessionId={sessionId} />
      {showSkeleton ? <MessageSkeleton /> : showGapPulse ? <ThinkingPulse /> : null}
    </>
  ) : null;
  return (
    <div className="flex flex-col gap-4">
      {turn.user && <UserBubble message={turn.user} />}
      {showAssistant && <AssistantBlock blocks={turn.blocks} trailing={trailing} />}
    </div>
  );
}, turnsEqual);

/** The payload behind a block (message / tool call / activity item). Blocks are
 *  rebuilt (fresh wrappers) on every event, but the underlying entities keep their
 *  identity unless they actually changed — so a settled turn compares equal and a
 *  streaming turn (whose message object is replaced each frame) does not. */
function blockPayload(b: Block): unknown {
  return b.kind === 'text' ? b.message : b.kind === 'tool' ? b.call : b.item;
}

function sameBlocks(a: Block[], b: Block[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind || blockPayload(a[i]) !== blockPayload(b[i])) return false;
  }
  return true;
}

/** memo comparator for {@link TurnView}: skip re-render when nothing this turn
 *  depends on changed by identity. This is what keeps streaming cheap. */
function turnsEqual(
  prev: { sessionId: string; turn: Turn; approval: PermissionRequest | null; waiting?: boolean; thinking?: boolean },
  next: { sessionId: string; turn: Turn; approval: PermissionRequest | null; waiting?: boolean; thinking?: boolean },
): boolean {
  return (
    prev.sessionId === next.sessionId &&
    prev.approval === next.approval &&
    prev.waiting === next.waiting &&
    prev.thinking === next.thinking &&
    prev.turn.key === next.turn.key &&
    prev.turn.user === next.turn.user &&
    sameBlocks(prev.turn.blocks, next.turn.blocks)
  );
}

/**
 * Live "working" indicator shown alongside the shimmer/pulse while a run is
 * active: a pulsing accent dot, the current phase (tool-aware — "Searching the
 * web…", "Running a command…", …), and elapsed time. Subscribes to the agent
 * store directly so phase/tool changes tick through live even though the
 * surrounding TurnView is memoized on coarser props.
 */
function LiveStatusRow({ sessionId }: { sessionId: string }) {
  const phase = useAgentStore((s) => s.requestsBySession[sessionId]?.phase ?? 'idle');
  const toolName = useAgentStore((s) => {
    const calls = s.bySession[sessionId]?.toolCalls;
    if (!calls) return undefined;
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i].status === 'running') return calls[i].name;
    }
    return undefined;
  });
  // RequestState carries no start timestamp, so elapsed counts from when this
  // indicator appeared — it mounts with the run and stays put until text streams.
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - startedAt.current) / 1000));
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted animate-fade-in" aria-live="polite">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
      <span>{phaseLabel(phase, toolName)}</span>
      {secs >= 3 && <span className="tabular-nums text-faint">{elapsed}</span>}
    </div>
  );
}

/** Lightweight inline status while the run is paused on an AskUserQuestion. The
 *  interactive card lives above the composer; this just keeps the stream honest. */
function WaitingForDecision() {
  return (
    <div className="flex items-center gap-2 border-l border-accent/50 pl-3 text-[12px] text-accent animate-fade-in">
      <Spinner size={12} />
      <span>Waiting for your decision…</span>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachments sessionId={message.sessionId} attachments={message.attachments} />
      )}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] leading-relaxed text-fg shadow-sm animate-fade-in">
        {message.text}
      </div>
    </div>
  );
}

/**
 * Read-only attachment chips on a sent user turn. Status is looked up live in
 * the attachment store (so a chip flips to "read" the moment the agent opens
 * the file), with the persisted meta on the message as fallback.
 */
function MessageAttachments({
  sessionId,
  attachments,
}: {
  sessionId: string;
  attachments: AttachmentMeta[];
}) {
  const live = useAttachmentStore((s) => s.bySession[sessionId]);
  const reveal = useAttachmentStore((s) => s.reveal);
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {attachments.map((meta) => {
        const current = live?.find((a) => a.id === meta.id) ?? meta;
        return (
          <AttachmentChip key={meta.id} meta={current} onClick={() => reveal(sessionId, meta.id)} />
        );
      })}
    </div>
  );
}

/** The assistant's response for a turn: a single avatar plus a vertical flow of
 *  chronologically-interleaved sub-items (text, tool rows, status markers, and an
 *  optional trailing approval). */
const AssistantBlock = memo(function AssistantBlock({
  blocks,
  trailing,
}: {
  blocks: Block[];
  trailing?: ReactNode;
}) {
  const streaming = blocks.some((b) => b.kind === 'text' && b.message.streaming);
  // Grouping is derived per render of an already-invalidated turn — settled
  // turns never reach this (TurnView's memo comparator short-circuits them).
  const items = useMemo(() => groupBlocks(blocks), [blocks]);
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2">
        <Logo size={16} className={streaming ? 'animate-pulse' : undefined} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
        {items.map((it) => {
          if (it.kind === 'text') return <AssistantText key={it.message.id} message={it.message} />;
          if (it.kind === 'marker') return <InlineMarkerRow key={it.item.id} item={it.item} />;
          return <ToolGroup key={it.key} calls={it.calls} />;
        })}
        {trailing}
      </div>
    </div>
  );
});

function AssistantText({ message }: { message: ChatMessage }) {
  // A streaming message with no text yet is the pre-first-token moment — reserve
  // the reply's shape with a shimmer skeleton until the first delta lands.
  if (message.streaming && message.text.trim().length === 0) return <MessageSkeleton />;
  return (
    <div>
      <Markdown text={message.text} streaming={message.streaming} />
      {message.streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle" />
      )}
    </div>
  );
}

/** Open the Git workspace focused on the changes view (inline-event jump). */
function openGit(path?: string): void {
  useGitStore.getState().setFocus({ view: 'status', path });
  useLayoutStore.getState().setActiveTab('git');
}

/** A de-carded tool invocation: a lightweight inline row that reads as a
 *  continuation of the assistant's message rather than a bordered card. No
 *  icons by design — the tool NAME (subtle mono) is the identifier. Keeps the
 *  expandable detail and the Git / terminal click-throughs. */
function InlineEventRow({ call }: { call: AgentToolCall }) {
  const isWeb = call.name === 'WebSearch' || call.name === 'WebFetch';
  const [open, setOpen] = useState(false);
  // A file-edit tool carries a structured change + diff preview; prefer showing
  // the Shiki diff on expand over the plain-text `detail`.
  const hasDiff = !!call.edit && (call.edit.before.length > 0 || call.edit.after.length > 0);
  const expandable = hasDiff || (!!call.detail && call.detail !== call.target);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => expandable && setOpen((v) => !v)}
          disabled={!expandable}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left',
            expandable ? 'transition-colors hover:bg-surface-2' : 'cursor-default',
          )}
        >
          <span
            className={cn(
              'shrink-0 font-mono text-[11px] font-medium leading-none',
              call.risk === 'command' ? 'text-warning' : 'text-faint',
            )}
          >
            {call.name}
          </span>
          <span className="shrink-0 text-[12px] text-muted">{call.summary}</span>
          {call.change && (
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  'text-[10px] uppercase tracking-wider',
                  call.change.status === 'added'
                    ? 'text-success'
                    : call.change.status === 'deleted'
                      ? 'text-danger'
                      : 'text-faint',
                )}
              >
                {CHANGE_WORD[call.change.status] ?? call.change.status}
              </span>
              {(call.change.adds > 0 || call.change.dels > 0) && (
                <DiffStat adds={call.change.adds} dels={call.change.dels} />
              )}
            </span>
          )}
          {call.target && (
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11.5px]',
                isWeb ? 'font-mono text-accent-fg' : 'text-faint',
              )}
              title={call.target}
            >
              {call.target}
            </span>
          )}
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          {call.name === 'Bash' && (
            <button
              type="button"
              title="Focus terminal"
              onClick={() => useLayoutStore.getState().setActiveTab('terminal')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-elevated hover:text-fg"
            >
              Terminal
            </button>
          )}
          {call.risk === 'write' && (
            <button
              type="button"
              title="Review change in Git"
              onClick={() => openGit(call.target)}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-elevated hover:text-fg"
            >
              Git
            </button>
          )}
          <ToolStatus status={call.status} />
          {expandable && (
            <ChevronRight size={13} className={cn('text-faint transition-transform', open && 'rotate-90')} />
          )}
        </span>
      </div>
      {open && hasDiff && call.edit && (
        <ToolDiff edit={call.edit} status={call.change?.status} />
      )}
      {open && !hasDiff && expandable && (
        <pre className="ml-6 max-h-48 overflow-auto rounded-md border border-line bg-[#0a0a0a] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted">
          {call.detail}
        </pre>
      )}
    </div>
  );
}

/** A run of consecutive tool calls, kept compact the way Claude Code keeps its
 *  transcript clean: while running, only the header counter + the currently
 *  running row(s) show; once every call settles the rows fold away into a
 *  single "Ran N tools" summary line, expandable via the chevron. */
function ToolGroup({ calls }: { calls: AgentToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 1) return <InlineEventRow call={calls[0]} />;

  const running = calls.filter((c) => c.status === 'running');
  const settled = running.length === 0;
  const failed = calls.some((c) => c.status === 'error' || c.status === 'denied');
  const done = calls.length - running.length;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2"
      >
        <ChevronRight
          size={13}
          className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')}
        />
        <span>{settled ? `Ran ${calls.length} tools` : `Running tools… ${done}/${calls.length}`}</span>
        <span className="ml-auto flex shrink-0 items-center">
          {settled ? (
            <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-danger' : 'bg-success')} />
          ) : (
            <Spinner size={12} />
          )}
        </span>
      </button>
      {open ? (
        <div className="ml-1.5 flex flex-col gap-1 border-l border-line pl-2">
          {calls.map((c) => (
            <InlineEventRow key={c.id} call={c} />
          ))}
        </div>
      ) : (
        !settled && (
          <div className="ml-1.5 flex flex-col gap-1 border-l border-line pl-2">
            {running.map((c) => (
              <InlineEventRow key={c.id} call={c} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** A faint inline status marker (completion, checkpoint, plan transitions,
 *  memory recall, rate-limit, errors) sourced from the activity feed. */
function InlineMarkerRow({ item }: { item: AgentActivityItem }) {
  const tone = item.tone ?? 'info';
  return (
    <div className="flex items-center gap-2 px-1 text-[11.5px]">
      <MarkerIcon item={item} />
      <span className={cn('truncate', tone === 'danger' ? 'text-danger' : 'text-faint')} title={item.detail}>
        {item.label}
      </span>
    </div>
  );
}

function MarkerIcon({ item }: { item: AgentActivityItem }) {
  if (item.type === 'result') return <Check size={12} className="shrink-0 text-success" />;
  if (item.type === 'clarification') return <Check size={12} className="shrink-0 text-accent" />;
  if (item.type === 'error') return <CircleAlert size={12} className="shrink-0 text-danger" />;
  const dot =
    item.tone === 'success'
      ? 'bg-success'
      : item.tone === 'warning'
        ? 'bg-warning'
        : item.tone === 'danger'
          ? 'bg-danger'
          : 'bg-faint';
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />;
}

function ToolStatus({ status }: { status: AgentToolCall['status'] }) {
  if (status === 'running') return <Spinner size={12} />;
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'done' && 'bg-success',
        status === 'error' && 'bg-danger',
        status === 'denied' && 'bg-faint',
      )}
    />
  );
}
