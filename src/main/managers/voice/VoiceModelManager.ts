/**
 * VoiceModelManager — owns the local speech-model store at
 * `{userData}/models/local-speech/`: resumable downloads, SHA-256 verification,
 * path-traversal-safe extraction, atomic installs, and integrity re-checks.
 *
 * Security contract (CLAUDE.md §6):
 * - Network: HTTPS only, host allowlist, redirects followed manually (max 5)
 *   and re-validated per hop, and every DNS resolution is checked against
 *   private/loopback/link-local ranges via a custom `lookup` (no TOCTOU).
 * - Downloads are size-capped, verified against the pinned registry SHA-256,
 *   and extracted with per-entry validation (no absolute paths, no `..`, no
 *   links, bounded entry count) into a temp dir that is atomically renamed.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { app, BrowserWindow, shell } from 'electron';
import * as tar from 'tar-fs';
import bz2 from 'unbzip2-stream';
import { IpcEvents } from '@shared/ipc-channels';
import type { VoiceModelId, VoiceModelState } from '@shared/types';
import { VOICE_LIMITS } from '@shared/constants';
import { VOICE_MODELS, voiceModelSpec } from '@shared/voice-models';
import type { VoiceModelSpec } from '@shared/voice-models';
import { logger } from '../../logger';

/** Hosts a model download may touch (GitHub release assets + their CDN). */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const MAX_REDIRECTS = 5;

/** Sidecar next to a partial download: resume bookkeeping. */
interface PartialSidecar {
  url: string;
  etag?: string;
  receivedBytes: number;
}

/** On-disk manifest written into every installed model dir. */
interface InstallManifest {
  id: VoiceModelId;
  rev: number;
  /** SHA-256 of the downloaded archive/asset. */
  archiveSha256: string;
  installedAt: number;
  totalBytes: number;
  /** Per-file integrity: relative path -> { bytes, sha256 }. */
  files: Record<string, { bytes: number; sha256: string }>;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a >= 224 // multicast / reserved
  );
}

function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind !== 6) return true;
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') || // fc00::/7 unique-local
    lower.startsWith('fd') ||
    lower.startsWith('fe8') || // fe80::/10 link-local
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}

