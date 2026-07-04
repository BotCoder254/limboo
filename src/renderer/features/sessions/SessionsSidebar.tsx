/**
 * Left sidebar — Sessions (per the product's session-first philosophy).
 *
 * The header carries the full control set, all built from the shared
 * `IconButton`: New session, Search (toggles an inline filter), a View menu
 * (sort + show archived / trash + clear-done), and Collapse. The list groups
 * Pinned then Sessions, with optional Archived and Recently-deleted (trash)
 * sections. Rows come from the SessionManager-backed store; an empty state with
 * a primary action shows when there are none.
 */
import { useEffect, useRef, useState } from 'react';
import {
  MessagesSquare,
  Plus,
  Search,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Archive,
  Trash2,
  ArchiveRestore,
  CircleDot,
  Boxes,
  GitBranch,
  X,
} from 'lucide-react';
import type { Session, SessionSort } from '@shared/types';
import { EmptyState, IconButton } from '@/renderer/components/ui';
import { relativeTime } from '@/renderer/lib/format';
import { SessionRow } from './SessionRow';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';

function sortSessions(list: Session[], sort: SessionSort): Session[] {
  const arr = [...list];
  if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'created') arr.sort((a, b) => b.createdAt - a.createdAt);
  else arr.sort((a, b) => b.updatedAt - a.updatedAt);
  return arr;
}

