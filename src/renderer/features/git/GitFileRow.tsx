/**
 * One changed-file row used across the Git workspace and the Changes panel:
 * a chevron + status pill + path + diff counts, with hover actions (stage /
 * unstage / discard) and an inline, lazily-loaded {@link DiffView} on expand.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import type { GitFileChange } from '@shared/types';
import { DiffStat, IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { DiffView } from './DiffView';

const STATUS_META: Record<GitFileChange['status'], { label: string; cls: string }> = {
  added: { label: 'A', cls: 'text-success' },
  modified: { label: 'M', cls: 'text-warning' },
  deleted: { label: 'D', cls: 'text-danger' },
  renamed: { label: 'R', cls: 'text-accent' },
  untracked: { label: 'U', cls: 'text-success' },
  conflicted: { label: 'C', cls: 'text-danger' },
};

export function GitFileRow({
  change,
  staged,
  expanded,
  onToggle,
}: {
  change: GitFileChange;
  /** Which side this row represents (drives the diff + the action shown). */
  staged: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const diffKey = `${staged ? 's' : 'w'}:${change.path}`;
  const diff = useGitStore((s) => s.diffs[diffKey]);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const discard = useGitStore((s) => s.discard);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (expanded && !diff) {
      setLoading(true);
      void loadDiff(change.path, staged).finally(() => setLoading(false));
    }
  }, [expanded, diff, change.path, staged, loadDiff]);

  const meta = STATUS_META[change.status];
  const segments = change.path.split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? change.path;
  const dir = segments.slice(0, -1).join('/');

  return (
    <li className="rounded-md">
      <div className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown size={13} className="shrink-0 text-faint" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-faint" />
          )}
          <span
            className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', meta.cls)}
            title={change.status}
          >
            {meta.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={change.path}>
            {name}
            {dir && <span className="ml-1 text-faint">{dir}</span>}
          </span>
        </button>
        <DiffStat adds={change.adds} dels={change.dels} className="shrink-0" />
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          {staged ? (
            <IconButton label="Unstage" size="sm" onClick={() => void unstage(change.path)}>
              <Minus size={13} />
            </IconButton>
          ) : (
            <>
              {change.status !== 'untracked' && (
                <IconButton
                  label="Discard changes"
                  size="sm"
                  onClick={() => void discard(change.path)}
                >
                  <RotateCcw size={13} />
                </IconButton>
              )}
              <IconButton label="Stage" size="sm" onClick={() => void stage(change.path)}>
                <Plus size={13} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {expanded && (
        <div className="ml-4 mt-1 overflow-hidden rounded-md border border-line bg-base">
          <DiffView diff={diff} loading={loading} />
        </div>
      )}
    </li>
  );
}
