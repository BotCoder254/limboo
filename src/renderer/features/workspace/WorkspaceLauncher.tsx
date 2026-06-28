/**
 * Recent-Workspaces launcher, shown in the center column when no workspace is
 * active. Rich cards (project icon, name, path, language/framework badges, git
 * branch, last-opened time, favorite pin, rescan) with search and favorites-first
 * sort. Workspaces are added via the native directory picker OR by dropping a
 * folder onto the drop zone (which doubles as the modern empty state).
 */
import { useMemo, useState } from 'react';
import { GitBranch, Pin, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Badge, EmptyState, IconButton } from '@/renderer/components/ui';
import { relativeTime } from '@/renderer/lib/format';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { WorkspaceIconBadge } from './WorkspaceIconBadge';
import { WorkspaceDropZone } from './WorkspaceDropZone';

export function WorkspaceLauncher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const switchTo = useWorkspaceStore((s) => s.switchTo);
  const toggleFavorite = useWorkspaceStore((s) => s.toggleFavorite);
  const remove = useWorkspaceStore((s) => s.remove);
  const rescan = useWorkspaceStore((s) => s.rescan);

  const [query, setQuery] = useState('');

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

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 py-8">
      {/* Heading */}
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-tight text-fg">Workspaces</h1>
        <p className="text-[12px] text-muted">
          Open a project folder to begin. Every session lives inside a workspace.
        </p>
      </div>

      {workspaces.length === 0 ? (
        // Modern empty state: the drop zone IS the primary affordance.
        <WorkspaceDropZone />
      ) : (
        <>
          {/* Always-visible compact drop zone + actions above the list. */}
          <WorkspaceDropZone compact />

          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5">
            <Search size={14} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter workspaces…"
              className="flex-1 bg-transparent py-2 text-[12px] text-fg placeholder:text-faint focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
                  <li key={ws.id}>
                    <div className="group flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:border-line-strong">
                      <button
                        type="button"
                        onClick={() => switchTo(ws.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <WorkspaceIconBadge icon={ws.icon} size={36} />
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-fg">
                              {ws.name}
                            </span>
                            {ws.metadata.languages.slice(0, 2).map((lang) => (
                              <Badge key={lang} tone="neutral">
                                {lang}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-faint">
                            <span className="truncate">{ws.path}</span>
                            {ws.metadata.hasGit && ws.metadata.branch && (
                              <span className="flex shrink-0 items-center gap-1">
                                <GitBranch size={10} />
                                {ws.metadata.branch}
                              </span>
                            )}
                            <span className="shrink-0">· {relativeTime(ws.lastOpenedAt)}</span>
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
                          onClick={() => remove(ws.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
