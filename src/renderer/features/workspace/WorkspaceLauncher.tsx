/**
 * Recent-Workspaces launcher body. Rich cards (project icon, name, path,
 * language/framework badges, git branch, last-opened time, live statistics,
 * favorite pin, rescan) with search and favorites-first sort. Workspaces are
 * added via the native directory picker OR by dropping a folder onto the drop
 * zone (which doubles as the modern empty state).
 *
 * Rendered full-screen by `WorkspaceSelection` when no workspace is active, so
 * it owns the project-launcher experience that gates the rest of the shell.
 */
import { useEffect, useMemo, useState } from 'react';
import { FileText, FolderInput, GitBranch, GitCommitHorizontal, HardDrive, Pin, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { Workspace } from '@shared/types';
import { Badge, EmptyState, IconButton } from '@/renderer/components/ui';
import { formatBytes, formatCount, relativeTime } from '@/renderer/lib/format';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { WorkspaceIconBadge } from './WorkspaceIconBadge';
import { WorkspaceActions } from './WorkspaceDropZone';
import { WorkspaceRemoveDialog } from './WorkspaceRemoveDialog';

export function WorkspaceLauncher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [query, setQuery] = useState('');
  // Workspace pending safe-delete confirmation (null = dialog closed).
  const [pendingRemove, setPendingRemove] = useState<Workspace | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? workspaces.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.path.toLowerCase().includes(q) ||
            w.metadata.languages.some((l) => l.toLowerCase().includes(q)),
        )
      : workspaces;
    return [...list].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.lastOpenedAt - a.lastOpenedAt;
    });
  }, [workspaces, query]);

  // Empty state: a centered hero with large Open / Create actions. Dropping a
  // folder anywhere on the window works too (handled by the drag overlay).
  if (workspaces.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-7 py-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <FolderInput size={40} className="text-faint" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-fg">Open a project to begin</h1>
            <p className="max-w-md text-[13px] leading-relaxed text-muted">
              Every session lives inside a workspace. Open an existing folder, create a
              new one, or drop a folder anywhere on this window.
            </p>
          </div>
        </div>
        <WorkspaceActions size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 py-8">
      {/* Heading + primary actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold tracking-tight text-fg">Workspaces</h1>
          <p className="text-[12px] text-muted">
            Open a project folder to begin. Every session lives inside a workspace.
          </p>
        </div>
        <WorkspaceActions />
      </div>

      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5">
        <Search size={14} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter workspaces…"
          className="flex-1 bg-transparent py-2 text-[12px] text-fg placeholder:text-faint focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {filtered.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title="No matches"
            description="No workspaces match your filter."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((ws) => (
              <WorkspaceCard key={ws.id} ws={ws} onRequestRemove={() => setPendingRemove(ws)} />
            ))}
          </ul>
        )}
      </div>

      {pendingRemove && (
        <WorkspaceRemoveDialog workspace={pendingRemove} onClose={() => setPendingRemove(null)} />
      )}
    </div>
  );
}

/** One workspace row. Lazily loads + shows project statistics on mount. */
function WorkspaceCard({ ws, onRequestRemove }: { ws: Workspace; onRequestRemove: () => void }) {
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const toggleFavorite = useWorkspaceStore((s) => s.toggleFavorite);
  const rescan = useWorkspaceStore((s) => s.rescan);
  const loadStats = useWorkspaceStore((s) => s.loadStats);
  const stats = useWorkspaceStore((s) => s.statsById[ws.id]);

  // Fetch stats once when the card appears (the store memoizes per id).
  useEffect(() => {
    void loadStats(ws.id);
  }, [ws.id, loadStats]);

  return (
    <li>
      <div className="group flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-line-strong">
        <button
          type="button"
          onClick={() => switchTo(ws.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <WorkspaceIconBadge icon={ws.icon} size={36} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-fg">{ws.name}</span>
              {ws.metadata.languages.slice(0, 2).map((lang) => (
                <Badge key={lang} tone="neutral">
                  {lang}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
              <span className="truncate">{ws.path}</span>
              {ws.metadata.hasGit && ws.metadata.branch && (
                <span className="flex shrink-0 items-center gap-1">
                  <GitBranch size={10} />
                  {ws.metadata.branch}
                </span>
              )}
              <span className="shrink-0">· {relativeTime(ws.lastOpenedAt)}</span>
              {stats && (
                <span className="flex shrink-0 items-center gap-2 font-mono text-faint">
                  <span className="text-line-strong">·</span>
                  <span className="flex items-center gap-1" title="Files">
                    <FileText size={10} />
                    {formatCount(stats.fileCount)}
                  </span>
                  <span className="flex items-center gap-1" title="Size on disk">
                    <HardDrive size={10} />
                    {formatBytes(stats.sizeBytes)}
                  </span>
                  {stats.commitCount != null && (
                    <span className="flex items-center gap-1" title="Commits">
                      <GitCommitHorizontal size={10} />
                      {formatCount(stats.commitCount)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            size="sm"
            label="Rescan workspace"
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => rescan(ws.id)}
          >
            <RefreshCw size={13} />
          </IconButton>
          <IconButton
            size="sm"
            label={ws.favorite ? 'Unpin' : 'Pin to top'}
            active={ws.favorite}
            onClick={() => toggleFavorite(ws.id)}
          >
            <Pin size={13} className={ws.favorite ? 'fill-current' : undefined} />
          </IconButton>
          <IconButton
            size="sm"
            label="Remove from list"
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={onRequestRemove}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}
