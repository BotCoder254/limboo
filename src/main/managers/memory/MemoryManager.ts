/**
 * Memory Manager — the Local Memory System. A provider-independent **platform
 * service** (it belongs to the app, not to the coding agent) that preserves
 * durable project knowledge — decisions, conventions, preferences, reusable
 * solutions, and manual notes — in the on-device SQLite database and injects the
 * most relevant entries into the agent prompt before it reaches the harness.
 *
 * Local-first & private: there is no network and no embeddings API. Retrieval is
 * SQLite FTS5 + BM25 (keyword relevance) fused with recency / confidence / usage
 * / tier signals. Lives in the main process only; the renderer reaches it solely
 * through validated IPC.
 *
 * Security (CLAUDE.md §6): every statement is parameterized — the FTS query and
 * all values are bound, never string-interpolated. Renderer input is enum- and
 * length-validated in the handlers; `meta` is guarded against prototype-pollution
 * keys before persist; secrets are redacted before anything reaches the logger.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcEvents } from '@shared/ipc-channels';
import { MEMORY_LIMITS } from '@shared/constants';
import type {
  Memory,
  MemoryCreateInput,
  MemoryHit,
  MemoryListFilter,
  MemorySource,
  MemoryStatus,
  MemoryTier,
  MemoryUpdateInput,
} from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';

interface MemoryRow {
  id: string;
  workspace_id: string | null;
  tier: string;
  title: string;
  body: string;
  source: string;
  confidence: number;
  pinned: number;
  status: string;
  use_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  session_id: string | null;
  commit_hash: string | null;
  file_path: string | null;
  meta: string;
}

const TIERS: readonly MemoryTier[] = [
  'session',
  'workspace',
  'project',
  'preference',
  'convention',
  'decision',
  'solution',
  'note',
];

const SOURCES: readonly MemorySource[] = [
  'manual',
  'auto',
  'commit',
  'conversation',
  'review',
  'terminal',
  'import',
];

/** Relative importance of each tier during retrieval ranking (0..1). */
const TIER_WEIGHT: Record<MemoryTier, number> = {
  decision: 1.0,
  convention: 0.92,
  preference: 0.9,
  solution: 0.72,
  note: 0.66,
  project: 0.6,
  workspace: 0.5,
  session: 0.3,
};

/** Context passed by the agent layer to pick relevant memories for a prompt. */
export interface RetrieveContext {
  workspaceId: string | null;
  sessionId?: string | null;
  prompt: string;
  activeFiles?: string[];
  branch?: string;
  limit?: number;
}

export function isMemoryTier(v: unknown): v is MemoryTier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}
export function isMemorySource(v: unknown): v is MemorySource {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
}

export class MemoryManager {
  constructor(private readonly settings: SettingsManager) {}

  private get db(): Database.Database {
    return getDb();
  }

  /* ------------------------------------------------------------------ CRUD */

  create(input: MemoryCreateInput): Memory {
    const now = Date.now();
    const tier: MemoryTier = isMemoryTier(input.tier) ? input.tier : 'note';
    const source: MemorySource = isMemorySource(input.source) ? input.source : 'manual';
    const row: MemoryRow = {
      id: crypto.randomUUID(),
      workspace_id: input.workspaceId ?? null,
      tier,
      title: clip(input.title, MEMORY_LIMITS.titleMax),
      body: clip(input.body, MEMORY_LIMITS.bodyMax),
      source,
      confidence: clamp01(input.confidence ?? (source === 'manual' ? 0.95 : 0.6)),
      pinned: input.pinned ? 1 : 0,
      // Manual entries are immediately active; everything else defaults active too,
      // except proposals which are created through propose() with status='proposed'.
      status: 'active',
      use_count: 0,
      last_used_at: null,
      created_at: now,
      updated_at: now,
      expires_at: null,
      session_id: input.sessionId ?? null,
      commit_hash: null,
      file_path: null,
      meta: '{}',
    };
    this.insert(row);
    this.notifyChanged();
    return rowToMemory(row);
  }

