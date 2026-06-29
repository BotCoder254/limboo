/**
 * Commit history as a navigable timeline. Each commit shows its message, author,
 * relative time, and ref decorations; expanding one reveals the files it touched.
 * Tags appear as milestone markers.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitCommit as GitCommitIcon, Tag } from 'lucide-react';
import type { GitCommit, GitCommitDetail } from '@shared/types';
import { EmptyState } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { relativeTime } from '@/renderer/lib/format';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';

export function GitHistory() {
  const log = useGitStore((s) => s.log);
  const loadHistory = useGitStore((s) => s.loadHistory);
  const loadTags = useGitStore((s) => s.loadTags);

  useEffect(() => {
    void loadHistory();
    void loadTags();
  }, [loadHistory, loadTags]);

  if (log.length === 0) {
    return (
      <EmptyState
        compact
        icon={GitCommitIcon}
        title="No commits yet"
        description="Commits made in this repository appear here as a timeline you can inspect."
      />
    );
  }

  return (
    <ul className="flex flex-col">
      {log.map((commit) => (
        <CommitRow key={commit.hash} commit={commit} />
      ))}
    </ul>
  );
}

function CommitRow({ commit }: { commit: GitCommit }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const wsId = useWorkspaceStore((s) => s.activeId);

  useEffect(() => {
    if (expanded && !detail && wsId) {
      void window.limboo?.git.commitDetail(wsId, commit.hash).then(setDetail);
    }
  }, [expanded, detail, wsId, commit.hash]);

  return (
    <li className="border-b border-line/60 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-1.5 py-2 text-left hover:bg-surface-2"
      >
        {expanded ? (
          <ChevronDown size={13} className="mt-0.5 shrink-0 text-faint" />
        ) : (
          <ChevronRight size={13} className="mt-0.5 shrink-0 text-faint" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{commit.subject}</span>
            <span className="shrink-0 font-mono text-[10px] text-faint">{commit.shortHash}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">{commit.author}</span>
            <span className="text-[10px] text-faint">{relativeTime(commit.at)}</span>
            {commit.refs.map((ref) => (
              <span
                key={ref}
                className={cn(
                  'flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-medium',
                  ref.startsWith('tag:')
                    ? 'bg-warning/15 text-warning'
                    : 'bg-accent/15 text-accent',
                )}
              >
                {ref.startsWith('tag:') && <Tag size={9} />}
                {ref.replace(/^tag: /, '')}
              </span>
            ))}
          </div>
        </div>
      </button>
      {expanded && detail && (
        <ul className="mb-2 ml-5 flex flex-col gap-0.5">
          {detail.commit.body && (
            <li className="whitespace-pre-wrap px-1.5 pb-1 text-[11px] text-muted">
              {detail.commit.body}
            </li>
          )}
          {detail.files.map((f) => (
            <li key={f.path} className="flex items-center gap-1.5 px-1.5 text-[11px]">
              <span className="w-3 text-center font-mono text-faint">{f.status[0].toUpperCase()}</span>
              <span className="truncate text-muted" title={f.path}>
                {f.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
