/**
 * Search Manager — the Search Engine platform service. A single, app-owned query
 * interface that every subsystem consumes instead of implementing its own lookup.
 *
 * Two responsibilities:
 *  1. Maintain an on-device, continuously-updated FTS index of the active
 *     workspace's **files, content, and symbols** (the large / expensive sources).
 *  2. **Federate** the smaller, already-queryable sources at query time — memories
 *     (MemoryManager), git history (GitManager), and sessions (SessionManager) —
 *     merging everything into one ranked, grouped result set.
 *
 * It is also the **primary context provider for the coding agent**: `retrieveContext`
 * returns ranked files/symbols/docs that `AgentManager` injects before the SDK's
 * Read/Grep/Glob run. Search retrieves + ranks; the SDK still executes.
 *
 * Local-first & private (CLAUDE.md §6): no network, no embeddings. Retrieval is
 * SQLite FTS5/BM25 fused with fuzzy + trigram substring matching. Lives in the main
 * process only. Every statement is parameterized; file content is read solely
 * through the guarded {@link readWorkspaceFile}; the walk stays inside the workspace
 * root, never follows symlinks, and is bounded by {@link FS_LIMITS}.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { FS_LIMITS, SEARCH_LIMITS } from '@shared/constants';
import type {
  SavedSearch,
  SearchFilter,
  SearchGroup,
  SearchHit,
  SearchHistoryEntry,
  SearchIndexProgress,
  SearchKind,
  SearchQueryOptions,
  SymbolKind,
} from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { WorkspaceManager } from '../WorkspaceManager';
import type { MemoryManager } from '../memory/MemoryManager';
import type { GitManager } from '../GitManager';
import type { SessionManager } from '../SessionManager';
import { readWorkspaceFile } from '../fs/reader';
import { buildIgnoreMatcher } from '../fs/ignore';
import { isInsideRoot } from '../workspace/validate';
import { extractSymbols } from './symbols';
import { isDocPath, langForPath, toFtsQuery, toLikePattern, toPrefixPattern, toTrigramQuery } from './query';

/** Directories always skipped even when `includeIgnored` is on (safety floor). */
const ALWAYS_IGNORE = new Set(['.git', 'node_modules']);

/** Fixed display order for the grouped results UI. */
const GROUP_ORDER: SearchKind[] = [
  'file',
  'symbol',
  'doc',
  'memory',
  'commit',
  'branch',
  'tag',
  'session',
  'command',
  'setting',
  'saved',
  'terminal',
  'diagnostic',
];

const GROUP_LABEL: Record<SearchKind, string> = {
  file: 'Files',
  symbol: 'Symbols',
  doc: 'Documentation',
  memory: 'Memory',
  commit: 'Commits',
  branch: 'Branches',
  tag: 'Tags',
  session: 'Sessions',
  command: 'Commands',
  setting: 'Settings',
  saved: 'Saved searches',
  terminal: 'Terminal',
  diagnostic: 'Diagnostics',
};

interface FileRow {
  path: string;
  lang: string | null;
  size: number;
  bm: number;
  snip: string;
}
interface SymbolRow {
  path: string;
  name: string;
  kind: string;
  lang: string | null;
  line: number;
  signature: string;
  bm?: number;
}

/** Cached git federation snapshot per workspace (avoids spawning git per keystroke). */
interface GitCache {
  at: number;
  hits: SearchHit[];
}

export interface RetrieveContext {
  workspaceId: string | null;
  prompt: string;
  activeFiles?: string[];
  limit?: number;
}

export class SearchManager {
  private memory: MemoryManager | null = null;
  private git: GitManager | null = null;
  private sessions: SessionManager | null = null;

  /** In-flight index passes, keyed by workspace id — concurrent callers coalesce. */
  private readonly indexing = new Map<string, Promise<void>>();
  /** Workspaces whose index is fresh this session (drives status). */
  private readonly indexed = new Set<string>();
  private readonly gitCache = new Map<string, GitCache>();

  constructor(
    private readonly settings: SettingsManager,
    private readonly workspace: WorkspaceManager,
  ) {}

