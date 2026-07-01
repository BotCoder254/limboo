/**
 * Global Search — the universal entry point into the whole workspace, opened from
 * the title-bar search box or Cmd/Ctrl+P. A centered, keyboard-navigable overlay
 * (modeled on the command palette) that searches every source the app knows about:
 * files, symbols, documentation, memories, git history, sessions — plus the
 * client-side command registry — behind one ranked, grouped interface. Source-kind
 * filter chips, recent searches, and saved searches live here too (this modal is now
 * the single Search surface; there is no right-rail Search tab). Each result names
 * its originating subsystem.
 *
 * Presentational only: backend retrieval lives in the main-process SearchManager
 * (via `useSearchStore`); commands come from the local registry.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Braces,
  Brain,
  Clock,
  CornerDownLeft,
  FileText,
  FileCode2,
  GitBranch,
  GitCommit,
  MessagesSquare,
  Search,
  Tag,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SearchHit, SearchKind } from '@shared/types';
import { IconButton, Kbd, Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useSearchStore } from '@/renderer/stores/useSearchStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useTypewriter } from '@/renderer/hooks/useTypewriter';
import { paletteCommands, type Command } from '@/renderer/lib/commands';

/** Rotating example queries for the animated placeholder (shared with the title bar). */
export const SEARCH_PLACEHOLDERS = [
  'Search files…',
  'Find a symbol…',
  'Recall a memory…',
  'Jump to a commit…',
  'Open a past session…',
];

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  file: FileCode2,
  symbol: Braces,
  doc: FileText,
  memory: Brain,
  commit: GitCommit,
  branch: GitBranch,
  tag: Tag,
  session: MessagesSquare,
  command: CornerDownLeft,
  setting: Search,
  saved: Bookmark,
  terminal: TerminalSquare,
  diagnostic: Search,
};

/** Source-kind filter chips (mirrors the backend group order). */
const KINDS: { id: SearchKind; label: string }[] = [
  { id: 'file', label: 'Files' },
  { id: 'symbol', label: 'Symbols' },
  { id: 'doc', label: 'Docs' },
  { id: 'memory', label: 'Memory' },
  { id: 'commit', label: 'Commits' },
  { id: 'branch', label: 'Branches' },
  { id: 'session', label: 'Sessions' },
];

/** Real-time as-you-type debounce, in ms, keyed by the settings preset. */
const DELAY_MS: Record<'instant' | 'fast' | 'balanced', number> = {
  instant: 0,
  fast: 90,
  balanced: 200,
};

/** A flattened, selectable row: either a search hit or a client-side command. */
type Row =
  | { type: 'hit'; hit: SearchHit; groupLabel: string }
  | { type: 'command'; command: Command };

