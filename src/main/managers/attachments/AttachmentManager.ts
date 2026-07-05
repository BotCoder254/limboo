/**
 * Attachment Manager — the single owner of user-attached files.
 *
 * Files attached in the composer (picker / drag-drop / paste) become
 * session-owned workspace resources: validated, hashed (SHA-256), MIME-sniffed,
 * copied into a per-session staging directory under
 * `userData/attachments/<sessionId>/`, and recorded in `limboo.db`. The agent
 * never receives raw attachment bytes in the prompt — it gets a compact
 * manifest plus read access to the staging dir and pulls content on demand
 * through its tool loop (images may additionally ride as vision blocks).
 *
 * Security (CLAUDE.md §6): the renderer never touches the filesystem; every
 * source path is realpath-resolved (symlink-safe) and must be a regular file
 * outside Limboo's own data dir; sizes/counts/lengths are capped; stored names
 * are generated main-side; elevated-risk extensions are blocked by policy;
 * archives are never extracted; SQL uses bound parameters only; staging writes
 * are atomic (temp sibling + rename). Attaching NEVER executes anything.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron';
import { IpcEvents } from '@shared/ipc-channels';
import { ATTACHMENT_LIMITS } from '@shared/constants';
import type {
  AttachmentMeta,
  AttachmentOrigin,
  AttachmentProgress,
  AttachmentStatus,
} from '@shared/types';
import { getDb } from '../../db/database';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { SessionManager } from '../SessionManager';
import {
  AttachmentError,
  classifyCategory,
  classifyRisk,
  imageMagicMatches,
  looksBinary,
  mimeFor,
  sanitizeName,
  VISION_MEDIA_TYPES,
} from './validate';

/** Session ids are UUID-shaped; validated before ever joining into a path. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Attachment ids are generated main-side (randomUUID). */
const ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Bytes sniffed from the head of a staged file for magic/NUL checks. */
const SNIFF_BYTES = 16;

/** One image content block for the Messages API (vision). */
export interface AttachmentImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

