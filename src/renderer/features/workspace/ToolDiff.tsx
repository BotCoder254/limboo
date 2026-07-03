/**
 * ToolDiff — the expanded diff for a file-editing tool call in the conversation
 * stream. Renders the removed (before) and added (after) content as two
 * Shiki-highlighted, tinted segments — the same visual language as the Git
 * panel's DiffView (red for removals, green for additions) — plus gutter line
 * numbers inherited from the shared `.limboo-code` styles. Creates show only the
 * added segment, deletions only the removed one. Highlighting is async (Shiki),
 * so each segment falls back to plain mono text until it settles.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/renderer/lib/cn';
import { highlightCode } from '@/renderer/lib/highlight';
import type { AgentToolCall, FileChangeStatus } from '@shared/types';

/** One tinted, Shiki-highlighted code segment (the removed or the added side). */
function DiffSegment({
  code,
  lang,
  tone,
  label,
}: {
  code: string;
  lang?: string;
  tone: 'add' | 'del';
  label: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void highlightCode(code, lang).then((result) => {
      if (alive) setHtml(result);
    });
    return () => {
      alive = false;
    };
  }, [code, lang]);

  const add = tone === 'add';
  return (
    <div
      className={cn(
        'overflow-hidden border-l-2',
        add ? 'border-success/50 bg-success/[0.06]' : 'border-danger/50 bg-danger/[0.06]',
      )}
    >
      <div
        className={cn(
          'px-3 py-0.5 font-mono text-[10px] uppercase tracking-wider',
          add ? 'text-success' : 'text-danger',
        )}
      >
        {add ? '+' : '−'} {label}
      </div>
      {html ? (
        <div
          className="limboo-code overflow-x-auto text-[12px]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="limboo-code overflow-x-auto px-3 py-1.5 text-[12px]">
          <code className="font-mono text-fg">{code}</code>
        </pre>
      )}
    </div>
  );
}

export function ToolDiff({
  edit,
  status,
}: {
  edit: NonNullable<AgentToolCall['edit']>;
  status?: FileChangeStatus;
}) {
  const showBefore = status !== 'added' && edit.before.length > 0;
  const showAfter = status !== 'deleted' && edit.after.length > 0;

  return (
    <div className="ml-6 flex flex-col overflow-hidden rounded-md border border-line bg-[#0a0a0a]">
      {showBefore && (
        <DiffSegment code={edit.before} lang={edit.lang} tone="del" label="removed" />
      )}
      {showAfter && (
        <DiffSegment code={edit.after} lang={edit.lang} tone="add" label="added" />
      )}
    </div>
  );
}