export function GlobalSearch() {
  const open = useUIStore((s) => s.searchOpen);
  const close = useUIStore((s) => s.closeSearch);
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const run = useSearchStore((s) => s.run);
  const groups = useSearchStore((s) => s.groups);
  const loading = useSearchStore((s) => s.loading);
  const progress = useSearchStore((s) => s.progress);
  const kindFilter = useSearchStore((s) => s.kindFilter);
  const setKindFilter = useSearchStore((s) => s.setKindFilter);
  const history = useSearchStore((s) => s.history);
  const saved = useSearchStore((s) => s.saved);
  const save = useSearchStore((s) => s.save);
  const removeSaved = useSearchStore((s) => s.removeSaved);
  const clearHistory = useSearchStore((s) => s.clearHistory);
  const refresh = useSearchStore((s) => s.refresh);
  const liveDelay = useSettingsStore((s) => s.settings.search.liveDelay);

  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Animate the placeholder only while the field is empty; freeze once typing.
  const typedPlaceholder = useTypewriter(SEARCH_PLACEHOLDERS, { paused: query.length > 0 });

  // Reset + focus + pull fresh recent/saved lists on open.
  useEffect(() => {
    if (open) {
      setIndex(0);
      void refresh();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, refresh]);

  // Debounced backend search as the user types (and when the filter flips). The
  // delay follows the user's live-search preference.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void run(query), DELAY_MS[liveDelay] ?? 90);
    return () => clearTimeout(t);
  }, [query, kindFilter, run, open, liveDelay]);

  // Client-side command matches, merged in as their own group.
  const commandMatches = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return paletteCommands()
      .filter((c) => c.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query]);

  // Flatten groups (in backend order) then commands into a single navigable list.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of groups) {
      for (const hit of g.hits) out.push({ type: 'hit', hit, groupLabel: g.label });
    }
    for (const command of commandMatches) out.push({ type: 'command', command });
    return out;
  }, [groups, commandMatches]);

  useEffect(() => {
    if (index > rows.length - 1) setIndex(Math.max(0, rows.length - 1));
  }, [rows, index]);

  if (!open) return null;

  const searching = query.trim().length > 0;

  const select = (row: Row) => {
    if (row.type === 'command') {
      row.command.run();
    } else {
      openHit(row.hit);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[index];
      if (row) select(row);
    }
  };

  // Group boundaries: remember the label of the previous row so we can render a
  // heading only when the group changes.
  let lastLabel = '';

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="animate-pop-in flex w-full max-w-2xl flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={typedPlaceholder}
            className="flex-1 bg-transparent py-3 text-[13px] text-fg placeholder:text-faint focus:outline-none"
          />
          {(loading || progress) && <Spinner size={11} />}
          {progress && <span className="text-[10px] text-faint">indexing {progress.percent}%</span>}
          {searching && (
            <IconButton label="Save this search" size="sm" onClick={() => void promptSave(save)}>
              <BookmarkPlus size={14} />
            </IconButton>
          )}
          <Kbd keys={['Esc']} />
        </div>

        {/* Source-kind filter chips — narrow results without leaving the modal. */}
        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKindFilter(kindFilter === k.id ? null : k.id)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] transition-colors',
                kindFilter === k.id
                  ? 'bg-accent/15 text-accent'
                  : 'bg-surface-2 text-muted hover:text-fg',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="max-h-96 overflow-y-auto p-1.5">
          {searching ? (
            rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-faint">No matches</div>
            ) : (
              rows.map((row, i) => {
                const label = row.type === 'hit' ? row.groupLabel : 'Commands';
                const heading = label !== lastLabel ? label : null;
                lastLabel = label;
                return (
                  <div key={rowKey(row, i)}>
                    {heading && (
                      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {heading}
                      </div>
                    )}
                    <RowButton
                      row={row}
                      active={i === index}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => select(row)}
                    />
                  </div>
                );
              })
            )
          ) : (
            <EmptyBody
              saved={saved}
              history={history}
              onPick={setQuery}
              onRemoveSaved={(id) => void removeSaved(id)}
              onClearHistory={() => void clearHistory()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Recent + saved searches, shown while the query is empty. */
function EmptyBody({
  saved,
  history,
  onPick,
  onRemoveSaved,
  onClearHistory,
}: {
  saved: { id: string; name: string; query: string }[];
  history: { query: string; at: number }[];
  onPick: (q: string) => void;
  onRemoveSaved: (id: string) => void;
  onClearHistory: () => void;
}) {
  if (saved.length === 0 && history.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-faint">
        Type to search the whole workspace
      </div>
    );
  }
  return (
    <>
      {saved.length > 0 && (
        <div className="mb-1">
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
            <Bookmark size={11} className="text-accent" /> Saved
          </div>
          {saved.map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-2"
            >
              <button
                type="button"
                onClick={() => onPick(s.query)}
                className="min-w-0 flex-1 truncate text-left text-[13px] text-fg"
                title={s.query}
              >
                {s.name}
              </button>
              <IconButton label="Delete saved search" size="sm" onClick={() => onRemoveSaved(s.id)}>
                <Trash2 size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
            <Clock size={11} /> Recent
            <button
              type="button"
              onClick={onClearHistory}
              className="ml-auto normal-case tracking-normal text-faint hover:text-fg"
            >
              Clear
            </button>
          </div>
          {history.map((h) => (
            <button
              key={`${h.query}:${h.at}`}
              type="button"
              onClick={() => onPick(h.query)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <Clock size={13} className="shrink-0 text-faint" />
              <span className="truncate">{h.query}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function RowButton({
  row,
  active,
  onMouseEnter,
  onClick,
}: {
  row: Row;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const Icon = row.type === 'command' ? CornerDownLeft : KIND_ICON[row.hit.kind] ?? Search;
  const title = row.type === 'command' ? row.command.title : row.hit.title;
  const subtitle = row.type === 'command' ? row.command.section : row.hit.subtitle;
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
        active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon size={14} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {subtitle && (
        <span className="ml-2 max-w-[45%] shrink-0 truncate text-[11px] text-faint" title={subtitle}>
          {subtitle}
        </span>
      )}
      {active && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
    </button>
  );
}

function rowKey(row: Row, i: number): string {
  return row.type === 'command' ? `cmd:${row.command.id}` : `${row.hit.id}:${i}`;
}

/** Prompt for a saved-search name (window.prompt is fine for this local app). */
async function promptSave(save: (name: string) => Promise<void>): Promise<void> {
  const name = window.prompt('Name this search');
  if (name && name.trim()) await save(name.trim());
}

/** Navigate to a hit: files reveal in the OS explorer; the rest open their tab. */
export function openHit(hit: SearchHit): void {
  const layout = useLayoutStore.getState();
  switch (hit.kind) {
    case 'file':
    case 'doc':
    case 'symbol': {
      const wsId = useWorkspaceStore.getState().activeId;
      layout.setActiveTab('files');
      if (wsId && hit.path) void window.limboo?.fs?.reveal(wsId, hit.path);
      break;
    }
    case 'memory':
      layout.setActiveTab('memory');
      break;
    case 'commit':
    case 'branch':
    case 'tag':
      layout.setActiveTab('git');
      break;
    case 'session':
      void useSessionStore.getState().selectSession(hit.ref);
      break;
    default:
      // settings / diagnostics / other kinds have no dedicated destination — the
      // modal simply closes (handled by the caller).
      break;
  }
}
