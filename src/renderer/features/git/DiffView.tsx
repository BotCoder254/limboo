/**
 * Reusable unified-diff renderer for a single file. Shared by the Git workspace
 * Diff sub-view and the inline expansion in the Changes panel. Renders each hunk
 * with old/new line gutters and add/del/context coloring on the dark palette.
 * Kept synchronous + lightweight (no async syntax pass) so it stays snappy inside
 * scrolling lists.
 */
import { cn } from '@/renderer/lib/cn';
import { Spinner } from '@/renderer/components/ui';
import type { GitFileDiff } from '@shared/types';

export function DiffView({ diff, loading }: { diff?: GitFileDiff | null; loading?: boolean }) {
  if (loading && !diff) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted">
        <Spinner size={12} /> Loading diff…
      </div>
    );
  }
  if (!diff) return null;
  if (diff.binary) {
    return <p className="px-3 py-3 text-[12px] italic text-faint">Binary file — no text diff.</p>;
  }
  if (diff.hunks.length === 0) {
    return <p className="px-3 py-3 text-[12px] italic text-faint">No changes to display.</p>;
  }

  return (
    <div className="overflow-x-auto font-mono text-[11px] leading-[1.5]">
      <table className="w-full border-collapse">
        <tbody>
          {diff.hunks.map((hunk, hi) => (
            <HunkRows key={hi} header={hunk.header} lines={hunk.lines} />
          ))}
        </tbody>
      </table>
      {diff.truncated && (
        <p className="px-3 py-2 text-[11px] italic text-faint">
          Diff truncated — file is very large.
        </p>
      )}
    </div>
  );
}

function HunkRows({ header, lines }: { header: string; lines: GitFileDiff['hunks'][number]['lines'] }) {
  return (
    <>
      <tr className="bg-surface-2 text-faint">
        <td className="select-none px-2 text-right" />
        <td className="select-none px-2 text-right" />
        <td className="truncate px-2 py-0.5" title={header}>
          {header}
        </td>
      </tr>
      {lines.map((line, i) => {
        if (line.kind === 'meta') {
          return (
            <tr key={i} className="text-faint">
              <td className="select-none px-2 text-right" />
              <td className="select-none px-2 text-right" />
              <td className="px-2 italic">{line.text}</td>
            </tr>
          );
        }
        const add = line.kind === 'add';
        const del = line.kind === 'del';
        return (
          <tr
            key={i}
            className={cn(
              add && 'bg-success/10',
              del && 'bg-danger/10',
            )}
          >
            <td className="w-10 select-none border-r border-line px-2 text-right text-faint">
              {line.oldLine ?? ''}
            </td>
            <td className="w-10 select-none border-r border-line px-2 text-right text-faint">
              {line.newLine ?? ''}
            </td>
            <td className="whitespace-pre px-2">
              <span className={cn('select-none', add && 'text-success', del && 'text-danger')}>
                {add ? '+' : del ? '-' : ' '}
              </span>
              <span className={cn(add && 'text-fg', del && 'text-fg', !add && !del && 'text-muted')}>
                {line.text}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
