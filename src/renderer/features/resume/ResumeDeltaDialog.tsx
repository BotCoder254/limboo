/**
 * Repository-delta detail dialog — the structured view behind the resume
 * banner's Review action: branch/HEAD movement, the capped commit list,
 * changed files grouped by category, and specially-flagged manifest/migration
 * changes. Read-only; the one-shot prompt injection is handled by the agent
 * layer. Matches the app modal idiom (HooksConfirmDialog).
 */
import { useEffect } from 'react';
import { GitCommit as GitCommitIcon, RefreshCw, X } from 'lucide-react';
import type { RepoDelta, RepoDeltaFile } from '@shared/types';
import { useResumeStore } from '@/renderer/stores/useResumeStore';

const CATEGORY_LABEL: Record<RepoDeltaFile['category'], string> = {
  manifest: 'Dependency manifests',
  migration: 'Migrations',
  config: 'Configuration',
  source: 'Source',
  doc: 'Docs',
  other: 'Other',
};

const CATEGORY_ORDER: RepoDeltaFile['category'][] = [
  'manifest',
  'migration',
  'config',
  'source',
  'doc',
  'other',
];

export function ResumeDeltaDialog() {
  const delta = useResumeStore((s) => s.delta);
  const open = useResumeStore((s) => s.detailOpen);
  const close = useResumeStore((s) => s.closeDetail);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open || !delta) return null;

  const byCategory = new Map<RepoDeltaFile['category'], RepoDeltaFile[]>();
  for (const file of delta.files) {
    const bucket = byCategory.get(file.category) ?? [];
    bucket.push(file);
    byCategory.set(file.category, bucket);
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={close}
    >
      <div
        className="animate-pop-in flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <RefreshCw size={14} className="text-accent" />
            Repository changed since last visit
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <Movement delta={delta} />

          {delta.commits.length > 0 && (
            <section className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                Commits ({delta.commits.length} of {delta.commitsAhead})
              </span>
              <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                {delta.commits.map((c) => (
                  <div key={c.hash} className="flex items-start gap-2 text-[12px]">
                    <GitCommitIcon size={12} className="mt-0.5 shrink-0 text-faint" />
                    <code className="shrink-0 font-mono text-[11px] text-faint">
                      {c.hash.slice(0, 8)}
                    </code>
                    <span className="min-w-0 flex-1 break-words text-fg">{c.subject}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {CATEGORY_ORDER.map((category) => {
            const files = byCategory.get(category);
            if (!files || files.length === 0) return null;
            const highlight = category === 'manifest' || category === 'migration';
            return (
              <section key={category} className="flex flex-col gap-1">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    highlight ? 'text-warning' : 'text-faint'
                  }`}
                >
                  {CATEGORY_LABEL[category]} ({files.length})
                </span>
                <div className="flex flex-col gap-0.5 rounded-md border border-line bg-surface-2 px-3 py-2">
                  {files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-[12px]">
                      <span className="w-14 shrink-0 text-[10px] uppercase text-faint">
                        {f.status}
                      </span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
                        {f.path}
                      </code>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {delta.filesTotal > delta.files.length && (
            <p className="text-[11px] text-faint">
              … and {delta.filesTotal - delta.files.length} more files.
            </p>
          )}

          {delta.symbols && delta.symbols.length > 0 && (
            <section className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                Symbol changes
              </span>
              <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                {delta.symbols.map((s) => (
                  <div key={s.path} className="flex flex-col gap-0.5 text-[12px]">
                    <code className="truncate font-mono text-[11px] text-muted">{s.path}</code>
                    <span className="text-[11px]">
                      {s.added.map((n) => (
                        <span key={`a-${n}`} className="mr-2 text-success">
                          +{n}
                        </span>
                      ))}
                      {s.removed.map((n) => (
                        <span key={`r-${n}`} className="mr-2 text-danger">
                          -{n}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <p className="mr-auto text-[11px] leading-relaxed text-faint">
            The agent receives this delta with its next prompt.
          </p>
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Branch / HEAD movement summary lines. */
function Movement({ delta }: { delta: RepoDelta }) {
  const rows: string[] = [];
  if (delta.rootChanged) rows.push('The session execution root changed (worktree recreated or detached).');
  if (delta.historyRewritten) rows.push('History was rewritten (rebase or amend) — prior commit hashes may be gone.');
  if (delta.branchChanged) {
    rows.push(`Branch: ${delta.fromBranch ?? 'detached'} → ${delta.toBranch ?? 'detached'}`);
  }
  if (delta.headMoved && delta.fromHead && delta.toHead) {
    rows.push(
      `HEAD: ${delta.fromHead.slice(0, 8)} → ${delta.toHead.slice(0, 8)} (${delta.commitsAhead} ahead, ${delta.commitsBehind} behind)`,
    );
  }
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-[12px] leading-relaxed text-muted">
      {rows.map((row) => (
        <p key={row}>{row}</p>
      ))}
    </div>
  );
}