/** Reject a URL unless it is https on an allowlisted host. */
function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`Blocked non-HTTPS download URL: ${url.protocol}`);
  if (url.username || url.password) throw new Error('Blocked download URL with credentials');
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Blocked download host: ${url.hostname}`);
  }
  return url;
}

/**
 * `lookup` implementation passed to https.request so the address the socket
 * actually connects to is validated — not just a pre-check that could race.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [], 4);
    const list = Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad) {
      return callback(
        new Error(`Blocked download: ${hostname} resolves to a private address`),
        [],
        4,
      );
    }
    // Match the caller's `all` expectation.
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export class VoiceModelManager {
  private readonly baseDir: string;
  private readonly partialDir: string;
  /** Live UI state per model id. */
  private readonly states = new Map<VoiceModelId, VoiceModelState>();
  /** Coalesce concurrent downloads of the same model. */
  private readonly downloads = new Map<VoiceModelId, Promise<void>>();
  /** Abort handles for pause/cancel. */
  private readonly aborts = new Map<VoiceModelId, AbortController>();
  /** Marks whether an abort was a pause (keep partial) or a cancel (delete). */
  private readonly abortReason = new Map<VoiceModelId, 'pause' | 'cancel'>();
  private readonly lastProgressPush = new Map<VoiceModelId, number>();
  private disposed = false;

  constructor() {
    this.baseDir = path.join(app.getPath('userData'), 'models', 'local-speech');
    this.partialDir = path.join(this.baseDir, '.partial');
    fs.mkdirSync(this.partialDir, { recursive: true });
    for (const spec of VOICE_MODELS) this.states.set(spec.id, this.scanState(spec));
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  list(): VoiceModelState[] {
    return VOICE_MODELS.map((spec) => this.states.get(spec.id) ?? this.scanState(spec));
  }

  isInstalled(id: VoiceModelId): boolean {
    return this.states.get(id)?.phase === 'installed';
  }

  /** Absolute install directory for a model (exists only when installed). */
  installDir(id: VoiceModelId): string {
    return path.join(this.baseDir, id);
  }

  /** The models root (for "reveal in file manager"). */
  revealDir(): void {
    void shell.openPath(this.baseDir);
  }

  /** Kick off downloads for missing models when the auto-download pref is on. */
  autoDownloadMissing(): void {
    for (const spec of VOICE_MODELS) {
      const state = this.states.get(spec.id);
      if (state && (state.phase === 'not-installed' || state.phase === 'paused')) {
        this.download(spec.id).catch((err) => {
          logger.warn(`voice: auto-download of ${spec.id} failed`, err);
        });
      }
    }
  }

  /** Download (or resume) + verify + install one model. Coalesced per id. */
  download(id: VoiceModelId, opts?: { offlineOnly?: boolean }): Promise<void> {
    const spec = voiceModelSpec(id);
    if (!spec) return Promise.reject(new Error(`Unknown voice model: ${id}`));
    if (opts?.offlineOnly) {
      return Promise.reject(new Error('Offline-only mode is enabled in Voice settings'));
    }
    const inFlight = this.downloads.get(id);
    if (inFlight) return inFlight;

    const run = this.runDownload(spec).finally(() => this.downloads.delete(id));
    this.downloads.set(id, run);
    return run;
  }

  /** Pause an in-flight download, keeping the partial for a later resume. */
  pause(id: VoiceModelId): void {
    this.abortReason.set(id, 'pause');
    this.aborts.get(id)?.abort();
  }

  /** Cancel an in-flight (or paused) download and delete the partial. */
  async cancel(id: VoiceModelId): Promise<void> {
    this.abortReason.set(id, 'cancel');
    this.aborts.get(id)?.abort();
    await this.deletePartial(id);
    const spec = voiceModelSpec(id);
    if (spec && this.states.get(id)?.phase !== 'installed') {
      this.setState(id, this.freshState(spec, 'not-installed'), true);
    }
  }

  /** Remove an installed model (and any partials). */
  async remove(id: VoiceModelId): Promise<void> {
    const spec = voiceModelSpec(id);
    if (!spec) throw new Error(`Unknown voice model: ${id}`);
    this.abortReason.set(id, 'cancel');
    this.aborts.get(id)?.abort();
    await this.deletePartial(id);
    await fsp.rm(this.installDir(id), { recursive: true, force: true });
    this.setState(id, this.freshState(spec, 'not-installed'), true);
    this.broadcastList();
    logger.info(`voice: removed model ${id}`);
  }

  /** Re-hash an installed model against its manifest. */
  async verify(id: VoiceModelId): Promise<boolean> {
    const spec = voiceModelSpec(id);
    if (!spec) throw new Error(`Unknown voice model: ${id}`);
    const state = this.states.get(id);
    if (!state || state.phase !== 'installed') return false;
    this.setState(id, { ...state, phase: 'verifying', percent: undefined }, true);
    try {
      const manifest = this.readManifest(id);
      if (!manifest) throw new Error('manifest missing');
      for (const [rel, meta] of Object.entries(manifest.files)) {
        const file = this.safeJoin(this.installDir(id), rel);
        const hash = await hashFile(file);
        if (hash !== meta.sha256) throw new Error(`integrity mismatch: ${rel}`);
      }
      this.setState(id, { ...state, phase: 'installed' }, true);
      return true;
    } catch (err) {
      logger.warn(`voice: verify failed for ${id}`, err);
      this.setState(
        id,
        { ...state, phase: 'error', error: `Integrity check failed: ${String(err)}` },
        true,
      );
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, controller] of this.aborts) {
      this.abortReason.set(id, 'pause');
      controller.abort();
    }
  }

  /* ---------------------------------------------------------------- */
  /* State + broadcast                                                 */
  /* ---------------------------------------------------------------- */

  private freshState(
    spec: VoiceModelSpec,
    phase: VoiceModelState['phase'],
  ): VoiceModelState {
    return {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      description: spec.description,
      phase,
      totalBytes: spec.approxBytes,
    };
  }

  /** Derive the initial state of a model from what is on disk. */
  private scanState(spec: VoiceModelSpec): VoiceModelState {
    const manifest = this.readManifest(spec.id);
    if (manifest) {
      const layoutOk = spec.expects.every((rel) =>
        fs.existsSync(path.join(this.installDir(spec.id), rel)),
      );
      if (layoutOk) {
        return {
          ...this.freshState(spec, 'installed'),
          installedAt: manifest.installedAt,
          installedBytes: manifest.totalBytes,
          rev: manifest.rev,
          updateAvailable: manifest.rev < spec.rev,
        };
      }
    }
    const sidecar = this.readSidecar(spec.id);
    if (sidecar) {
      return {
        ...this.freshState(spec, 'paused'),
        receivedBytes: sidecar.receivedBytes,
        percent: Math.floor((sidecar.receivedBytes / spec.approxBytes) * 95),
      };
    }
    return this.freshState(spec, 'not-installed');
  }

  private setState(id: VoiceModelId, state: VoiceModelState, force = false): void {
    this.states.set(id, state);
    if (this.disposed) return;
    const now = Date.now();
    const last = this.lastProgressPush.get(id) ?? 0;
    if (!force && now - last < VOICE_LIMITS.progressThrottleMs) return;
    this.lastProgressPush.set(id, now);
    this.broadcast(IpcEvents.voiceModelProgress, state);
  }

  private broadcastList(): void {
    this.broadcast(IpcEvents.voiceModelsChanged, this.list());
  }

  private broadcast<T>(channel: string, payload: T): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Download pipeline                                                 */
  /* ---------------------------------------------------------------- */

  private partialPath(id: VoiceModelId): string {
    return path.join(this.partialDir, `${id}.download`);
  }

  private sidecarPath(id: VoiceModelId): string {
    return path.join(this.partialDir, `${id}.json`);
  }

  private readSidecar(id: VoiceModelId): PartialSidecar | null {
    try {
      const raw = fs.readFileSync(this.sidecarPath(id), 'utf-8');
      const parsed = JSON.parse(raw) as PartialSidecar;
      if (!fs.existsSync(this.partialPath(id))) return null;
      const actual = fs.statSync(this.partialPath(id)).size;
      // Trust the file on disk over the sidecar counter.
      return { ...parsed, receivedBytes: actual };
    } catch {
      return null;
    }
  }

  private readManifest(id: VoiceModelId): InstallManifest | null {
    try {
      const raw = fs.readFileSync(path.join(this.installDir(id), 'manifest.json'), 'utf-8');
      return JSON.parse(raw) as InstallManifest;
    } catch {
      return null;
    }
  }

  private async deletePartial(id: VoiceModelId): Promise<void> {
    await fsp.rm(this.partialPath(id), { force: true });
    await fsp.rm(this.sidecarPath(id), { force: true });
  }

  private async runDownload(spec: VoiceModelSpec): Promise<void> {
    const id = spec.id;
    const controller = new AbortController();
    this.aborts.set(id, controller);
    this.abortReason.delete(id);

    const sizeCap = Math.min(
      Math.ceil(spec.approxBytes * 1.25),
      VOICE_LIMITS.downloadBytesMax,
    );

    try {
      const state = this.states.get(id) ?? this.freshState(spec, 'not-installed');
      this.setState(id, { ...state, phase: 'downloading', error: undefined }, true);

      // Speed smoothing across progress ticks.
      let lastTick = Date.now();
      let lastBytes = this.readSidecar(id)?.receivedBytes ?? 0;
      let ema = 0;

      await this.fetchToPartial(spec, controller.signal, sizeCap, (p) => {
        const now = Date.now();
        const dt = (now - lastTick) / 1000;
        if (dt > 0.2) {
          const rate = (p.receivedBytes - lastBytes) / dt;
          ema = ema === 0 ? rate : ema * 0.7 + rate * 0.3;
          lastTick = now;
          lastBytes = p.receivedBytes;
        }
        const total = p.totalBytes || spec.approxBytes;
        this.setState(id, {
          ...this.freshState(spec, 'downloading'),
          receivedBytes: p.receivedBytes,
          totalBytes: total,
          percent: Math.min(95, Math.floor((p.receivedBytes / total) * 95)),
          bytesPerSec: Math.max(0, Math.round(ema)),
          etaSec: ema > 1 ? Math.round((total - p.receivedBytes) / ema) : undefined,
        });
      });

      // Verify the pinned archive hash.
      this.setState(id, { ...this.freshState(spec, 'verifying'), percent: 96 }, true);
      const actual = await hashFile(this.partialPath(id));
      if (actual !== spec.sha256) {
        await this.deletePartial(id);
        throw new Error('Downloaded file failed its integrity check (SHA-256 mismatch)');
      }

      // Extract (or move a bare file) into a temp dir, then rename into place.
      this.setState(id, { ...this.freshState(spec, 'extracting'), percent: 98 }, true);
      await this.install(spec, actual);
      await this.deletePartial(id);

      this.setState(id, this.scanState(spec), true);
      this.broadcastList();
      logger.info(`voice: installed model ${id}`);
    } catch (err) {
      const reason = this.abortReason.get(id);
      if (controller.signal.aborted && reason === 'pause') {
        const sidecar = this.readSidecar(id);
        this.setState(
          id,
          {
            ...this.freshState(spec, 'paused'),
            receivedBytes: sidecar?.receivedBytes ?? 0,
            percent: sidecar
              ? Math.min(95, Math.floor((sidecar.receivedBytes / spec.approxBytes) * 95))
              : 0,
          },
          true,
        );
        return;
      }
      if (controller.signal.aborted) {
        // Cancelled — state already reset by cancel()/remove().
        return;
      }
      logger.error(`voice: download failed for ${id}`, err);
      this.setState(
        id,
        { ...this.freshState(spec, 'error'), error: err instanceof Error ? err.message : String(err) },
        true,
      );
      throw err;
    } finally {
      this.aborts.delete(id);
      this.abortReason.delete(id);
    }
  }

  /** Stream `spec.url` (following validated redirects) into the partial file. */
  private async fetchToPartial(
    spec: VoiceModelSpec,
    signal: AbortSignal,
    sizeCap: number,
    onProgress: (p: DownloadProgress) => void,
  ): Promise<void> {
    const id = spec.id;
    let url = assertAllowedUrl(spec.url);
    const sidecar = this.readSidecar(id);
    // Resume only when the sidecar matches this spec URL.
    let offset = sidecar && sidecar.url === spec.url ? sidecar.receivedBytes : 0;
    const etag = sidecar && sidecar.url === spec.url ? sidecar.etag : undefined;
    if (offset === 0) await this.deletePartial(id);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await httpsGet(url, { offset, etag, signal });
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // drain
        url = assertAllowedUrl(new URL(res.headers.location, url).toString());
        continue;
      }

      if (status === 416 && offset > 0) {
        // The partial already covers the full asset (e.g. paused at 100%) —
        // nothing left to fetch; the hash check decides whether it's valid.
        res.resume();
        return;
      }
      if (status === 200 && offset > 0) {
        // Server ignored the Range (or If-Range mismatched) — restart cleanly.
        offset = 0;
        await this.deletePartial(id);
      } else if (status !== 200 && status !== 206) {
        res.resume();
        throw new Error(`Download failed with HTTP ${status}`);
      }

      const contentLength = Number(res.headers['content-length'] ?? 0);
      const totalBytes =
        status === 206
          ? offset + contentLength
          : contentLength || spec.approxBytes;
      if (totalBytes > sizeCap) {
        res.destroy();
        throw new Error('Download exceeds the expected size for this model');
      }

      const newEtag = typeof res.headers.etag === 'string' ? res.headers.etag : undefined;
      const writeSidecar = (received: number) => {
        fs.writeFileSync(
          this.sidecarPath(id),
          JSON.stringify({ url: spec.url, etag: newEtag ?? etag, receivedBytes: received }),
        );
      };
      writeSidecar(offset);

      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(this.partialPath(id), {
          flags: offset > 0 ? 'a' : 'w',
        });
        let received = offset;
        let sinceSidecar = 0;

        const onAbort = () => {
          res.destroy(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          sinceSidecar += chunk.length;
          if (received > sizeCap) {
            res.destroy(new Error('Download exceeded its size cap'));
            return;
          }
          if (sinceSidecar > 4_000_000) {
            sinceSidecar = 0;
            writeSidecar(received);
          }
          onProgress({ receivedBytes: received, totalBytes });
        });
        res.on('error', (err) => {
          out.close(() => {
            writeSidecar(received);
            signal.removeEventListener('abort', onAbort);
            reject(signal.aborted ? new Error('aborted') : err);
          });
        });
        res.pipe(out);
        out.on('finish', () => {
          writeSidecar(received);
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
        out.on('error', (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
      });
      return;
    }
    throw new Error('Too many redirects while downloading the model');
  }

  /** Extract/move the verified partial into the final install dir (atomic). */
  private async install(spec: VoiceModelSpec, archiveSha256: string): Promise<void> {
    const finalDir = this.installDir(spec.id);
    const tmpDir = path.join(
      this.partialDir,
      `${spec.id}.extract-${crypto.randomBytes(4).toString('hex')}`,
    );
    await fsp.rm(tmpDir, { recursive: true, force: true });
    await fsp.mkdir(tmpDir, { recursive: true });

    try {
      if (spec.archive === 'file') {
        const target = path.join(tmpDir, spec.expects[0]);
        await fsp.copyFile(this.partialPath(spec.id), target);
      } else {
        await this.extractTarBz2(this.partialPath(spec.id), tmpDir);
      }

      // Archives nest everything under a single top-level directory — flatten.
      let sourceDir = tmpDir;
      if (!fs.existsSync(path.join(sourceDir, spec.expects[0]))) {
        const entries = (await fsp.readdir(tmpDir, { withFileTypes: true })).filter(
          (e) => e.isDirectory(),
        );
        if (entries.length === 1) sourceDir = path.join(tmpDir, entries[0].name);
      }
      for (const rel of spec.expects) {
        if (!fs.existsSync(path.join(sourceDir, rel))) {
          throw new Error(`Extracted model is missing an expected file: ${rel}`);
        }
      }

      // Per-file integrity manifest.
      const files: InstallManifest['files'] = {};
      let totalBytes = 0;
      for (const file of await walkFiles(sourceDir)) {
        const rel = path.relative(sourceDir, file).split(path.sep).join('/');
        const stat = await fsp.stat(file);
        files[rel] = { bytes: stat.size, sha256: await hashFile(file) };
        totalBytes += stat.size;
      }
      const manifest: InstallManifest = {
        id: spec.id,
        rev: spec.rev,
        archiveSha256,
        installedAt: Date.now(),
        totalBytes,
        files,
      };
      await fsp.writeFile(
        path.join(sourceDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
      );

      await fsp.rm(finalDir, { recursive: true, force: true });
      await fsp.rename(sourceDir, finalDir);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }

  /** Path-traversal-safe .tar.bz2 extraction (pure JS: unbzip2 + tar-fs). */
  private extractTarBz2(archive: string, dest: string): Promise<void> {
    const destResolved = path.resolve(dest);
    let entries = 0;
    return new Promise<void>((resolve, reject) => {
      const extract = tar.extract(dest, {
        // Reject anything that is not a plain file/dir or escapes the dest.
        ignore: (_name, header) => {
          if (!header) return true;
          entries += 1;
          if (entries > VOICE_LIMITS.extractEntryMax) {
            reject(new Error('Archive contains too many entries'));
            return true;
          }
          if (header.type !== 'file' && header.type !== 'directory') return true;
          const name = header.name;
          if (path.isAbsolute(name)) return true;
          const resolved = path.resolve(dest, name);
          if (resolved !== destResolved && !resolved.startsWith(destResolved + path.sep)) {
            return true;
          }
          return false;
        },
      });
      const read = fs.createReadStream(archive);
      const decompress = bz2();
      read.on('error', reject);
      decompress.on('error', reject);
      extract.on('error', reject);
      extract.on('finish', resolve);
      read.pipe(decompress).pipe(extract);
    });
  }

  /** Join that refuses to escape `base` (manifest-supplied relative paths). */
  private safeJoin(base: string, rel: string): string {
    const resolved = path.resolve(base, rel);
    const baseResolved = path.resolve(base);
    if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
      throw new Error(`Unsafe path in manifest: ${rel}`);
    }
    return resolved;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

interface HttpsGetOptions {
  offset: number;
  etag?: string;
  signal: AbortSignal;
}

/** One validated HTTPS GET (no auto-redirects; guarded DNS lookup). */
function httpsGet(
  url: URL,
  opts: HttpsGetOptions,
): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'user-agent': 'Limboo-voice-models',
      accept: 'application/octet-stream',
    };
    if (opts.offset > 0) {
      headers.range = `bytes=${opts.offset}-`;
      if (opts.etag) headers['if-range'] = opts.etag;
    }
    const req = https.request(
      url,
      {
        method: 'GET',
        headers,
        lookup: guardedLookup,
        signal: opts.signal,
        timeout: 30_000,
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new Error('Download connection timed out')));
    req.on('error', reject);
    req.end();
  });
}
