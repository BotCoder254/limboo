/**
 * The conversation timeline for a session. Renders chat turns and the agent's
 * tool calls interleaved chronologically, streaming assistant tokens in as they
 * arrive. Pure presentation — all data comes from the agent store, which applies
 * the structured event stream from the main process.
 *
 * Assistant turns render as full-width Markdown (with highlighted code blocks);
 * user turns render as a compact right-aligned bubble. Tool calls render as
 * expandable cards that surface intent + target (e.g. a web search query/URL).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Eye,
  FilePen,
  FilePlus,
  GitBranch,
  Globe,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AgentToolCall, ChatMessage } from '@shared/types';
import { Logo } from '@/renderer/components/brand/Logo';
import { Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useAgentStore, EMPTY_SNAPSHOT } from '@/renderer/stores/useAgentStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { Markdown } from './Markdown';
import { InlineApproval } from './InlineApproval';

type TimelineItem =
  | { kind: 'message'; at: number; message: ChatMessage }
  | { kind: 'tool'; at: number; call: AgentToolCall };

function toolIcon(call: AgentToolCall): LucideIcon {
  switch (call.name) {
    case 'Read':
      return Eye;
    case 'Write':
      return FilePlus;
    case 'Edit':
    case 'MultiEdit':
      return FilePen;
    case 'Bash':
      return Terminal;
    case 'Grep':
    case 'Glob':
      return Search;
    case 'WebSearch':
    case 'WebFetch':
      return Globe;
    default:
      return Wrench;
  }
}

export function ConversationView({ sessionId }: { sessionId: string }) {
  const snapshot = useAgentStore((s) => s.bySession[sessionId]) ?? EMPTY_SNAPSHOT;
  const pending = useAgentStore((s) => s.pending);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...snapshot.messages.map((message) => ({ kind: 'message' as const, at: message.createdAt, message })),
      ...snapshot.toolCalls.map((call) => ({ kind: 'tool' as const, at: call.startedAt, call })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [snapshot.messages, snapshot.toolCalls]);

  // Auto-stick to the bottom while streaming, but only if the user hasn't
  // scrolled up — preserving their scroll position is the whole point.
  useEffect(() => {
    const el = findScrollParent(bottomRef.current);
    if (!el) return;
    const onScroll = () => {
      // The scroll area reserves the composer's height as bottom padding, so the
      // resting "at bottom" position is only ~16px from the true scroll bottom;
      // a modest threshold keeps auto-follow sticky through fast streaming.
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [timeline, pending]);

  const approval = pending && pending.sessionId === sessionId ? pending : null;

  return (
    <div className="flex flex-col gap-6 pb-4">
      {timeline.map((item) =>
        item.kind === 'message' ? (
          <MessageRow key={item.message.id} message={item.message} />
        ) : (
          <ToolCard key={item.call.id} call={item.call} />
        ),
      )}
      {approval && <InlineApproval request={approval} />}
      {/* Scroll anchor — its scroll-margin keeps the last line above the floating
          composer when auto-scrolling (honored by scrollIntoView). */}
      <div ref={bottomRef} style={{ scrollMarginBottom: 'calc(var(--composer-h, 360px) + 1.5rem)' }} />
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

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-surface-2 px-4 py-2.5 text-[13.5px] leading-relaxed text-fg shadow-sm animate-fade-in">
          {message.text}
        </div>
      </div>
    );
  }

  const empty = message.text.trim().length === 0;
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2">
        <Logo size={16} tone={message.streaming ? 'accent' : 'fg'} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {empty && message.streaming ? (
          <ThinkingDots />
        ) : (
          <>
            <Markdown text={message.text} streaming={message.streaming} />
            {message.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1 text-muted" aria-label="Thinking">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
    </span>
  );
}

/** Open the Git workspace focused on the changes view (activity-card jump). */
function openGit(path?: string): void {
  useGitStore.getState().setFocus({ view: 'status', path });
  useLayoutStore.getState().setActiveTab('git');
}

function ToolCard({ call }: { call: AgentToolCall }) {
  const Icon = toolIcon(call);
  const isWeb = call.name === 'WebSearch' || call.name === 'WebFetch';
  const [open, setOpen] = useState(false);
  const expandable = !!call.detail && call.detail !== call.target;

  return (
    <div className="ml-10 max-w-[85%] self-start overflow-hidden rounded-md border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left',
          expandable && 'transition-colors hover:bg-elevated',
        )}
      >
        <Icon size={14} className={cn('shrink-0', call.risk === 'command' ? 'text-warning' : 'text-muted')} />
        <span className="shrink-0 text-[12px] font-medium text-fg">{call.summary}</span>
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
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {call.name === 'Bash' && (
            <span
              role="button"
              tabIndex={0}
              title="Focus terminal"
              onClick={(e) => {
                e.stopPropagation();
                useLayoutStore.getState().setActiveTab('terminal');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  useLayoutStore.getState().setActiveTab('terminal');
                }
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-elevated hover:text-fg"
            >
              <Terminal size={11} />
              Terminal
            </span>
          )}
          {call.risk === 'write' && (
            <span
              role="button"
              tabIndex={0}
              title="Review change in Git"
              onClick={(e) => {
                e.stopPropagation();
                openGit(call.target);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  openGit(call.target);
                }
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-elevated hover:text-fg"
            >
              <GitBranch size={11} />
              Git
            </span>
          )}
          <ToolStatus status={call.status} />
          {expandable && (
            <ChevronRight size={13} className={cn('text-faint transition-transform', open && 'rotate-90')} />
          )}
        </span>
      </button>
      {open && expandable && (
        <pre className="max-h-48 overflow-auto border-t border-line bg-[#0a0a0a] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted">
          {call.detail}
        </pre>
      )}
    </div>
  );
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