  update(id: string, patch: MemoryUpdateInput): Memory | null {
    const existing = this.row(id);
    if (!existing) return null;
    const next: MemoryRow = {
      ...existing,
      title: patch.title !== undefined ? clip(patch.title, MEMORY_LIMITS.titleMax) : existing.title,
      body: patch.body !== undefined ? clip(patch.body, MEMORY_LIMITS.bodyMax) : existing.body,
      tier: isMemoryTier(patch.tier) ? patch.tier : existing.tier,
      pinned: patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : existing.pinned,
      confidence: patch.confidence !== undefined ? clamp01(patch.confidence) : existing.confidence,
      updated_at: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE memories SET title=@title, body=@body, tier=@tier, pinned=@pinned,
           confidence=@confidence, updated_at=@updated_at WHERE id=@id`,
      )
      .run(next);
    this.notifyChanged();
    return rowToMemory(next);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM memory_links WHERE memory_id = ?').run(id);
    this.notifyChanged();
  }

  setArchived(id: string, archived: boolean): void {
    this.db
      .prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 'archived' : 'active', Date.now(), id);
    this.notifyChanged();
  }

  setPinned(id: string, pinned: boolean): void {
    this.db
      .prepare('UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, Date.now(), id);
    this.notifyChanged();
  }

  get(id: string): Memory | null {
    const row = this.row(id);
    return row ? rowToMemory(row) : null;
  }

  list(filter: MemoryListFilter): Memory[] {
    const limit = clampInt(filter.limit ?? 200, 1, MEMORY_LIMITS.listMax);
    const tiers = (filter.tiers ?? []).filter(isMemoryTier);
    const statuses = filter.includeArchived ? ['active', 'archived'] : ['active'];

    // Build a parameterized IN-list for tiers/statuses (placeholders only).
    const statusPlaceholders = statuses.map(() => '?').join(',');
    const tierClause = tiers.length ? ` AND tier IN (${tiers.map(() => '?').join(',')})` : '';
    const wsClause =
      filter.workspaceId === null
        ? 'workspace_id IS NULL'
        : '(workspace_id = ? OR workspace_id IS NULL)';

    const sql =
      `SELECT * FROM memories WHERE status IN (${statusPlaceholders}) AND ${wsClause}${tierClause}` +
      ` ORDER BY pinned DESC, updated_at DESC LIMIT ?`;

    const params: unknown[] = [...statuses];
    if (filter.workspaceId !== null) params.push(filter.workspaceId);
    params.push(...tiers);
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  listProposals(workspaceId: string | null): Memory[] {
    const wsClause =
      workspaceId === null
        ? 'workspace_id IS NULL'
        : '(workspace_id = ? OR workspace_id IS NULL)';
    const params = workspaceId === null ? [] : [workspaceId];
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE status = 'proposed' AND ${wsClause} ORDER BY confidence DESC, created_at DESC LIMIT ?`,
      )
      .all(...params, MEMORY_LIMITS.listMax) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  acceptProposal(id: string): Memory | null {
    const row = this.row(id);
    if (!row || row.status !== 'proposed') return null;
    this.db
      .prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
    this.notifyChanged();
    return this.get(id);
  }

  rejectProposal(id: string): void {
    // Drop rejected proposals entirely — they should not linger or be re-proposed
    // immediately. (A future pass could keep a 'rejected' tombstone to suppress
    // duplicates; deletion keeps the store clean.)
    this.delete(id);
  }

  /* ---------------------------------------------------------------- search */

  /**
   * Full-text search over title+body using FTS5 BM25, scoped to the workspace
   * (plus global-scope rows). Falls back to a LIKE scan when the query has no
   * usable FTS tokens. Returns snippet-highlighted hits.
   */
  search(query: string, opts: { workspaceId: string | null; tiers?: MemoryTier[]; limit?: number }): MemoryHit[] {
    const limit = clampInt(opts.limit ?? 50, 1, MEMORY_LIMITS.listMax);
    const match = toFtsQuery(query);
    const wsClause =
      opts.workspaceId === null
        ? 'm.workspace_id IS NULL'
        : '(m.workspace_id = ? OR m.workspace_id IS NULL)';
    const wsParam = opts.workspaceId === null ? [] : [opts.workspaceId];

    if (match) {
      const rows = this.db
        .prepare(
          `SELECT m.*, bm25(memories_fts) AS bm,
                  snippet(memories_fts, 1, '', '', '…', 12) AS snip
             FROM memories_fts
             JOIN memories m ON m.rowid = memories_fts.rowid
            WHERE memories_fts MATCH ?
              AND m.status = 'active'
              AND ${wsClause}
            ORDER BY bm
            LIMIT ?`,
        )
        .all(match, ...wsParam, limit) as Array<MemoryRow & { bm: number; snip: string }>;
      return rows.map((r) => ({ ...rowToMemory(r), snippet: r.snip, score: -r.bm }));
    }

    // No FTS tokens — fall back to a bounded LIKE scan (still parameterized).
    const like = `%${query.trim().slice(0, MEMORY_LIMITS.queryMax)}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memories m
          WHERE m.status = 'active' AND ${wsClause}
            AND (m.title LIKE ? OR m.body LIKE ?)
          ORDER BY m.pinned DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(...wsParam, like, like, limit) as MemoryRow[];
    return rows.map((r) => ({ ...rowToMemory(r) }));
  }

  /* ------------------------------------------------------ retrieval + rank */

  /**
   * Pick the highest-value memories for a prompt. Combines BM25 relevance with
   * recency, confidence, prior-usage, tier weight, pinned boost, and workspace
   * match into a composite score, then returns the top-K within budget. Pinned /
   * high-tier rows are folded in even when they don't match the FTS query so
   * architectural principles stay present.
   */
  retrieve(ctx: RetrieveContext): MemoryHit[] {
    const mem = this.settings.getAll().memory;
    if (!mem.enabled) return [];
    const k = clampInt(ctx.limit ?? mem.maxInjected, 0, MEMORY_LIMITS.maxInjected.max);
    if (k === 0) return [];

    const wsClause =
      ctx.workspaceId === null
        ? 'm.workspace_id IS NULL'
        : '(m.workspace_id = ? OR m.workspace_id IS NULL)';
    const wsParam = ctx.workspaceId === null ? [] : [ctx.workspaceId];

    const candidates = new Map<string, MemoryHit & { _relevance: number }>();

    // 1) FTS matches against the prompt + active file basenames + branch.
    const match = toFtsQuery(
      [ctx.prompt, ...(ctx.activeFiles ?? []).map((f) => path.basename(f)), ctx.branch ?? ''].join(' '),
    );
    if (match) {
      const rows = this.db
        .prepare(
          `SELECT m.*, bm25(memories_fts) AS bm
             FROM memories_fts
             JOIN memories m ON m.rowid = memories_fts.rowid
            WHERE memories_fts MATCH ?
              AND m.status = 'active'
              AND ${wsClause}
            ORDER BY bm
            LIMIT 60`,
        )
        .all(match, ...wsParam) as Array<MemoryRow & { bm: number }>;
      for (const r of rows) candidates.set(r.id, { ...rowToMemory(r), _relevance: -r.bm });
    }

    // 2) Always-relevant rows: pinned + durable tiers (decisions/conventions/
    //    preferences), folded in with zero FTS relevance so they can still rank.
    const always = this.db
      .prepare(
        `SELECT * FROM memories m
          WHERE m.status = 'active' AND ${wsClause}
            AND (m.pinned = 1 OR m.tier IN ('decision','convention','preference'))
          ORDER BY m.pinned DESC, m.updated_at DESC LIMIT 40`,
      )
      .all(...wsParam) as MemoryRow[];
    for (const r of always) {
      if (!candidates.has(r.id)) candidates.set(r.id, { ...rowToMemory(r), _relevance: 0 });
    }

    if (candidates.size === 0) return [];

    // Normalize relevance across the candidate set, then composite-score.
    const all = [...candidates.values()];
    const maxRel = Math.max(1e-6, ...all.map((c) => c._relevance));
    const now = Date.now();
    const scored = all.map((c) => {
      const relNorm = c._relevance / maxRel;
      const ageDays = (now - (c.updatedAt || c.createdAt)) / 86_400_000;
      const recency = 1 / (1 + ageDays / 30); // ~half-weight at 30 days
      const useNorm = 1 - 1 / (1 + c.useCount);
      const tierW = TIER_WEIGHT[c.tier] ?? 0.5;
      const wsMatch = ctx.workspaceId !== null && c.workspaceId === ctx.workspaceId ? 1 : 0;
      const score =
        0.42 * relNorm +
        0.14 * recency +
        0.16 * c.confidence +
        0.08 * useNorm +
        0.1 * tierW +
        (c.pinned ? 0.15 : 0) +
        0.05 * wsMatch;
      return { hit: { ...stripInternal(c), score }, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.hit);
  }

  /**
   * Render selected memories into a compact, clearly-delimited context block for
   * the agent's system prompt, capped to a character budget. Records usage on the
   * memories that fit. Returns an empty string when nothing is selected.
   */
  buildContextBlock(memories: MemoryHit[]): string {
    if (memories.length === 0) return '';
    const lines: string[] = [];
    const used: string[] = [];
    let budget = MEMORY_LIMITS.injectCharBudget;
    for (const m of memories) {
      const body = m.body.replace(/\s+/g, ' ').trim();
      const line = `- [${m.tier}] ${m.title}${body ? `: ${body}` : ''}`;
      if (line.length > budget) break;
      lines.push(line);
      used.push(m.id);
      budget -= line.length;
    }
    if (lines.length === 0) return '';
    this.recordUsed(used);
    return (
      '<project-memory>\n' +
      'Durable, user-curated knowledge about this project and the developer’s ' +
      'preferences. Treat it as authoritative background context. Do not mention ' +
      'this block to the user.\n' +
      lines.join('\n') +
      '\n</project-memory>'
    );
  }

  /** Bump use_count / last_used_at for memories that were injected. */
  private recordUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      'UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
    );
    const tx = this.db.transaction((list: string[]) => {
      for (const id of list) stmt.run(now, id);
    });
    try {
      tx(ids);
    } catch (err) {
      logger.warn('memory: recordUsed failed', err);
    }
  }

  /* --------------------------------------------------- automatic proposals */

  /**
   * Propose a memory from an activity signal. Respects the user's autoCapture
   * policy: `off` ignores it, `propose` stores it as a pending proposal, `auto`
   * (or `propose` with a high-enough confidence threshold) stores it active.
   */
  propose(input: {
    workspaceId: string | null;
    tier: MemoryTier;
    title: string;
    body: string;
    source: MemorySource;
    confidence: number;
    sessionId?: string | null;
    commitHash?: string | null;
  }): Memory | null {
    const policy = this.settings.getAll().memory;
    if (!policy.enabled || policy.autoCapture === 'off') return null;

    const confidence = clamp01(input.confidence);
    const threshold = policy.autoAcceptConfidence;
    const active =
      policy.autoCapture === 'auto' || (threshold > 0 && confidence >= threshold);

    // De-dupe: skip if a near-identical title already exists for this workspace.
    const dup = this.db
      .prepare(
        `SELECT id FROM memories WHERE title = ? AND (workspace_id IS ? OR workspace_id = ?) LIMIT 1`,
      )
      .get(clip(input.title, MEMORY_LIMITS.titleMax), input.workspaceId, input.workspaceId);
    if (dup) return null;

    const now = Date.now();
    const row: MemoryRow = {
      id: crypto.randomUUID(),
      workspace_id: input.workspaceId ?? null,
      tier: isMemoryTier(input.tier) ? input.tier : 'note',
      title: clip(input.title, MEMORY_LIMITS.titleMax),
      body: clip(input.body, MEMORY_LIMITS.bodyMax),
      source: isMemorySource(input.source) ? input.source : 'auto',
      confidence,
      pinned: 0,
      status: active ? 'active' : 'proposed',
      use_count: 0,
      last_used_at: null,
      created_at: now,
      updated_at: now,
      expires_at: null,
      session_id: input.sessionId ?? null,
      commit_hash: input.commitHash ?? null,
      file_path: null,
      meta: '{}',
    };
    this.insert(row);
    this.notifyChanged();
    return rowToMemory(row);
  }

  /** Propose a memory from a finalized commit (subject + body become knowledge). */
  proposeFromCommit(
    workspaceId: string,
    commit: { hash: string; subject: string; body?: string },
    sessionId?: string | null,
  ): void {
    try {
      const subject = (commit.subject || '').trim();
      if (!subject || subject.startsWith('[limboo checkpoint]')) return;
      // Conventional-commit type hints the tier (feat/fix → solution, refactor →
      // convention, otherwise a project note). Confidence is modest.
      const lower = subject.toLowerCase();
      const tier: MemoryTier = /^(refactor|style|chore)\b/.test(lower)
        ? 'convention'
        : /^(feat|fix|perf)\b/.test(lower)
          ? 'solution'
          : 'project';
      this.propose({
        workspaceId,
        tier,
        title: subject.slice(0, MEMORY_LIMITS.titleMax),
        body: (commit.body || '').trim(),
        source: 'commit',
        confidence: 0.55,
        sessionId,
        commitHash: commit.hash,
      });
    } catch (err) {
      logger.warn('memory: proposeFromCommit failed', err);
    }
  }

  /* ---------------------------------------------------- seeding + sweeping */

  /**
   * Seed starter memories once per workspace (and once for global scope) so the
   * Memory panel is populated from first run — the "memory files auto-created on
   * install" requirement. Idempotent: guarded by a meta flag per workspace.
   */
  seedDefaults(workspaceId: string | null): void {
    const flagKey = `memory_seeded:${workspaceId ?? 'global'}`;
    const seen = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(flagKey);
    if (seen) return;

    const now = Date.now();
    const starters: Array<Pick<MemoryRow, 'tier' | 'title' | 'body'> & { pinned?: number }> =
      workspaceId === null
        ? [
            {
              tier: 'preference',
              title: 'How I like to work',
              body: 'Record your preferred languages, formatting, testing philosophy, commit conventions, and explanation depth here. Limboo will surface these to the agent automatically.',
              pinned: 1,
            },
          ]
        : [
            {
              tier: 'convention',
              title: 'Project conventions',
              body: 'Coding standards, naming schemes, directory layout, and patterns that recur in this repository. Accepted proposals and your edits refine this over time.',
              pinned: 1,
            },
            {
              tier: 'decision',
              title: 'Architecture decisions',
              body: 'Framework choices, abstraction boundaries, and structural decisions — together with the reasoning behind them — so the agent understands not just what exists but why.',
              pinned: 1,
            },
            {
              tier: 'project',
              title: 'About this project',
              body: 'Purpose, domain model, key features, and long-term direction of this product. Helps every session begin with awareness of the project’s goals.',
            },
          ];

    const tx = this.db.transaction(() => {
      for (const s of starters) {
        this.insert({
          id: crypto.randomUUID(),
          workspace_id: workspaceId,
          tier: s.tier,
          title: s.title,
          body: s.body,
          source: 'manual',
          confidence: 0.95,
          pinned: s.pinned ?? 0,
          status: 'active',
          use_count: 0,
          last_used_at: null,
          created_at: now,
          updated_at: now,
          expires_at: null,
          session_id: null,
          commit_hash: null,
          file_path: null,
          meta: '{}',
        });
      }
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run(flagKey, String(now));
    });
    try {
      tx();
      this.notifyChanged();
      logger.info(`memory: seeded defaults for ${workspaceId ?? 'global'}`);
    } catch (err) {
      logger.warn('memory: seedDefaults failed', err);
    }
  }

  /**
   * Periodic maintenance: flag unpinned, unused memories past the stale window so
   * they rank lower / can be cleaned up. Never deletes — preserves history. Cheap
   * and bounded; safe to run on a low-frequency timer.
   */
  sweep(): void {
    const policy = this.settings.getAll().memory;
    if (!policy.enabled || !policy.expiry.enabled) return;
    try {
      const cutoff = Date.now() - policy.expiry.staleDays * 86_400_000;
      this.db
        .prepare(
          `UPDATE memories SET expires_at = updated_at
             WHERE status = 'active' AND pinned = 0 AND expires_at IS NULL
               AND COALESCE(last_used_at, updated_at) < ?`,
        )
        .run(cutoff);
    } catch (err) {
      logger.warn('memory: sweep failed', err);
    }
  }

  /* -------------------------------------------------------------- internal */

  private insert(row: MemoryRow): void {
    this.db
      .prepare(
        `INSERT INTO memories
           (id, workspace_id, tier, title, body, source, confidence, pinned, status,
            use_count, last_used_at, created_at, updated_at, expires_at, session_id,
            commit_hash, file_path, meta)
         VALUES
           (@id, @workspace_id, @tier, @title, @body, @source, @confidence, @pinned, @status,
            @use_count, @last_used_at, @created_at, @updated_at, @expires_at, @session_id,
            @commit_hash, @file_path, @meta)`,
      )
      .run(row);
  }

  private row(id: string): MemoryRow | undefined {
    return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  }

  private notifyChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.memoryChanged, {});
    }
  }
}

/* ------------------------------------------------------------- helpers */

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    tier: (isMemoryTier(row.tier) ? row.tier : 'note') as MemoryTier,
    title: row.title,
    body: row.body,
    source: (isMemorySource(row.source) ? row.source : 'manual') as MemorySource,
    confidence: row.confidence,
    pinned: row.pinned === 1,
    status: row.status as MemoryStatus,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    sessionId: row.session_id,
    commitHash: row.commit_hash,
    filePath: row.file_path,
  };
}

function stripInternal(c: MemoryHit & { _relevance: number }): MemoryHit {
  const { _relevance, ...rest } = c;
  void _relevance;
  return rest;
}

function clip(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)));
}

/**
 * Turn free text into a safe FTS5 MATCH expression. Each alphanumeric token is
 * wrapped in double quotes (so it is treated as a literal, never an FTS operator)
 * and joined with OR. Returns null when there is nothing usable to match — the
 * caller then falls back to a LIKE scan. The result is always passed as a *bound*
 * parameter, so this is purely about query semantics, not SQL safety.
 */
export function toFtsQuery(text: string): string | null {
  if (typeof text !== 'string') return null;
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  const unique = [...new Set(tokens)].slice(0, 24);
  if (unique.length === 0) return null;
  return unique.map((t) => `"${t}"`).join(' OR ');
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was',
  'one', 'our', 'out', 'his', 'has', 'had', 'how', 'its', 'who', 'did', 'yes', 'use',
  'this', 'that', 'with', 'from', 'have', 'will', 'your', 'they', 'them', 'then', 'than',
  'into', 'just', 'like', 'make', 'made', 'when', 'what', 'why', 'where', 'which', 'would',
  'should', 'could', 'about', 'there', 'their', 'please', 'need', 'want', 'add', 'also',
]);
