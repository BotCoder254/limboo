/**
 * The conversation timeline for a session. Renders the chat turns and the
 * agent's tool calls interleaved in chronological order, streaming assistant
 * tokens in as they arrive. Pure presentation — all data comes from the agent
 * store, which applies the structured event stream from the main process.
 */
import { useMemo } from 'react';
import {
  Eye,
  FilePen,
  FilePlus,
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

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...snapshot.messages.map((message) => ({ kind: 'message' as const, at: message.createdAt, message })),
      ...snapshot.toolCalls.map((call) => ({ kind: 'tool' as const, at: call.startedAt, call })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [snapshot.messages, snapshot.toolCalls]);

  return (
    <div className="flex flex-col gap-5 pb-4">
      {timeline.map((item) =>
        item.kind === 'message' ? (
          <MessageRow key={item.message.id} message={item.message} />
        ) : (
          <ToolChip key={item.call.id} call={item.call} />
        ),
      )}
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        {isUser ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">
            You
          </span>
        ) : (
          <Logo size={18} tone={message.streaming ? 'accent' : 'fg'} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'whitespace-pre-wrap break-words text-[13px] leading-relaxed',
            isUser ? 'text-fg' : 'text-fg',
          )}
        >
          {message.text}
          {message.streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

function ToolChip({ call }: { call: AgentToolCall }) {
  const Icon = toolIcon(call);
  return (
    <div className="ml-9 flex items-center gap-2 self-start rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <Icon size={13} className={cn(call.risk === 'command' ? 'text-warning' : 'text-muted')} />
      <span className="text-[12px] text-muted">{call.summary}</span>
      {call.status === 'running' ? (
        <Spinner size={12} className="ml-1" />
      ) : (
        <span
          className={cn(
            'ml-1 h-1.5 w-1.5 rounded-full',
            call.status === 'done' && 'bg-success',
            call.status === 'error' && 'bg-danger',
            call.status === 'denied' && 'bg-faint',
          )}
        />
      )}
    </div>
  );
}