interface AttachmentRow {
  id: string;
  session_id: string;
  workspace_id: string;
  name: string;
  stored_name: string;
  mime: string;
  category: string;
  size: number;
  sha256: string;
  status: string;
  origin: string;
  risk: string;
  message_id: string | null;
  thumb: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    name: row.name,
    storedName: row.stored_name,
    mime: row.mime,
    category: row.category as AttachmentMeta['category'],
    size: row.size,
    sha256: row.sha256,
    status: row.status as AttachmentStatus,
    origin: row.origin as AttachmentOrigin,
    risk: row.risk as AttachmentMeta['risk'],
    messageId: row.message_id,
    thumb: row.thumb ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AttachmentManager {
  private readonly db = getDb();

  /** Root of all per-session staging dirs: `userData/attachments`. */
  private readonly root: string;

  /** One native picker at a time (mirrors workspace:pickDirectory). */
  private pickerOpen = false;

  constructor(
    private readonly sessions: SessionManager,
    private readonly settings: SettingsManager,
  ) {
    this.root = path.join(app.getPath('userData'), 'attachments');
  }

  /* ---------------------------------------------------------------- */
  /* Paths                                                             */
  /* ---------------------------------------------------------------- */

  /** Absolute per-session staging dir. Validates the id before joining. */
  sessionDir(sessionId: string): string {
    if (!SESSION_ID_RE.test(sessionId)) throw new AttachmentError('Invalid session id.');
    return path.join(this.root, sessionId);
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  list(sessionId: string): AttachmentMeta[] {
    if (!SESSION_ID_RE.test(sessionId)) return [];
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at')
      .all(sessionId) as AttachmentRow[];
    return rows.map(rowToMeta);
  }

  /** Attachments not yet bound to a sent message (the composer strip). */
  listDrafts(sessionId: string): AttachmentMeta[] {
    return this.list(sessionId).filter((a) => a.messageId === null);
  }

  /** True when the session has any staged attachment (drives additionalDirectories). */
  hasAny(sessionId: string): boolean {
    if (!SESSION_ID_RE.test(sessionId)) return false;
    const row = this.db
      .prepare('SELECT 1 AS one FROM attachments WHERE session_id = ? LIMIT 1')
      .get(sessionId) as { one: number } | undefined;
    return !!row;
  }

  /** Metas for the given ids, restricted to the session (foreign ids dropped). */
  private byIds(sessionId: string, ids: string[]): AttachmentMeta[] {
    const all = new Map(this.list(sessionId).map((a) => [a.id, a]));
    const out: AttachmentMeta[] = [];
    for (const id of ids) {
      const meta = typeof id === 'string' && ATTACHMENT_ID_RE.test(id) ? all.get(id) : undefined;
      if (meta && meta.status !== 'error' && meta.status !== 'uploading') out.push(meta);
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Ingest                                                            */
  /* ---------------------------------------------------------------- */

  /** Open the native multi-file picker, then stage the selection. */
  async pickAndAdd(sessionId: string): Promise<AttachmentMeta[]> {
    if (this.pickerOpen) return [];
    this.pickerOpen = true;
    try {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      const opts = {
        title: 'Attach files',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return [];
      return await this.addFromPaths(sessionId, result.filePaths, 'pick');
    } finally {
      this.pickerOpen = false;
    }
  }

  /**
   * Stage absolute source paths (picker / drop). Per-file failures do not abort
   * the batch: successes stage + broadcast, then one error summarizing the
   * failures is thrown for the renderer toast.
   */
  async addFromPaths(
    sessionId: string,
    paths: string[],
    origin: 'pick' | 'drop',
  ): Promise<AttachmentMeta[]> {
    const cfg = this.gate(sessionId);
    if (!Array.isArray(paths) || paths.length === 0) return [];
    if (paths.length > cfg.maxFilesPerMessage) {
      throw new AttachmentError(`At most ${cfg.maxFilesPerMessage} files per message.`);
    }

    const added: AttachmentMeta[] = [];
    const failures: string[] = [];
    for (const p of paths) {
      try {
        added.push(await this.stageOne(sessionId, p, origin));
      } catch (err) {
        const name = typeof p === 'string' ? path.basename(p) : 'file';
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length > 0) {
      throw new AttachmentError(failures.join(' · '));
    }
    return added;
  }

  /** Stage pasted image bytes (renderer clipboard, already size-capped at IPC). */
  async addFromBytes(
    sessionId: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
  ): Promise<AttachmentMeta> {
    const cfg = this.gate(sessionId);
    if (!cfg.categories.images) throw new AttachmentError('Image attachments are disabled.');
    const buf = Buffer.from(bytes);
    if (buf.length === 0) throw new AttachmentError('Empty image.');
    if (buf.length > ATTACHMENT_LIMITS.pasteBytesMax || buf.length > cfg.maxFileSizeMB * 1024 * 1024) {
      throw new AttachmentError(`Image exceeds the ${cfg.maxFileSizeMB} MB limit.`);
    }
    if (!VISION_MEDIA_TYPES.has(mime)) throw new AttachmentError('Unsupported image type.');
    if (!imageMagicMatches(mime, buf.subarray(0, SNIFF_BYTES))) {
      throw new AttachmentError('Image data does not match its type.');
    }
    this.assertSessionCap(sessionId, 1, cfg.maxTotalPerSession);

    const safeName = sanitizeName(name || `pasted-${Date.now()}.png`);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = this.findByHash(sessionId, sha256);
    if (existing) return this.touch(existing);

    const session = this.sessions.get(sessionId);
    if (!session) throw new AttachmentError('Unknown session.');

    const dir = this.ensureDir(sessionId);
    const storedName = `${sha256.slice(0, 12)}-${safeName}`;
    const finalPath = path.join(dir, storedName);
    const tmp = path.join(dir, `.limboo-tmp-${crypto.randomBytes(6).toString('hex')}`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, finalPath);

    const meta = this.insertRow({
      sessionId,
      workspaceId: session.workspaceId,
      name: safeName,
      storedName,
      mime,
      category: 'image',
      size: buf.length,
      sha256,
      status: 'ready',
      origin: 'paste',
      risk: 'safe',
      thumb: this.makeThumb(finalPath),
    });
    this.broadcast(sessionId);
    return meta;
  }

  /** Remove one attachment: unlink the staged copy, delete the row. */
  remove(sessionId: string, id: string): void {
    const meta = this.byIds(sessionId, [id])[0] ?? this.list(sessionId).find((a) => a.id === id);
    if (!meta) return;
    try {
      fs.rmSync(path.join(this.sessionDir(sessionId), meta.storedName), { force: true });
    } catch (err) {
      logger.warn(`Attachment unlink failed for ${meta.storedName}`, err);
    }
    this.db.prepare('DELETE FROM attachments WHERE id = ? AND session_id = ?').run(id, sessionId);
    this.broadcast(sessionId);
  }

  /** Reveal the staged copy in the OS file manager. */
  reveal(sessionId: string, id: string): void {
    const meta = this.list(sessionId).find((a) => a.id === id);
    if (!meta) return;
    const target = path.join(this.sessionDir(sessionId), meta.storedName);
    if (fs.existsSync(target)) shell.showItemInFolder(target);
  }

  /* ---------------------------------------------------------------- */
  /* Message binding + agent lifecycle                                 */
  /* ---------------------------------------------------------------- */

  /** Bind composer drafts to the sent user message; status → 'referenced'. */
  attachToMessage(sessionId: string, ids: string[], messageId: string): AttachmentMeta[] {
    const metas = this.byIds(sessionId, ids).filter((a) => a.messageId === null);
    if (metas.length === 0) return [];
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE attachments SET message_id = ?, status = 'referenced', updated_at = ?
       WHERE id = ? AND session_id = ? AND message_id IS NULL`,
    );
    for (const meta of metas) stmt.run(messageId, now, meta.id, sessionId);
    this.broadcast(sessionId);
    return this.byIds(sessionId, metas.map((m) => m.id));
  }

  /** A read tool touched a staged path → mark that attachment 'read'. */
  markReadByPath(sessionId: string, absPath: string): void {
    if (!SESSION_ID_RE.test(sessionId)) return;
    const storedName = path.basename(absPath);
    const changed = this.db
      .prepare(
        `UPDATE attachments SET status = 'read', updated_at = ?
         WHERE session_id = ? AND stored_name = ? AND status IN ('ready', 'referenced')`,
      )
      .run(Date.now(), sessionId, storedName);
    if (changed.changes > 0) this.broadcast(sessionId);
  }

  /**
   * Render the `<attachments>` manifest appended to the SDK prompt (never the
   * persisted transcript). Lists the staged files so the agent reads them on
   * demand with its tools instead of assuming contents.
   */
  manifestFor(sessionId: string, ids: string[]): string | undefined {
    const metas = this.byIds(sessionId, ids);
    if (metas.length === 0) return undefined;
    const dir = this.sessionDir(sessionId);
    const header =
      `<attachments dir="${dir}">\n` +
      'The user attached these files. They are staged on disk — read the ones you ' +
      'need with the Read/Grep tools (never assume contents). Do not modify them.\n';
    const footer = '</attachments>';
    const lines: string[] = [];
    let budget = ATTACHMENT_LIMITS.manifestCharBudget - header.length - footer.length - 64;
    let omitted = 0;
    for (const meta of metas) {
      const visionNote =
        meta.category === 'image' && VISION_MEDIA_TYPES.has(meta.mime)
          ? ' (also provided inline as an image)'
          : '';
      const line =
        `- name="${meta.name}" type=${meta.mime} category=${meta.category} size=${meta.size}` +
        `${visionNote}\n  path="${path.join(dir, meta.storedName)}"\n`;
      if (line.length > budget) {
        omitted += 1;
        continue;
      }
      budget -= line.length;
      lines.push(line);
    }
    const tail = omitted > 0 ? `(+${omitted} more attachments not listed)\n` : '';
    return `${header}${lines.join('')}${tail}${footer}`;
  }

  /**
   * Base64 image content blocks for the vision send. Oversized images are
   * downscaled via nativeImage; anything still above the API cap is skipped
   * (it remains readable through the manifest path).
   */
  imageBlocksFor(sessionId: string, ids: string[]): AttachmentImageBlock[] {
    const cfg = this.settings.getAll().attachments;
    if (!cfg.images.attachAsVision) return [];
    const dir = this.sessionDir(sessionId);
    const blocks: AttachmentImageBlock[] = [];
    for (const meta of this.byIds(sessionId, ids)) {
      if (meta.category !== 'image' || !VISION_MEDIA_TYPES.has(meta.mime)) continue;
      const file = path.join(dir, meta.storedName);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(file);
      } catch {
        continue;
      }
      let mediaType = meta.mime;
      const threshold = cfg.images.downscaleThresholdMB * 1024 * 1024;
      if (buf.length > threshold) {
        const img = nativeImage.createFromPath(file);
        if (!img.isEmpty()) {
          const { width, height } = img.getSize();
          const scale = Math.sqrt(threshold / buf.length);
          const resized = img.resize({
            width: Math.max(64, Math.round(width * scale)),
            height: Math.max(64, Math.round(height * scale)),
          });
          buf = resized.toJPEG(80);
          mediaType = 'image/jpeg';
        }
      }
      if (buf.length > ATTACHMENT_LIMITS.imageVisionMaxBytes) {
        logger.warn(`Attachment ${meta.name} exceeds the vision size cap after downscale; manifest-only.`);
        continue;
      }
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
      });
    }
    return blocks;
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                          */
  /* ---------------------------------------------------------------- */

  /** Permanently delete a session's staged files + rows (session purge). */
  async purgeSession(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`Attachment purge failed for ${sessionId}`, err);
    }
    this.db.prepare('DELETE FROM attachments WHERE session_id = ?').run(sessionId);
  }

  /**
   * Boot-time sweep: remove staging dirs whose session row no longer exists
   * (covers purges that crashed mid-way). Trashed sessions keep their files.
   */
  async sweepOrphans(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.root, { withFileTypes: true });
    } catch {
      return; // No staging root yet.
    }
    const rows = this.db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
    const liveSessionIds = new Set(rows.map((r) => r.id));
    for (const entry of entries) {
      if (!entry.isDirectory() || liveSessionIds.has(entry.name)) continue;
      if (!SESSION_ID_RE.test(entry.name)) continue;
      try {
        await fs.promises.rm(path.join(this.root, entry.name), { recursive: true, force: true });
        this.db.prepare('DELETE FROM attachments WHERE session_id = ?').run(entry.name);
        logger.info(`Swept orphaned attachment dir ${entry.name}`);
      } catch (err) {
        logger.warn(`Orphan sweep failed for ${entry.name}`, err);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  /** Master-switch + per-call settings snapshot. */
  private gate(sessionId: string) {
    const cfg = this.settings.getAll().attachments;
    if (!cfg.enabled) throw new AttachmentError('Attachments are disabled in Settings.');
    if (!SESSION_ID_RE.test(sessionId)) throw new AttachmentError('Invalid session id.');
    return cfg;
  }

  private assertSessionCap(sessionId: string, adding: number, maxTotal: number): void {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM attachments WHERE session_id = ?')
      .get(sessionId) as { n: number };
    if (row.n + adding > maxTotal) {
      throw new AttachmentError(`Session attachment limit (${maxTotal}) reached.`);
    }
  }

  private findByHash(sessionId: string, sha256: string): AttachmentMeta | undefined {
    const row = this.db
      .prepare('SELECT * FROM attachments WHERE session_id = ? AND sha256 = ?')
      .get(sessionId, sha256) as AttachmentRow | undefined;
    return row ? rowToMeta(row) : undefined;
  }

  /** Bump updated_at on a deduped hit and return the existing row. */
  private touch(meta: AttachmentMeta): AttachmentMeta {
    this.db
      .prepare('UPDATE attachments SET updated_at = ? WHERE id = ?')
      .run(Date.now(), meta.id);
    this.broadcast(meta.sessionId);
    return { ...meta, updatedAt: Date.now() };
  }

  private ensureDir(sessionId: string): string {
    const dir = this.sessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Full validation + staging pipeline for one source file. Inserts a
   * placeholder 'uploading' row first so the chip renders with a progress ring,
   * then finalizes (or removes) it.
   */
  private async stageOne(
    sessionId: string,
    sourcePath: string,
    origin: AttachmentOrigin,
  ): Promise<AttachmentMeta> {
    const cfg = this.settings.getAll().attachments;
    if (typeof sourcePath !== 'string' || sourcePath.length === 0 || sourcePath.length > ATTACHMENT_LIMITS.pathMax) {
      throw new AttachmentError('Invalid path.');
    }
    if (sourcePath.includes('\0')) throw new AttachmentError('Invalid path.');

    // Resolve symlinks and require a regular file outside our own data dir.
    let real: string;
    try {
      real = fs.realpathSync(sourcePath);
    } catch {
      throw new AttachmentError('File does not exist or is not accessible.');
    }
    let userData: string;
    try {
      userData = fs.realpathSync(app.getPath('userData'));
    } catch {
      userData = app.getPath('userData');
    }
    const rel = path.relative(userData, real);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new AttachmentError("Cannot attach files from Limboo's own data directory.");
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(real);
    } catch {
      throw new AttachmentError('Could not read that path.');
    }
    if (!stat.isFile()) throw new AttachmentError('Not a regular file.');
    if (stat.size > cfg.maxFileSizeMB * 1024 * 1024) {
      throw new AttachmentError(`Exceeds the ${cfg.maxFileSizeMB} MB limit.`);
    }
    if (stat.size === 0) throw new AttachmentError('File is empty.');

    const name = sanitizeName(path.basename(sourcePath));
    let category = classifyCategory(name);
    const risk = classifyRisk(name);
    if (risk === 'elevated' && cfg.elevatedRiskPolicy === 'block') {
      throw new AttachmentError('Executable/script files are blocked (Settings › Attachments).');
    }
    const allowed =
      category === 'image' ? cfg.categories.images
      : category === 'code' ? cfg.categories.code
      : category === 'archive' ? cfg.categories.archives
      : category === 'document' || category === 'data' ? cfg.categories.documents
      : true;
    if (!allowed) throw new AttachmentError(`${category} attachments are disabled in Settings.`);

    // Head sniff: image magic consistency + text/binary confusion.
    const mime = mimeFor(name, category);
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, stat.size));
    const fd = fs.openSync(real, 'r');
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (category === 'image' && VISION_MEDIA_TYPES.has(mime) && !imageMagicMatches(mime, head)) {
      throw new AttachmentError('Image data does not match its extension.');
    }
    if ((category === 'code' || category === 'document' || category === 'data') && looksBinary(head)) {
      category = 'other';
    }

    this.assertSessionCap(sessionId, 1, cfg.maxTotalPerSession);
    const session = this.sessions.get(sessionId);
    if (!session) throw new AttachmentError('Unknown session.');

    // Placeholder row so the chip renders immediately with a progress ring.
    // sha256 gets a unique placeholder until hashing completes (dedupe index).
    const id = crypto.randomUUID();
    const uploading = this.insertRow({
      id,
      sessionId,
      workspaceId: session.workspaceId,
      name,
      storedName: '',
      mime,
      category,
      size: stat.size,
      sha256: `pending-${id}`,
      status: 'uploading',
      origin,
      risk,
    });
    this.broadcast(sessionId);

    const dir = this.ensureDir(sessionId);
    const tmp = path.join(dir, `.limboo-tmp-${crypto.randomBytes(6).toString('hex')}`);
    try {
      const sha256 = await this.hashCopy(sessionId, id, real, tmp, stat.size);

      const existing = this.findByHash(sessionId, sha256);
      if (existing) {
        // Same content already staged — drop the temp + placeholder row.
        await fs.promises.rm(tmp, { force: true });
        this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
        return this.touch(existing);
      }

      const storedName = `${sha256.slice(0, 12)}-${name}`;
      const finalPath = path.join(dir, storedName);
      fs.renameSync(tmp, finalPath);
      const thumb = category === 'image' ? this.makeThumb(finalPath) : undefined;
      this.db
        .prepare(
          `UPDATE attachments SET stored_name = ?, sha256 = ?, status = 'ready',
             thumb = ?, updated_at = ? WHERE id = ?`,
        )
        .run(storedName, sha256, thumb ?? null, Date.now(), id);
      this.broadcast(sessionId);
      return { ...uploading, storedName, sha256, status: 'ready', thumb, updatedAt: Date.now() };
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      this.broadcast(sessionId);
      throw err;
    }
  }

  /** Stream source → temp while hashing, pushing throttled progress events. */
  private async hashCopy(
    sessionId: string,
    id: string,
    source: string,
    dest: string,
    total: number,
  ): Promise<string> {
    const hash = crypto.createHash('sha256');
    let copied = 0;
    let lastPush = 0;
    const push = (percent: number) => {
      const now = Date.now();
      if (now - lastPush < ATTACHMENT_LIMITS.progressThrottleMs && percent < 100) return;
      lastPush = now;
      const progress: AttachmentProgress = { sessionId, id, percent };
      this.send(IpcEvents.attachmentProgress, progress);
    };
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        copied += chunk.length;
        push(Math.min(100, Math.round((copied / total) * 100)));
        cb(null, chunk);
      },
    });
    await pipeline(fs.createReadStream(source), meter, fs.createWriteStream(dest, { flags: 'wx' }));
    push(100);
    return hash.digest('hex');
  }

  /** Tiny data-URL thumbnail via nativeImage (images only; SVG unsupported). */
  private makeThumb(file: string): string | undefined {
    try {
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return undefined;
      const url = img.resize({ height: ATTACHMENT_LIMITS.thumbEdgePx }).toDataURL();
      return url.length <= ATTACHMENT_LIMITS.thumbDataUrlMax ? url : undefined;
    } catch {
      return undefined;
    }
  }

  private insertRow(input: {
    id?: string;
    sessionId: string;
    workspaceId: string;
    name: string;
    storedName: string;
    mime: string;
    category: string;
    size: number;
    sha256: string;
    status: AttachmentStatus;
    origin: AttachmentOrigin;
    risk: 'safe' | 'elevated';
    thumb?: string;
  }): AttachmentMeta {
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO attachments
           (id, session_id, workspace_id, name, stored_name, mime, category, size,
            sha256, status, origin, risk, message_id, thumb, error, meta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, '{}', ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.workspaceId,
        input.name,
        input.storedName,
        input.mime,
        input.category,
        input.size,
        input.sha256,
        input.status,
        input.origin,
        input.risk,
        input.thumb ?? null,
        now,
        now,
      );
    return {
      id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      name: input.name,
      storedName: input.storedName,
      mime: input.mime,
      category: input.category as AttachmentMeta['category'],
      size: input.size,
      sha256: input.sha256,
      status: input.status,
      origin: input.origin,
      risk: input.risk,
      messageId: null,
      thumb: input.thumb,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Push the session's full attachment set to every window. */
  private broadcast(sessionId: string): void {
    this.send(IpcEvents.attachmentsChanged, {
      sessionId,
      attachments: this.list(sessionId),
    });
  }

  private send(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}
