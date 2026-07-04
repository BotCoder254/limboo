/**
 * The Memory workspace — a full-height right-drawer tab (mirrors Git/Terminal).
 * Surfaces the Local Memory System: a semantic-ish search over project knowledge,
 * tier filters, the live memory list, pending auto-capture proposals to accept or
 * dismiss, and an inline composer for manually-authored notes. Presentational
 * only — all logic lives in the main-process MemoryManager, reached via the store.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Brain,
  Check,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Memory, MemoryHit, MemoryTier } from '@shared/types';
import { EmptyState, IconButton, Spinner } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useMemoryStore } from '@/renderer/stores/useMemoryStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';

const TIERS: { id: MemoryTier; label: string }[] = [
  { id: 'decision', label: 'Decisions' },
  { id: 'convention', label: 'Conventions' },
  { id: 'preference', label: 'Preferences' },
  { id: 'solution', label: 'Solutions' },
  { id: 'project', label: 'Project' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'note', label: 'Notes' },
];

const TIER_LABEL: Record<MemoryTier, string> = {
  session: 'Session',
  workspace: 'Workspace',
  project: 'Project',
  preference: 'Preference',
  convention: 'Convention',
  decision: 'Decision',
  solution: 'Solution',
  note: 'Note',
};

export function MemoryPanel() {
  const memories = useMemoryStore((s) => s.memories);
  const proposals = useMemoryStore((s) => s.proposals);
  const results = useMemoryStore((s) => s.results);
  const query = useMemoryStore((s) => s.query);
  const tierFilter = useMemoryStore((s) => s.tierFilter);
  const loading = useMemoryStore((s) => s.loading);
  const setQuery = useMemoryStore((s) => s.setQuery);
  const setTierFilter = useMemoryStore((s) => s.setTierFilter);
  const search = useMemoryStore((s) => s.search);
  const refresh = useMemoryStore((s) => s.refresh);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const hasWorkspace = useWorkspaceStore((s) => !!s.activeId);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Debounced search as the user types.
  useEffect(() => {
    const t = setTimeout(() => void search(query), 180);
    return () => clearTimeout(t);
  }, [query, search]);

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    const base: (Memory | MemoryHit)[] = searching ? results : memories;
    return tierFilter ? base.filter((m) => m.tier === tierFilter) : base;
  }, [searching, results, memories, tierFilter]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1.5">
        <Brain size={13} className="shrink-0 text-muted" />
        <span className="text-[12px] font-medium text-fg">Memory</span>
        {loading && <Spinner size={11} />}
        <div className="ml-auto flex items-center">
          <IconButton label="Add note" size="sm" onClick={() => setComposing((v) => !v)}>
            <Plus size={14} />
          </IconButton>
          <IconButton label="Close memory" size="sm" onClick={() => setActiveTab(null)}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2">
          <Search size={12} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions, conventions, solutions…"
            className="h-7 w-full bg-transparent text-[12px] text-fg placeholder:text-faint focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-faint hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTierFilter(tierFilter === t.id ? null : t.id)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] transition-colors',
                tierFilter === t.id
                  ? 'bg-accent/15 text-accent'
                  : 'bg-surface-2 text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {composing && (
          <ComposeNote global={!hasWorkspace} onClose={() => setComposing(false)} />
        )}

        {proposals.length > 0 && !searching && <Proposals proposals={proposals} />}

        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={Brain}
            title={searching ? 'No matching memories' : 'No memories yet'}
            description={
              searching
                ? 'Try a different search, or clear the filter.'
                : 'Project knowledge — decisions, conventions, and reusable solutions — collects here. Add a note, or accept proposals as you work.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {visible.map((m) => (
              <MemoryRow key={m.id} memory={m} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Proposals */

function Proposals({ proposals }: { proposals: Memory[] }) {
  const accept = useMemoryStore((s) => s.acceptProposal);
  const reject = useMemoryStore((s) => s.rejectProposal);
  return (
    <div className="mb-2 rounded-md border border-line bg-surface-2/50 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-fg">
        <Sparkles size={12} className="text-accent" />
        Suggested memories ({proposals.length})
      </div>
      <ul className="flex flex-col gap-1">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-md bg-surface px-2 py-1.5">
            <div className="flex items-start gap-1.5">
              <TierBadge tier={p.tier} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-fg" title={p.title}>
                  {p.title}
                </p>
                {p.body && <p className="line-clamp-2 text-[11px] text-muted">{p.body}</p>}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => void reject(p.id)}
                className="rounded px-2 py-0.5 text-[11px] text-muted hover:text-fg"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => void accept(p.id)}
                className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-base hover:opacity-90"
              >
                <Check size={11} /> Keep
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- Memory row */

function MemoryRow({ memory }: { memory: Memory | MemoryHit }) {
  const pin = useMemoryStore((s) => s.pin);
  const archive = useMemoryStore((s) => s.archive);
  const remove = useMemoryStore((s) => s.remove);
  const [expanded, setExpanded] = useState(false);
  const snippet = 'snippet' in memory ? memory.snippet : undefined;

  return (
    <li className="rounded-md border border-line bg-surface-2/40 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <TierBadge tier={memory.tier} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] text-fg" title={memory.title}>
              {memory.title}
            </span>
            {memory.pinned && <Pin size={10} className="shrink-0 text-accent" />}
          </div>
          <p className={cn('text-[11px] text-muted', expanded ? '' : 'line-clamp-2')}>
            {snippet || memory.body}
          </p>
        </button>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={memory.pinned ? 'Unpin' : 'Pin'}
            size="sm"
            onClick={() => void pin(memory.id, !memory.pinned)}
          >
            {memory.pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </IconButton>
          <IconButton label="Archive" size="sm" onClick={() => void archive(memory.id, true)}>
            <Archive size={12} />
          </IconButton>
          <IconButton label="Delete" size="sm" onClick={() => void remove(memory.id)}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      </div>
      {expanded && (
        <div className="mt-1 flex items-center gap-2 px-0.5 text-[10px] text-faint">
          <span>{memory.source}</span>
          <span>·</span>
          <span>{Math.round(memory.confidence * 100)}% confidence</span>
          {memory.useCount > 0 && (
            <>
              <span>·</span>
              <span>used {memory.useCount}×</span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function TierBadge({ tier }: { tier: MemoryTier }) {
  return (
    <span className="mt-0.5 shrink-0 rounded bg-surface px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-faint">
      {TIER_LABEL[tier]}
    </span>
  );
}

/* ------------------------------------------------------------- Compose note */

function ComposeNote({ global, onClose }: { global: boolean; onClose: () => void }) {
  const create = useMemoryStore((s) => s.create);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tier, setTier] = useState<MemoryTier>(global ? 'preference' : 'note');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await create({ tier, title: title.trim(), body: body.trim(), global });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-2 flex flex-col gap-1.5 rounded-md border border-line-strong bg-surface-2 p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Use Zustand slice-per-domain)"
        className="h-7 w-full rounded border border-line bg-surface px-2 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="The knowledge to remember…"
        rows={3}
        className="w-full resize-y rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as MemoryTier)}
          className="h-7 rounded border border-line bg-surface px-1.5 text-[11px] text-fg focus:outline-none"
        >
          {TIERS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-faint">{global ? 'Saved globally' : 'Saved to this workspace'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[11px] text-muted hover:text-fg">
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim() || saving}
            onClick={() => void save()}
            className="rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-base hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