  private get db(): Database.Database {
    return getDb();
  }

  setMemoryManager(memory: MemoryManager): void {
    this.memory = memory;
  }
  setGitManager(git: GitManager): void {
    this.git = git;
  }
  setSessionManager(sessions: SessionManager): void {
    this.sessions = sessions;
  }

  /* --------------------------------------------------------------- indexing */

  /**
   * (Re)build the file + symbol index for a workspace. Concurrent calls for the
   * same workspace coalesce onto the in-flight pass. Bounded and cooperative so
   * the main process stays responsive on large repositories.
   */
  async indexWorkspace(workspaceId: string): Promise<void> {
    if (!this.settings.getAll().search.enabled) return;
    const inFlight = this.indexing.get(workspaceId);
    if (inFlight) return inFlight;
    const run = this.runIndex(workspaceId);
    this.indexing.set(workspaceId, run);
    try {
      await run;
    } finally {
      this.indexing.delete(workspaceId);
    }
  }

  private async runIndex(workspaceId: string): Promise<void> {
    const ws = this.workspace.getById(workspaceId);
    if (!ws) return;
    const cfg = this.settings.getAll().search;
    const started = Date.now();
    const matcher = cfg.includeIgnored ? null : buildIgnoreMatcher(ws.path, ws.config);
    const maxBytes = Math.min(cfg.maxFileSizeKb * 1024, FS_LIMITS.maxReadBytes);

    // Collect the file set first (cheap readdir walk) so progress is a real %.
    const files = this.walk(ws.path, matcher);
    const total = files.length;
    this.broadcastProgress({ workspaceId, phase: 'indexing', processed: 0, total, percent: 0 });

    const now = Date.now();
    const insertFile = this.db.prepare(
      `INSERT INTO search_files (id, workspace_id, path, lang, size, content, updated_at)
         VALUES (@id, @workspace_id, @path, @lang, @size, @content, @updated_at)`,
    );
    const insertSymbol = this.db.prepare(
      `INSERT INTO search_symbols (id, workspace_id, path, name, kind, lang, line, signature, updated_at)
         VALUES (@id, @workspace_id, @path, @name, @kind, @lang, @line, @signature, @updated_at)`,
    );

    // Replace the workspace's rows atomically once, then stream inserts in batches
    // that periodically yield to the event loop (progress + UI stay live).
    this.clearWorkspace(workspaceId);

    let processed = 0;
    let lastEmit = 0;
    const BATCH = 200;
    for (let i = 0; i < files.length; i += BATCH) {
      const slice = files.slice(i, i + BATCH);
      const tx = this.db.transaction(() => {
        for (const rel of slice) {
          const lang = langForPath(rel) ?? null;
          let content = '';
          let size = 0;
          if (cfg.indexContents) {
            try {
              const res = readWorkspaceFile(ws.path, rel);
              size = res.size;
              if (res.content && !res.isBinary && !res.tooLarge && res.size <= maxBytes) {
                content = res.content.slice(0, SEARCH_LIMITS.contentIndexChars);
              }
            } catch {
              /* unreadable file — index path only */
            }
          }
          insertFile.run({
            id: crypto.randomUUID(),
            workspace_id: workspaceId,
            path: rel,
            lang,
            size,
            content,
            updated_at: now,
          });
          if (content) {
            for (const sym of extractSymbols(content, lang ?? undefined)) {
              insertSymbol.run({
                id: crypto.randomUUID(),
                workspace_id: workspaceId,
                path: rel,
                name: sym.name,
                kind: sym.kind,
                lang,
                line: sym.line,
                signature: sym.signature,
                updated_at: now,
              });
            }
          }
          processed += 1;
        }
      });
      try {
        tx();
      } catch (err) {
        logger.warn('search: index batch failed', err);
      }
      const nowMs = Date.now();
      if (nowMs - lastEmit >= FS_LIMITS.progressThrottleMs) {
        lastEmit = nowMs;
        this.broadcastProgress({
          workspaceId,
          phase: 'indexing',
          processed,
          total,
          percent: total === 0 ? 100 : Math.min(99, Math.round((processed / total) * 100)),
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    this.indexed.add(workspaceId);
    this.broadcastProgress({ workspaceId, phase: 'done', processed, total, percent: 100 });
    this.notifyChanged();
    logger.info(`search: indexed ${ws.name} — ${processed} files in ${Date.now() - started}ms`);
  }

  /** Bounded readdir walk yielding workspace-relative POSIX file paths. */
  private walk(root: string, matcher: ReturnType<typeof buildIgnoreMatcher> | null): string[] {
    const out: string[] = [];
    const rec = (dir: string, depth: number): void => {
      if (out.length >= FS_LIMITS.maxTreeEntries || depth > FS_LIMITS.maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= FS_LIMITS.maxTreeEntries) return;
        if (ALWAYS_IGNORE.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (!isInsideRoot(root, full)) continue;
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (matcher && matcher.ignores(rel)) continue;
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) rec(full, depth + 1);
        else if (e.isFile()) out.push(rel);
      }
    };
    rec(root, 0);
    return out;
  }

  private clearWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM search_files WHERE workspace_id = ?').run(workspaceId);
    this.db.prepare('DELETE FROM search_symbols WHERE workspace_id = ?').run(workspaceId);
  }

  /** Drop a workspace's entire index (called when a workspace is removed). */
  dropWorkspace(workspaceId: string): void {
    this.clearWorkspace(workspaceId);
    this.indexed.delete(workspaceId);
    this.gitCache.delete(workspaceId);
    this.notifyChanged();
  }

  /** Whether a workspace has been indexed this session + its file count. */
  getStatus(workspaceId: string | null): { indexed: boolean; files: number } {
    if (workspaceId === null) return { indexed: false, files: 0 };
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM search_files WHERE workspace_id = ?')
      .get(workspaceId) as { n: number };
    return { indexed: this.indexed.has(workspaceId) || row.n > 0, files: row.n };
  }

  /* ----------------------------------------------------------------- search */

  /**
   * The universal entry point: search every source and return ranked, grouped
   * hits. Federated sources fail soft (a missing/absent subsystem is skipped).
   */
  globalSearch(query: string, opts: SearchQueryOptions): SearchGroup[] {
    const q = query.trim();
    if (!q) return [];
    const cfg = this.settings.getAll().search;
    const perGroup = clampInt(
      opts.limit ?? cfg.maxResultsPerGroup,
      1,
      SEARCH_LIMITS.maxResultsPerGroup.max,
    );
    const kinds = opts.kinds && opts.kinds.length ? new Set(opts.kinds) : null;
    // A source must pass the explicit kind filter (chips) AND be enabled in settings.
    const want = (k: SearchKind): boolean =>
      (!kinds || kinds.has(k)) && sourceEnabled(k, cfg.sources);

    const byKind = new Map<SearchKind, SearchHit[]>();
    const add = (hits: SearchHit[]): void => {
      for (const h of hits) {
        if (!want(h.kind)) continue;
        const list = byKind.get(h.kind) ?? [];
        list.push(h);
        byKind.set(h.kind, list);
      }
    };

    // 1) Own index — files/docs + symbols.
    if (want('file') || want('doc')) add(this.queryFiles(q, opts, perGroup + 5));
    if (want('symbol')) add(this.querySymbols(q, opts, perGroup + 5));

    // 2) Federated sources (fail soft).
    if (want('memory') && this.memory) {
      try {
        const hits = this.memory
          .search(q, { workspaceId: opts.workspaceId, limit: perGroup })
          .map<SearchHit>((m) => ({
            id: `memory:${m.id}`,
            kind: 'memory',
            title: m.title,
            subtitle: m.snippet || m.body.slice(0, 120),
            ref: m.id,
            score: m.score,
          }));
        add(hits);
      } catch (err) {
        logger.warn('search: memory federation failed', err);
      }
    }
    if ((want('commit') || want('branch') || want('tag')) && opts.workspaceId) {
      add(this.queryGit(q, opts.workspaceId));
    }
    if (want('session') && opts.workspaceId && this.sessions) {
      add(this.querySessions(q, opts.workspaceId));
    }

    // Assemble groups in display order, capped per group.
    const groups: SearchGroup[] = [];
    for (const kind of GROUP_ORDER) {
      const hits = byKind.get(kind);
      if (!hits || hits.length === 0) continue;
      hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      groups.push({
        kind,
        label: GROUP_LABEL[kind],
        hits: hits.slice(0, perGroup),
        truncated: hits.length > perGroup,
      });
    }
    return groups;
  }

  /** File/content search (BM25). Docs are split into their own kind. */
  private queryFiles(query: string, opts: SearchQueryOptions, limit: number): SearchHit[] {
    const match = toFtsQuery(query);
    const langClause = opts.lang ? ' AND f.lang = ?' : '';
    const langParam = opts.lang ? [opts.lang] : [];
    let rows: FileRow[];
    if (match) {
      rows = this.db
        .prepare(
          `SELECT f.path AS path, f.lang AS lang, f.size AS size,
                  bm25(search_files_fts, 4.0, 1.0) AS bm,
                  snippet(search_files_fts, 1, '', '', '…', 10) AS snip
             FROM search_files_fts
             JOIN search_files f ON f.rowid = search_files_fts.rowid
            WHERE search_files_fts MATCH ? AND f.workspace_id = ?${langClause}
            ORDER BY bm LIMIT ?`,
        )
        .all(match, opts.workspaceId, ...langParam, limit) as FileRow[];
    } else {
      const like = toLikePattern(query);
      rows = this.db
        .prepare(
          `SELECT path, lang, size, 0 AS bm, '' AS snip FROM search_files f
            WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\'${langClause}
            ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(opts.workspaceId, like, ...langParam, limit) as FileRow[];
    }
    return rows.map((r) => {
      const doc = isDocPath(r.path);
      return {
        id: `${doc ? 'doc' : 'file'}:${r.path}`,
        kind: doc ? 'doc' : 'file',
        title: basename(r.path),
        subtitle: r.snip ? r.snip : dirOf(r.path),
        path: r.path,
        lang: r.lang ?? undefined,
        ref: r.path,
        score: this.rankFile(r, query),
      } as SearchHit;
    });
  }

  /** Symbol search (trigram substring, LIKE fallback for short queries). */
  private querySymbols(query: string, opts: SearchQueryOptions, limit: number): SearchHit[] {
    const kindClause = opts.symbolKind ? ' AND s.kind = ?' : '';
    const kindParam = opts.symbolKind ? [opts.symbolKind] : [];
    const langClause = opts.lang ? ' AND s.lang = ?' : '';
    const langParam = opts.lang ? [opts.lang] : [];
    // Fuzzy (default): trigram substring MATCH + `%q%` fallback. Strict: prefix-only,
    // so `use` matches `useSearchStore` but not `abuse`.
    const fuzzy = opts.fuzzy ?? this.settings.getAll().search.fuzzy;
    const match = fuzzy ? toTrigramQuery(query) : null;
    let rows: SymbolRow[];
    if (match) {
      rows = this.db
        .prepare(
          `SELECT s.path, s.name, s.kind, s.lang, s.line, s.signature,
                  bm25(search_symbols_fts) AS bm
             FROM search_symbols_fts
             JOIN search_symbols s ON s.rowid = search_symbols_fts.rowid
            WHERE search_symbols_fts MATCH ? AND s.workspace_id = ?${kindClause}${langClause}
            ORDER BY bm LIMIT ?`,
        )
        .all(match, opts.workspaceId, ...kindParam, ...langParam, limit) as SymbolRow[];
    } else {
      const like = fuzzy ? toLikePattern(query, 64) : toPrefixPattern(query, 64);
      rows = this.db
        .prepare(
          `SELECT path, name, kind, lang, line, signature FROM search_symbols s
            WHERE workspace_id = ? AND name LIKE ? ESCAPE '\\'${kindClause}${langClause}
            LIMIT ?`,
        )
        .all(opts.workspaceId, like, ...kindParam, ...langParam, limit) as SymbolRow[];
    }
    const ql = query.toLowerCase();
    return rows.map((r) => ({
      id: `symbol:${r.path}:${r.line}:${r.name}`,
      kind: 'symbol' as const,
      title: r.name,
      subtitle: `${r.kind} · ${r.path}`,
      path: r.path,
      line: r.line,
      symbolKind: r.kind as SymbolKind,
      lang: r.lang ?? undefined,
      ref: `${r.path}:${r.line}`,
      // Exact / prefix name matches rank above incidental substring hits.
      score: r.name.toLowerCase() === ql ? 3 : r.name.toLowerCase().startsWith(ql) ? 2 : 1,
    }));
  }

  /** Federated git search (commits/branches/tags) with a short-TTL cache. */
  private queryGit(query: string, workspaceId: string): SearchHit[] {
    const hits = this.gitSnapshot(workspaceId);
    const ql = query.toLowerCase();
    return hits.filter(
      (h) => h.title.toLowerCase().includes(ql) || (h.subtitle ?? '').toLowerCase().includes(ql),
    );
  }

  /** Build (or reuse) the cached git federation snapshot for a workspace. */
  private gitSnapshot(workspaceId: string): SearchHit[] {
    const cached = this.gitCache.get(workspaceId);
    if (cached && Date.now() - cached.at < SEARCH_LIMITS.gitCacheTtlMs) return cached.hits;
    const hits: SearchHit[] = [];
    // Kick off an async refresh; serve the (possibly empty) current snapshot now.
    void this.refreshGitCache(workspaceId);
    return cached?.hits ?? hits;
  }

  private async refreshGitCache(workspaceId: string): Promise<void> {
    if (!this.git) return;
    const existing = this.gitCache.get(workspaceId);
    if (existing && Date.now() - existing.at < SEARCH_LIMITS.gitCacheTtlMs) return;
    // Reserve the slot immediately so concurrent searches don't stampede git.
    this.gitCache.set(workspaceId, { at: Date.now(), hits: existing?.hits ?? [] });
    try {
      const [commits, branches, tags] = await Promise.all([
        this.git.log(workspaceId, { limit: 100 }).catch(() => []),
        this.git.branches(workspaceId).catch(() => []),
        this.git.tags(workspaceId).catch(() => []),
      ]);
      const hits: SearchHit[] = [];
      for (const c of commits) {
        hits.push({
          id: `commit:${c.hash}`,
          kind: 'commit',
          title: c.subject,
          subtitle: `${c.shortHash} · ${c.author}`,
          ref: c.hash,
          score: 1,
        });
      }
      for (const b of branches) {
        hits.push({ id: `branch:${b.name}`, kind: 'branch', title: b.name, ref: b.name, score: b.current ? 2 : 1 });
      }
      for (const t of tags) {
        hits.push({ id: `tag:${t.name}`, kind: 'tag', title: t.name, subtitle: t.subject, ref: t.name, score: 1 });
      }
      this.gitCache.set(workspaceId, { at: Date.now(), hits });
      this.notifyChanged();
    } catch (err) {
      logger.warn('search: git federation refresh failed', err);
    }
  }

  private querySessions(query: string, workspaceId: string): SearchHit[] {
    if (!this.sessions) return [];
    const ql = query.toLowerCase();
    try {
      return this.sessions
        .list(workspaceId)
        .filter((s) => s.title.toLowerCase().includes(ql))
        .map<SearchHit>((s) => ({
          id: `session:${s.id}`,
          kind: 'session',
          title: s.title,
          subtitle: s.branch,
          ref: s.id,
          score: 1,
        }));
    } catch (err) {
      logger.warn('search: session federation failed', err);
      return [];
    }
  }

  /** Scoped file-only search (for the `find_files` MCP tool / File filter). */
  searchFiles(query: string, opts: SearchQueryOptions): SearchHit[] {
    return this.queryFiles(query.trim(), opts, clampInt(opts.limit ?? 30, 1, SEARCH_LIMITS.resultsMax));
  }

  /** Scoped symbol-only search (for the `find_symbols` MCP tool / Symbol filter). */
  searchSymbols(query: string, opts: SearchQueryOptions): SearchHit[] {
    return this.querySymbols(query.trim(), opts, clampInt(opts.limit ?? 30, 1, SEARCH_LIMITS.resultsMax));
  }

  /* ------------------------------------------------ agent context provider */

  /**
   * Pick the highest-value files/symbols/docs for a prompt — the ranked retrieval
   * the agent gets *before* it explores with Read/Grep/Glob. Returns [] when search
   * is disabled / not injecting / empty.
   */
  retrieveContext(ctx: RetrieveContext): SearchHit[] {
    const cfg = this.settings.getAll().search;
    if (!cfg.enabled || !cfg.injectContext || ctx.workspaceId === null) return [];
    const k = clampInt(ctx.limit ?? cfg.maxInjected, 0, SEARCH_LIMITS.maxInjected.max);
    if (k === 0) return [];
    const opts: SearchQueryOptions = { workspaceId: ctx.workspaceId, limit: Math.max(6, Math.ceil(k / 2)) };
    const files = this.queryFiles(ctx.prompt, opts, opts.limit ?? 8);
    const symbols = this.querySymbols(ctx.prompt, opts, opts.limit ?? 8);
    // Interleave files and symbols, files first (concrete locations), capped to k.
    const merged: SearchHit[] = [];
    const max = Math.max(files.length, symbols.length);
    for (let i = 0; i < max && merged.length < k; i += 1) {
      if (files[i]) merged.push(files[i]);
      if (symbols[i] && merged.length < k) merged.push(symbols[i]);
    }
    return merged.slice(0, k);
  }

  /**
   * Render retrieved hits into a compact, clearly-delimited context block for the
   * agent's system prompt. Advisory only — it points the agent at what likely
   * deserves exploration; the SDK's own tools remain authoritative.
   */
  buildContextBlock(hits: SearchHit[]): string {
    if (hits.length === 0) return '';
    const lines: string[] = [];
    let budget = SEARCH_LIMITS.injectCharBudget;
    for (const h of hits) {
      const loc = h.line ? `${h.path}:${h.line}` : h.path ?? h.ref;
      const line =
        h.kind === 'symbol'
          ? `- ${h.symbolKind ?? 'symbol'} \`${h.title}\` — ${loc}`
          : `- ${loc}`;
      if (line.length > budget) break;
      lines.push(line);
      budget -= line.length;
    }
    if (lines.length === 0) return '';
    return (
      '<project-context>\n' +
      'Ranked files and symbols the local Search Engine judged most relevant to ' +
      'this task. Use them to decide what to open with your own Read/Grep/Glob ' +
      'tools first — they are hints, not a substitute for reading. Do not mention ' +
      'this block to the user.\n' +
      lines.join('\n') +
      '\n</project-context>'
    );
  }

  /* ----------------------------------------------------------- ranking */

  /** Composite file score: BM25 relevance + name/path affinity to the query. */
  private rankFile(r: FileRow, query: string): number {
    // bm25() is negative-good (more negative = more relevant); flip to positive and
    // damp so filename affinity below can dominate ties.
    const rel = Math.max(0, -r.bm) * 0.1;
    const ql = query.toLowerCase();
    const name = basename(r.path).toLowerCase();
    const nameBoost = name === ql ? 1 : name.startsWith(ql) ? 0.6 : name.includes(ql) ? 0.3 : 0;
    // Prefer source over generated/vendored areas.
    const generated = /(^|\/)(dist|build|out|\.next|coverage|vendor|__generated__)\//.test(r.path);
    const structure = generated ? -0.25 : 0;
    return rel + nameBoost + structure;
  }

  /* ------------------------------------------------ history + saved searches */

  /** User-configured recent-search ring length, hard-capped by SEARCH_LIMITS. */
  private historyLimit(): number {
    return clampInt(
      this.settings.getAll().search.historyLimit,
      SEARCH_LIMITS.historyLimit.min,
      SEARCH_LIMITS.historyMax,
    );
  }

  recordHistory(workspaceId: string | null, query: string): void {
    const q = query.trim();
    if (!q) return;
    try {
      // Collapse duplicates: drop a prior identical query in this scope first.
      this.db
        .prepare(
          `DELETE FROM search_history WHERE query = ? AND (workspace_id IS ? OR workspace_id = ?)`,
        )
        .run(q, workspaceId, workspaceId);
      this.db
        .prepare('INSERT INTO search_history (id, workspace_id, query, created_at) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), workspaceId, q, Date.now());
      // Trim the ring to the newest N for this scope.
      this.db
        .prepare(
          `DELETE FROM search_history WHERE (workspace_id IS ? OR workspace_id = ?)
             AND id NOT IN (
               SELECT id FROM search_history WHERE (workspace_id IS ? OR workspace_id = ?)
               ORDER BY created_at DESC LIMIT ?)`,
        )
        .run(workspaceId, workspaceId, workspaceId, workspaceId, this.historyLimit());
      this.notifyChanged();
    } catch (err) {
      logger.warn('search: recordHistory failed', err);
    }
  }

  listHistory(workspaceId: string | null): SearchHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT query, created_at FROM search_history WHERE (workspace_id IS ? OR workspace_id = ?)
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(workspaceId, workspaceId, this.historyLimit()) as Array<{ query: string; created_at: number }>;
    return rows.map((r) => ({ query: r.query, at: r.created_at }));
  }

  clearHistory(workspaceId: string | null): void {
    this.db
      .prepare('DELETE FROM search_history WHERE (workspace_id IS ? OR workspace_id = ?)')
      .run(workspaceId, workspaceId);
    this.notifyChanged();
  }

  saveSearch(input: { workspaceId: string | null; name: string; query: string; filter: SearchFilter }): SavedSearch {
    const row = {
      id: crypto.randomUUID(),
      workspace_id: input.workspaceId,
      name: input.name.slice(0, SEARCH_LIMITS.savedNameMax),
      query: input.query.slice(0, SEARCH_LIMITS.queryMax),
      filter: JSON.stringify(input.filter ?? {}),
      created_at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO saved_searches (id, workspace_id, name, query, filter, created_at)
           VALUES (@id, @workspace_id, @name, @query, @filter, @created_at)`,
      )
      .run(row);
    this.notifyChanged();
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      query: row.query,
      filter: input.filter ?? {},
      createdAt: row.created_at,
    };
  }

  listSaved(workspaceId: string | null): SavedSearch[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM saved_searches WHERE (workspace_id IS ? OR workspace_id = ?)
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(workspaceId, workspaceId, SEARCH_LIMITS.savedMax) as Array<{
      id: string;
      workspace_id: string | null;
      name: string;
      query: string;
      filter: string;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      query: r.query,
      filter: safeParseFilter(r.filter),
      createdAt: r.created_at,
    }));
  }

  deleteSaved(id: string): void {
    this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
    this.notifyChanged();
  }

  /* ------------------------------------------------------------- internal */

  private broadcastProgress(progress: SearchIndexProgress): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.searchIndexProgress, progress);
    }
  }

  private notifyChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.searchChanged, {});
    }
  }
}

/* --------------------------------------------------------------- helpers */

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
function clampInt(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)));
}
/** Whether a result kind is enabled by the user's per-source toggles. */
function sourceEnabled(
  kind: SearchKind,
  sources: {
    files: boolean;
    symbols: boolean;
    docs: boolean;
    memory: boolean;
    commits: boolean;
    branches: boolean;
    sessions: boolean;
  },
): boolean {
  switch (kind) {
    case 'file':
      return sources.files;
    case 'symbol':
      return sources.symbols;
    case 'doc':
      return sources.docs;
    case 'memory':
      return sources.memory;
    case 'commit':
      return sources.commits;
    case 'branch':
    case 'tag':
      return sources.branches;
    case 'session':
      return sources.sessions;
    default:
      // command / setting / saved / terminal / diagnostic are client-side, always on.
      return true;
  }
}
function safeParseFilter(json: string): SearchFilter {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as SearchFilter) : {};
  } catch {
    return {};
  }
}
