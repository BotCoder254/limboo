/**
 * IPC handlers for the Search Engine. Registered through `handle()`, so every call
 * inherits sender-origin validation. All renderer input is validated here in the
 * main process (CLAUDE.md §6): query/name strings are length-capped, kind / symbol
 * enums are checked, workspace ids are validated, and any renderer-supplied object
 * (filter) is guarded against prototype-pollution keys before use. The index is
 * fully local — these handlers never touch the network.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SEARCH_LIMITS } from '@shared/constants';
import type {
  SavedSearch,
  SearchFilter,
  SearchGroup,
  SearchHistoryEntry,
  SearchHit,
  SearchKind,
  SearchQueryOptions,
  SymbolKind,
} from '@shared/types';
import { handle } from './registry';
import type { SearchManager } from '../managers/search/SearchManager';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const SEARCH_KINDS: readonly SearchKind[] = [
  'file', 'symbol', 'doc', 'memory', 'commit', 'branch', 'tag',
  'session', 'terminal', 'diagnostic', 'command', 'setting', 'saved',
];
const SYMBOL_KINDS: readonly SymbolKind[] = [
  'function', 'method', 'class', 'interface', 'enum', 'type',
  'constant', 'variable', 'struct', 'trait', 'module',
];

function assertSafeObject(value: unknown, label: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`search: invalid ${label}`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`search: rejected unsafe key in ${label}: ${key}`);
    }
  }
}

function assertId(id: unknown, label = 'id'): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error(`search: invalid ${label}`);
  }
}

function assertWorkspaceId(id: unknown): asserts id is string | null {
  if (id === null) return;
  assertId(id, 'workspaceId');
}

function assertQuery(query: unknown): asserts query is string {
  if (typeof query !== 'string' || query.length > SEARCH_LIMITS.queryMax) {
    throw new Error('search: invalid query');
  }
}

/** Validate + normalize a renderer-supplied query-options object. */
function normalizeOptions(opts: unknown): SearchQueryOptions {
  assertSafeObject(opts, 'options');
  const o = (opts ?? {}) as Record<string, unknown>;
  assertWorkspaceId(o.workspaceId ?? null);
  const kinds = Array.isArray(o.kinds)
    ? (o.kinds.filter((k) => (SEARCH_KINDS as readonly string[]).includes(k as string)) as SearchKind[])
    : undefined;
  const symbolKind =
    typeof o.symbolKind === 'string' && (SYMBOL_KINDS as readonly string[]).includes(o.symbolKind)
      ? (o.symbolKind as SymbolKind)
      : undefined;
  const lang = typeof o.lang === 'string' && o.lang.length <= 32 ? o.lang : undefined;
  const limit = typeof o.limit === 'number' && Number.isFinite(o.limit) ? o.limit : undefined;
  return { workspaceId: (o.workspaceId as string | null) ?? null, kinds, symbolKind, lang, limit };
}

/** Validate a renderer-supplied SearchFilter (for saved searches). */
function normalizeFilter(filter: unknown): SearchFilter {
  assertSafeObject(filter, 'filter');
  const f = (filter ?? {}) as Record<string, unknown>;
  const kinds = Array.isArray(f.kinds)
    ? (f.kinds.filter((k) => (SEARCH_KINDS as readonly string[]).includes(k as string)) as SearchKind[])
    : undefined;
  const symbolKind =
    typeof f.symbolKind === 'string' && (SYMBOL_KINDS as readonly string[]).includes(f.symbolKind)
      ? (f.symbolKind as SymbolKind)
      : undefined;
  const lang = typeof f.lang === 'string' && f.lang.length <= 32 ? f.lang : undefined;
  return { kinds, symbolKind, lang };
}

export function registerSearchHandlers(search: SearchManager): void {
  handle<[string, SearchQueryOptions], SearchGroup[]>(IpcChannels.searchGlobal, (_e, query, opts) => {
    assertQuery(query);
    const options = normalizeOptions(opts);
    // Record non-trivial queries for the recent-search list (best-effort).
    if (query.trim().length >= 2) search.recordHistory(options.workspaceId, query);
    return search.globalSearch(query, options);
  });

  handle<[string, SearchQueryOptions], SearchHit[]>(IpcChannels.searchFiles, (_e, query, opts) => {
    assertQuery(query);
    return search.searchFiles(query, normalizeOptions(opts));
  });

  handle<[string, SearchQueryOptions], SearchHit[]>(IpcChannels.searchSymbols, (_e, query, opts) => {
    assertQuery(query);
    return search.searchSymbols(query, normalizeOptions(opts));
  });

  handle<[string], void>(IpcChannels.searchReindex, async (_e, workspaceId) => {
    assertId(workspaceId, 'workspaceId');
    await search.indexWorkspace(workspaceId);
  });

  handle<[string | null], { indexed: boolean; files: number }>(
    IpcChannels.searchGetStatus,
    (_e, workspaceId) => {
      assertWorkspaceId(workspaceId);
      return search.getStatus(workspaceId);
    },
  );

  handle<[string | null], SearchHistoryEntry[]>(IpcChannels.searchHistoryList, (_e, workspaceId) => {
    assertWorkspaceId(workspaceId);
    return search.listHistory(workspaceId);
  });

  handle<[string | null], void>(IpcChannels.searchHistoryClear, (_e, workspaceId) => {
    assertWorkspaceId(workspaceId);
    search.clearHistory(workspaceId);
  });

  handle<[string | null], SavedSearch[]>(IpcChannels.searchSavedList, (_e, workspaceId) => {
    assertWorkspaceId(workspaceId);
    return search.listSaved(workspaceId);
  });

  handle<
    [{ workspaceId: string | null; name: string; query: string; filter?: SearchFilter }],
    SavedSearch
  >(IpcChannels.searchSavedCreate, (_e, input) => {
    assertSafeObject(input, 'saved input');
    assertWorkspaceId(input?.workspaceId ?? null);
    if (typeof input?.name !== 'string' || input.name.trim().length === 0 || input.name.length > SEARCH_LIMITS.savedNameMax) {
      throw new Error('search: invalid saved-search name');
    }
    assertQuery(input?.query);
    return search.saveSearch({
      workspaceId: input.workspaceId ?? null,
      name: input.name.trim(),
      query: input.query,
      filter: normalizeFilter(input.filter),
    });
  });

  handle<[string], void>(IpcChannels.searchSavedDelete, (_e, id) => {
    assertId(id);
    search.deleteSaved(id);
  });
}