export function SessionsSidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const trash = useSessionStore((s) => s.trash);
  const selectedId = useSessionStore((s) => s.selectedId);
  const filter = useSessionStore((s) => s.filter);
  const sort = useSessionStore((s) => s.sort);
  const showArchived = useSessionStore((s) => s.showArchived);
  const showTrash = useSessionStore((s) => s.showTrash);
  const groupByFolder = useSessionStore((s) => s.groupByFolder);
  const setFilter = useSessionStore((s) => s.setFilter);
  const createSession = useSessionStore((s) => s.createSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hasWorkspace = useWorkspaceStore((s) => s.activeId !== null);
  const setSessionsCollapsed = useLayoutStore((s) => s.setSessionsCollapsed);

  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const q = filter.trim().toLowerCase();
  const match = (s: Session) =>
    !q ||
    s.title.toLowerCase().includes(q) ||
    s.branch.toLowerCase().includes(q) ||
    (s.folder ?? '').toLowerCase().includes(q) ||
    s.tags.some((t) => t.toLowerCase().includes(q));

  const visible = sessions.filter(match);
  const live = visible.filter((s) => !s.archived);
  const pinned = sortSessions(live.filter((s) => s.pinned), sort);
  const unpinned = sortSessions(live.filter((s) => !s.pinned), sort);
  const archived = showArchived ? sortSessions(visible.filter((s) => s.archived), sort) : [];
  const trashed = showTrash ? trash.filter(match) : [];

  // Optional folder grouping: unpinned live sessions bucket under their folder
  // (alphabetical), with ungrouped sessions listed last under "Sessions".
  const folders = new Map<string, Session[]>();
  const ungrouped: Session[] = [];
  if (groupByFolder) {
    for (const s of unpinned) {
      if (s.folder) {
        const bucket = folders.get(s.folder) ?? [];
        bucket.push(s);
        folders.set(s.folder, bucket);
      } else {
        ungrouped.push(s);
      }
    }
  }
  const folderNames = [...folders.keys()].sort((a, b) => a.localeCompare(b));
  const hasFolders = groupByFolder && folderNames.length > 0;

  const renderRow = (session: Session) => (
    <SessionRow
      key={session.id}
      session={session}
      active={session.id === selectedId}
      onSelect={() => void selectSession(session.id)}
    />
  );

  const isEmpty = live.length === 0 && archived.length === 0 && trashed.length === 0;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-base">
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Search sessions"
            size="sm"
            active={searchOpen || q.length > 0}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search size={14} />
          </IconButton>
          <ViewMenu />
          <NewSessionMenu />
          <IconButton label="Collapse sidebar" size="sm" onClick={() => setSessionsCollapsed(true)}>
            <PanelLeftClose size={14} />
          </IconButton>
        </div>
      </div>

      {searchOpen && (
        <div className="shrink-0 px-2 pb-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2">
            <Search size={12} className="shrink-0 text-faint" />
            <input
              ref={searchRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  setSearchOpen(false);
                }
              }}
              placeholder="Filter by title or branch…"
              className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-fg outline-none placeholder:text-faint"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter('')}
                className="shrink-0 text-faint hover:text-fg"
                aria-label="Clear filter"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!hasWorkspace ? (
          <EmptyState
            compact
            icon={Boxes}
            title="No workspace open"
            description="Open a workspace to start creating sessions."
          />
        ) : isEmpty ? (
          q ? (
            <EmptyState compact icon={Search} title="No matches" description="Try a different search." />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No sessions yet"
              description="Every task happens inside a session. Create one to get started."
              action={
                <button
                  type="button"
                  onClick={() => void createSession()}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
                >
                  <Plus size={13} />
                  New session
                </button>
              }
            />
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <GroupLabel>Pinned</GroupLabel>
                {pinned.map(renderRow)}
              </>
            )}
            {hasFolders ? (
              <>
                {folderNames.map((name) => (
                  <div key={name}>
                    <GroupLabel>{name}</GroupLabel>
                    {sortSessions(folders.get(name) ?? [], sort).map(renderRow)}
                  </div>
                ))}
                {ungrouped.length > 0 && (
                  <>
                    <GroupLabel>Sessions</GroupLabel>
                    {ungrouped.map(renderRow)}
                  </>
                )}
              </>
            ) : (
              unpinned.length > 0 && (
                <>
                  {pinned.length > 0 && <GroupLabel>Sessions</GroupLabel>}
                  {unpinned.map(renderRow)}
                </>
              )
            )}

            {archived.length > 0 && (
              <>
                <GroupLabel>Archived</GroupLabel>
                {archived.map(renderRow)}
              </>
            )}

            {trashed.length > 0 && (
              <>
                <GroupLabel>Recently deleted</GroupLabel>
                {trashed.map((s) => (
                  <TrashRow key={s.id} session={s} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}

/** A trashed session: read-only meta with Restore / Delete-permanently actions. */
function TrashRow({ session }: { session: Session }) {
  const restore = useSessionStore((s) => s.restore);
  const purge = useSessionStore((s) => s.purge);
  return (
    <div className="group flex items-center gap-2.5 px-3 py-2">
      <Trash2 size={13} className="shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-muted line-through">{session.title}</span>
        <span className="text-[11px] text-faint">deleted {relativeTime(session.deletedAt ?? 0)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Restore session" size="sm" onClick={() => void restore(session.id)}>
          <ArchiveRestore size={13} />
        </IconButton>
        <IconButton label="Delete permanently" size="sm" onClick={() => void purge(session.id)}>
          <Trash2 size={13} className="text-danger" />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * New-session split action: a plain click creates a regular session; when
 * worktrees are enabled (Settings › Git) the button opens a small menu offering
 * "New session" and "New session in worktree" — the latter provisions an
 * isolated checkout + branch for the session before it opens.
 */
function NewSessionMenu() {
  const createSession = useSessionStore((s) => s.createSession);
  const createSessionInWorktree = useSessionStore((s) => s.createSessionInWorktree);
  const worktreesEnabled = useSettingsStore((s) => s.settings.git.worktrees.enabled);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!worktreesEnabled) {
    return (
      <IconButton label="New session" size="sm" onClick={() => void createSession()}>
        <Plus size={15} />
      </IconButton>
    );
  }

  return (
    <div ref={ref} className="relative">
      <IconButton label="New session" size="sm" active={open} onClick={() => setOpen((v) => !v)}>
        <Plus size={15} />
      </IconButton>
      {open && (
        <div className="animate-pop-in absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void createSession();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Plus size={13} className="shrink-0" />
            New session
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void createSessionInWorktree();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <GitBranch size={13} className="shrink-0 text-accent" />
            <span className="flex-1">New session in worktree</span>
          </button>
          <p className="px-2 pb-1 pt-0.5 text-[10px] leading-snug text-faint">
            Isolated checkout + branch — run parallel tasks without conflicts.
          </p>
        </div>
      )}
    </div>
  );
}

/** Sort + view-options dropdown (reuses the WorkspaceSwitcher menu styling). */
function ViewMenu() {
  const sort = useSessionStore((s) => s.sort);
  const setSort = useSessionStore((s) => s.setSort);
  const showArchived = useSessionStore((s) => s.showArchived);
  const showTrash = useSessionStore((s) => s.showTrash);
  const groupByFolder = useSessionStore((s) => s.groupByFolder);
  const toggleArchived = useSessionStore((s) => s.toggleArchived);
  const toggleTrash = useSessionStore((s) => s.toggleTrash);
  const toggleGroupByFolder = useSessionStore((s) => s.toggleGroupByFolder);
  const archiveDone = useSessionStore((s) => s.archiveDone);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const SORTS: { id: SessionSort; label: string }[] = [
    { id: 'recent', label: 'Recent activity' },
    { id: 'created', label: 'Date created' },
    { id: 'title', label: 'Title' },
  ];

  return (
    <div ref={ref} className="relative">
      <IconButton label="View options" size="sm" active={open} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} />
      </IconButton>
      {open && (
        <div className="animate-pop-in absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
            Sort by
          </div>
          {SORTS.map((s) => (
            <MenuRow key={s.id} label={s.label} checked={sort === s.id} onClick={() => setSort(s.id)} />
          ))}
          <div className="my-1 border-t border-line" />
          <MenuRow
            label="Show archived"
            icon={Archive}
            checked={showArchived}
            onClick={toggleArchived}
          />
          <MenuRow label="Show trash" icon={Trash2} checked={showTrash} onClick={toggleTrash} />
          <MenuRow
            label="Group by folder"
            icon={Boxes}
            checked={groupByFolder}
            onClick={toggleGroupByFolder}
          />
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void archiveDone();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <CircleDot size={13} className="shrink-0 text-faint" />
            Archive completed
          </button>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  checked,
  onClick,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  icon?: typeof Archive;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {Icon ? <Icon size={13} className="shrink-0" /> : <span className="w-[13px]" />}
      <span className="flex-1">{label}</span>
      {checked && <Check size={13} className="shrink-0 text-accent" />}
    </button>
  );
}

/**
 * The thin rail shown when the sessions sidebar is collapsed: expand + quick
 * new-session affordances, keeping the session-first workflow one click away.
 */
export function CollapsedSessionsRail() {
  const createSession = useSessionStore((s) => s.createSession);
  const setSessionsCollapsed = useLayoutStore((s) => s.setSessionsCollapsed);
  return (
    <div className="flex h-full w-9 flex-col items-center gap-1 bg-base py-2">
      <IconButton label="Expand sidebar" size="sm" onClick={() => setSessionsCollapsed(false)}>
        <PanelLeftOpen size={14} />
      </IconButton>
      <IconButton label="New session" size="sm" onClick={() => void createSession()}>
        <Plus size={15} />
      </IconButton>
    </div>
  );
}
