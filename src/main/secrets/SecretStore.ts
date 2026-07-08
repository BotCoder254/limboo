/**
 * SecretStore — the app's safeStorage-backed secret persistence (CLAUDE.md §6:
 * secrets are encrypted with Electron `safeStorage`, never plaintext files).
 *
 * Each secret is one opaque file at `userData/secrets/<name>.bin.json` holding
 * `{ v, updatedAt, data }` where `data` is the base64 of
 * `safeStorage.encryptString(secret)`. Writes are atomic (tmp + rename, the
 * storage.ts idiom) but this module deliberately does NOT reuse storage.ts:
 * these files must never share code paths that could log payloads. SecretStore
 * logs secret *names* only — never values, never file contents.
 *
 * Decryption happens exclusively through {@link SecretStore.getDecrypted},
 * which callers may invoke only at child-process spawn / env-build time. The
 * decrypted value must never be cached, IPC'd to the renderer, put on argv, or
 * logged.
 */
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';

/** Secret name for the Cursor provider's user API key. */
export const CURSOR_API_KEY_SECRET = 'cursor-api-key';

/** Defense in depth — names come from main-process constants, never IPC. */
const NAME_RE = /^[a-z0-9-]{1,64}$/;

interface SecretFile {
  v: 1;
  updatedAt: number;
  /** base64 of safeStorage.encryptString(secret) — opaque, OS-keychain bound. */
  data: string;
}

export class SecretStore {
  private dir(): string {
    return path.join(app.getPath('userData'), 'secrets');
  }

  private fileFor(name: string): string {
    if (!NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`);
    return path.join(this.dir(), `${name}.bin.json`);
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /** Encrypt + persist a secret. Throws when OS-level encryption is unavailable. */
  set(name: string, secret: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error('OS keychain encryption is unavailable — secret storage is disabled.');
    }
    const target = this.fileFor(name);
    const payload: SecretFile = {
      v: 1,
      updatedAt: Date.now(),
      data: safeStorage.encryptString(secret).toString('base64'),
    };
    const tmp = `${target}.tmp`;
    fs.mkdirSync(this.dir(), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, target);
    logger.info(`SecretStore: stored secret "${name}"`);
  }

  has(name: string): boolean {
    return this.readFile(name) !== null;
  }

  /** Presence + timestamp only — safe to surface to the renderer. */
  metadata(name: string): { configured: boolean; updatedAt?: number } {
    const file = this.readFile(name);
    return file ? { configured: true, updatedAt: file.updatedAt } : { configured: false };
  }

  /**
   * Decrypt a stored secret. The ONLY sanctioned call-site is child-process
   * env composition at spawn time; the result must never be cached or logged.
   * A decrypt failure (OS keychain reset / another machine's blob) removes the
   * stale file and degrades to "not configured".
   */
  getDecrypted(name: string): string | null {
    const file = this.readFile(name);
    if (!file) return null;
    try {
      return safeStorage.decryptString(Buffer.from(file.data, 'base64'));
    } catch {
      logger.warn(`SecretStore: could not decrypt "${name}" (keychain changed?) — removing stale entry`);
      this.remove(name);
      return null;
    }
  }

  remove(name: string): void {
    try {
      fs.rmSync(this.fileFor(name), { force: true });
      logger.info(`SecretStore: removed secret "${name}"`);
    } catch (err) {
      logger.warn(`SecretStore: failed to remove "${name}"`, err);
    }
  }

  private readFile(name: string): SecretFile | null {
    try {
      const raw = fs.readFileSync(this.fileFor(name), 'utf8');
      const parsed = JSON.parse(raw) as SecretFile;
      if (parsed?.v !== 1 || typeof parsed.data !== 'string' || parsed.data.length === 0) return null;
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Name only — never the file contents.
        logger.warn(`SecretStore: unreadable secret file "${name}"`);
      }
      return null;
    }
  }
}
