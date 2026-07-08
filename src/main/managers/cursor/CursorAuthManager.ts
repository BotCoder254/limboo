/**
 * CursorAuthManager — authentication state for the Cursor provider (Phase 1 of
 * the Agent Adapter Architecture; no run capability yet).
 *
 * Owns two auth paths, kept deliberately distinct:
 *  - **CLI login** — spawns `cursor-agent login` (argv-only) and lets the CLI
 *    own its credentials; Limboo never reads, copies, or exports them. Manual
 *    browser mode (`NO_OPEN_BROWSER=1`) captures the printed login URL for the
 *    UI to copy/open through the validated system handlers.
 *  - **API key** — held encrypted via {@link SecretStore} (Electron
 *    safeStorage). Classification checks *presence only*; the secret is
 *    decrypted exclusively by {@link getSpawnEnv} at child-spawn time.
 *
 * Classification is fully local (PATH resolve + presence checks + one
 * `status --format json` spawn) — no network probes. All captured CLI output
 * passes {@link redactCursor} before it can reach the logger or state.
 */
import { BrowserWindow } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { IpcEvents } from '@shared/ipc-channels';
import {
  CURSOR_LIMITS,
  CURSOR_MODEL_ID_RE,
  DEFAULT_SETTINGS,
  registerCursorModels,
} from '@shared/constants';
import type { AppSettings, CursorAuthState, CursorLoginPhase, CursorUpdateResult } from '@shared/types';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import { SecretStore, CURSOR_API_KEY_SECRET } from '../../secrets/SecretStore';
import {
  getCursorExecProblem,
  redactCursor,
  resolveCursorExecutable,
  runCursorAgent,
  spawnCursorLogin,
} from './exec';

const INITIAL_STATE: CursorAuthState = {
  status: 'unknown',
  apiKey: { configured: false },
  login: { phase: 'idle' },
  encryptionAvailable: false,
};

export class CursorAuthManager {
  private state: CursorAuthState = { ...INITIAL_STATE };
  private probed = false;
  private probing: Promise<CursorAuthState> | null = null;
  private loginChild: ChildProcess | null = null;
  private loginTimer: NodeJS.Timeout | null = null;
  /** Epoch ms of the last successful `cursor-agent models` fetch (TTL memo). */
  private modelsFetchedAt = 0;
  private modelsFetching = false;
  /** Single-flight `cursor-agent update` run. */
  private updating: Promise<CursorUpdateResult> | null = null;
  private readonly listeners = new Set<(state: CursorAuthState) => void>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly settings: SettingsManager,
  ) {}

  /** The user's Cursor auth preference (`settings.agent.cursor`). */
  private prefs(): AppSettings['agent']['cursor'] {
    return this.settings.getAll().agent.cursor ?? DEFAULT_SETTINGS.agent.cursor;
  }

  /** Current state; runs the first (lazy) probe — nothing spawns at boot. */
  async getAuthState(): Promise<CursorAuthState> {
    if (!this.probed) return this.probe(false);
    return this.state;
  }

  /**
   * Synchronous view of the memoized state — never probes. Used by
   * AgentManager's send-gating/health reconciliation, which must not block on
   * a CLI spawn; combine with {@link onChange} to stay current.
   */
  getCachedState(): CursorAuthState {
    return this.state;
  }

  /** True once at least one probe has classified the local install. */
  hasProbed(): boolean {
    return this.probed;
  }

  /** Subscribe to auth-state changes (additive to the renderer broadcast). */
  onChange(cb: (state: CursorAuthState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Re-classify the local install/auth state. Single-flight; `force` bypasses
   * the memo. Never reads secret values — presence only.
   */
  async probe(force = true): Promise<CursorAuthState> {
    if (this.probing) return this.probing;
    if (this.probed && !force) return this.state;
    this.probing = this.doProbe(force).finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async doProbe(force: boolean): Promise<CursorAuthState> {
    this.probed = true;
    const patch: Partial<CursorAuthState> = {
      encryptionAvailable: this.secrets.isEncryptionAvailable(),
      lastCheckedAt: Date.now(),
      error: undefined,
      account: undefined,
      cliVersion: undefined,
      exec: undefined,
    };

    const exe = await resolveCursorExecutable(force);
    if (!exe) {
      this.setState({
        ...patch,
        status: 'not-installed',
        apiKey: this.apiKeyPresence(),
        error:
          getCursorExecProblem() ??
          'Cursor CLI (cursor-agent) not found — checked PATH, %LOCALAPPDATA%\\cursor-agent, and ~/.local/bin. ' +
            'If you just installed it, hit Refresh; otherwise install it from cursor.com/cli, ' +
            'set an explicit executable path below, or restart Limboo to pick up a new PATH.',
      });
      return this.state;
    }
    patch.cliVersion = exe.version;
    patch.exec = { path: exe.path, kind: exe.kind, source: exe.source };

    // Classification order follows `settings.agent.cursor.preferredAuth`:
    //  - auto:      API key (env, then encrypted) wins; else CLI login.
    //  - api-key:   only the key counts — a stored CLI login is ignored.
    //  - cli-login: only the CLI login counts — a stored key is kept but
    //               ignored (and getSpawnEnv never injects it). NOTE: an
    //               ambient CURSOR_API_KEY env var still reaches any child
    //               process via the inherited environment — that is outside
    //               our control and reported in `apiKey.source`.
    const prefer = this.prefs().preferredAuth;
    const apiKey = this.apiKeyPresence();
    patch.apiKey = apiKey;
    if (apiKey.configured && prefer !== 'cli-login') {
      this.setState({ ...patch, status: 'authenticated-api-key' });
      void this.refreshModels();
      return this.state;
    }
    if (prefer === 'api-key') {
      // Key preferred but absent — never spawn the status probe: a stored
      // CLI login must not classify as authenticated under this preference.
      this.setState({ ...patch, status: 'not-authenticated' });
      return this.state;
    }

    // Ask the CLI itself whether a browser login is stored.
    const r = await runCursorAgent(['status', '--format', 'json'], {
      timeout: CURSOR_LIMITS.statusTimeoutMs,
    });
    const parsed = r.ok ? parseStatus(r.stdout) : null;
    if (parsed?.authenticated) {
      this.setState({ ...patch, status: 'authenticated-cli', account: parsed.account });
      void this.refreshModels();
    } else {
      this.setState({ ...patch, status: 'not-authenticated' });
      if (!r.ok && r.code !== 1) {
        logger.warn('CursorAuthManager: status probe failed', redactCursor(r.stderr).slice(0, 300));
      }
    }
    return this.state;
  }

  /* ---------------------------------------------------------------- */
  /* Model discovery + CLI self-update                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Fetch the account's model list via `cursor-agent models` (argv-only,
   * bounded, TTL-memoized). Fire-and-forget from the probe — failures are
   * stale-ok: the previously discovered set (state + persisted settings) is
   * never cleared by a fetch blip, so provider routing survives.
   */
  private async refreshModels(force = false): Promise<void> {
    if (this.modelsFetching) return;
    if (!force && Date.now() - this.modelsFetchedAt < CURSOR_LIMITS.modelsTtlMs) return;
    this.modelsFetching = true;
    try {
      const r = await runCursorAgent(['models'], { env: this.getSpawnEnv() });
      if (!r.ok) {
        logger.warn('CursorAuthManager: model discovery failed', redactCursor(r.stderr).slice(0, 300));
        return;
      }
      this.modelsFetchedAt = Date.now();
      const models = parseModels(r.stdout);
      if (!models.length) return;
      registerCursorModels(models);
      this.setState({ models });
      // Persist so routing (and the pickers) work at next boot pre-probe.
      const prev = this.prefs().discoveredModels ?? [];
      if (models.length !== prev.length || models.some((m, i) => m !== prev[i])) {
        this.settings.update({ agent: { cursor: { discoveredModels: models } } });
      }
    } finally {
      this.modelsFetching = false;
    }
  }

  /**
   * `cursor-agent update` (self-update). Single-flight; refused while a
   * sign-in child is live (the IPC handler additionally refuses while any
   * agent run is active). Re-resolves the executable and re-probes after, so
   * cliVersion + models refresh. The returned message is redacted and short.
   */
  async updateCli(): Promise<CursorUpdateResult> {
    if (this.updating) return this.updating;
    if (this.loginChild) {
      return { ok: false, message: 'Finish or cancel the in-flight sign-in first.' };
    }
    this.updating = this.doUpdateCli().finally(() => {
      this.updating = null;
    });
    return this.updating;
  }

  private async doUpdateCli(): Promise<CursorUpdateResult> {
    const r = await runCursorAgent(['update'], { timeout: CURSOR_LIMITS.updateTimeoutMs });
    // Whatever happened, re-resolve + re-probe so the state reflects reality.
    await resolveCursorExecutable(true);
    await this.probe(true);
    const line = redactCursor((r.ok ? r.stdout : r.stderr) || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()
      ?.slice(0, 200);
    if (!r.ok) {
      logger.warn('CursorAuthManager: cursor-agent update failed', line ?? `code ${r.code}`);
      return { ok: false, message: line || `cursor-agent update exited with code ${r.code}` };
    }
    void this.refreshModels(true);
    logger.info('CursorAuthManager: cursor-agent updated', this.state.cliVersion ?? '');
    return {
      ok: true,
      message: this.state.cliVersion ? `Cursor CLI ${this.state.cliVersion}` : line || 'Cursor CLI updated.',
    };
  }

  /** Presence-only API key check: process env first, then the encrypted store. */
  private apiKeyPresence(): CursorAuthState['apiKey'] {
    if (process.env.CURSOR_API_KEY) return { configured: true, source: 'env' };
    const meta = this.secrets.metadata(CURSOR_API_KEY_SECRET);
    return meta.configured
      ? { configured: true, source: 'encrypted', updatedAt: meta.updatedAt }
      : { configured: false };
  }

  /* ---------------------------------------------------------------- */
  /* Interactive CLI login                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Start `cursor-agent login`. Single-flight — a second call while a child is
   * live is rejected. In manual mode the CLI prints the login URL instead of
   * opening a browser; the first validated https URL from stdout is exposed on
   * state for the renderer's Copy URL / Open Browser actions.
   */
  async loginStart(manual: boolean): Promise<void> {
    if (this.loginChild) throw new Error('A Cursor sign-in is already in progress.');
    this.setLogin({ phase: 'launching', url: undefined, error: undefined });

    const child = await spawnCursorLogin(manual ? { NO_OPEN_BROWSER: '1' } : {});
    if (!child) {
      this.setLogin({ phase: 'failed', error: 'Could not start cursor-agent. Is it installed?' });
      void this.probe(true);
      return;
    }
    this.loginChild = child;
    this.setLogin({ phase: manual ? 'waiting-manual-url' : 'waiting-browser' });

    let buffered = '';
    const onOutput = (chunk: Buffer | string) => {
      if (buffered.length >= CURSOR_LIMITS.outputMax) return;
      buffered = (buffered + String(chunk)).slice(0, CURSOR_LIMITS.outputMax);
      if (manual && !this.state.login.url) {
        const url = extractLoginUrl(buffered);
        if (url) this.setLogin({ phase: 'waiting-manual-url', url });
      }
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);

    this.loginTimer = setTimeout(() => {
      logger.warn('CursorAuthManager: login timed out — killing child');
      this.killLoginChild();
      this.setLogin({ phase: 'failed', error: 'Sign-in timed out. Try again.' });
    }, CURSOR_LIMITS.loginTimeoutMs);

    child.once('exit', (code) => {
      this.clearLoginChild();
      // Any exit → verify against the CLI's own view of the world.
      this.setLogin({ phase: 'verifying', url: undefined });
      void this.probe(true).then(() => {
        if (this.state.status === 'authenticated-cli' || this.state.status === 'authenticated-api-key') {
          this.setLogin({ phase: 'idle', error: undefined });
          logger.info('CursorAuthManager: sign-in verified');
        } else {
          const reason = redactCursor(buffered).trim().split(/\r?\n/).pop()?.slice(0, 200);
          this.setLogin({
            phase: 'failed',
            error: code === 0 ? 'Sign-in did not complete.' : reason || `cursor-agent login exited with code ${code}`,
          });
        }
      });
    });
    child.once('error', (err) => {
      this.clearLoginChild();
      this.setLogin({ phase: 'failed', error: redactCursor(err.message).slice(0, 200) });
    });
  }

  /** Cancel an in-flight sign-in (kills the login child). */
  loginCancel(): void {
    if (!this.loginChild) return;
    this.killLoginChild();
    this.setLogin({ phase: 'idle', url: undefined, error: undefined });
  }

  /** `cursor-agent logout`, then re-probe (clearing any stale login state). */
  async logout(): Promise<void> {
    const r = await runCursorAgent(['logout']);
    if (!r.ok) logger.warn('CursorAuthManager: logout failed', redactCursor(r.stderr).slice(0, 300));
    this.setLogin({ phase: 'idle', url: undefined, error: undefined });
    await this.probe(true);
  }

  /* ---------------------------------------------------------------- */
  /* API key (safeStorage)                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Encrypt + store the user's API key. The value is validated upstream by the
   * IPC handler, never logged, never kept on this instance, and never included
   * in any state or IPC response.
   */
  async setApiKey(key: string): Promise<void> {
    this.secrets.set(CURSOR_API_KEY_SECRET, key);
    await this.probe(true);
  }

  async removeApiKey(): Promise<void> {
    this.secrets.remove(CURSOR_API_KEY_SECRET);
    await this.probe(true);
  }

  /**
   * Env overlay for a future Cursor child process — the ONLY sanctioned
   * decryption call-site (decrypt-at-spawn, never cached). Unused by Phase 1
   * runs; the Phase-2 runtime adapter composes it into `spawn(..., { env })`.
   * Respects `preferredAuth`: under `cli-login` the stored key is never
   * injected — the CLI's own credentials must carry the run.
   */
  getSpawnEnv(): NodeJS.ProcessEnv {
    if (this.prefs().preferredAuth === 'cli-login') return {};
    if (process.env.CURSOR_API_KEY) return {};
    const key = this.secrets.getDecrypted(CURSOR_API_KEY_SECRET);
    return key ? { CURSOR_API_KEY: key } : {};
  }

  /** Kill any live login child (app quit). */
  dispose(): void {
    this.killLoginChild();
  }

  /* ---------------------------------------------------------------- */
  /* State plumbing                                                    */
  /* ---------------------------------------------------------------- */

  private setState(patch: Partial<CursorAuthState>): void {
    this.state = { ...this.state, ...patch };
    this.broadcast();
  }

  private setLogin(patch: Partial<CursorAuthState['login']> & { phase: CursorLoginPhase }): void {
    this.state = { ...this.state, login: { ...this.state.login, ...patch } };
    this.broadcast();
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.agentCursorAuthChanged, this.state);
    }
    for (const cb of this.listeners) {
      try {
        cb(this.state);
      } catch (err) {
        logger.warn('CursorAuthManager: onChange listener threw', String(err));
      }
    }
  }

  private killLoginChild(): void {
    this.clearLoginChild(true);
  }

  private clearLoginChild(kill = false): void {
    if (this.loginTimer) {
      clearTimeout(this.loginTimer);
      this.loginTimer = null;
    }
    const child = this.loginChild;
    this.loginChild = null;
    if (kill && child && !child.killed) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Parse `cursor-agent status --format json` defensively: JSON.parse in a
 * try/catch, then read ONLY whitelisted scalar fields — never merge or iterate
 * unknown keys (CLAUDE.md §6 pollution discipline).
 */
function parseStatus(stdout: string): { authenticated: boolean; account?: { email?: string; name?: string } } | null {
  try {
    const raw: unknown = JSON.parse(stdout.trim());
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : undefined;
    // The CLI nests account scalars under `userInfo` (observed:
    // { status: "authenticated", isAuthenticated: true, userInfo: { email,
    // firstName, lastName } }); older shapes used top-level / `account`.
    const nested = (key: 'userInfo' | 'account'): Record<string, unknown> | undefined => {
      const v = obj[key];
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
    };
    const userInfo = nested('userInfo');
    const account0 = nested('account');
    const email = str(obj.email) ?? str(userInfo?.email) ?? str(account0?.email);
    const fullName = [str(userInfo?.firstName), str(userInfo?.lastName)].filter(Boolean).join(' ');
    const name = str(obj.name) ?? str(account0?.name) ?? str(userInfo?.name) ?? (fullName || undefined);
    const authenticated =
      obj.authenticated === true ||
      obj.isAuthenticated === true ||
      obj.loggedIn === true ||
      obj.logged_in === true ||
      str(obj.status)?.toLowerCase() === 'authenticated' ||
      // A status payload that identifies an account implies a stored login.
      Boolean(email || name);
    const account = email || name ? { email, name } : undefined;
    return { authenticated, account };
  } catch {
    return null;
  }
}

/**
 * Parse `cursor-agent models` output defensively. The format is a per-line
 * list (possibly with a current-model marker / prose headers); we strip a
 * leading marker, skip any line containing `:` (headers, key: value noise),
 * take the first whitespace token, and keep it only when it passes the strict
 * model-id charset. Deduped + capped — junk output degrades to a shorter
 * list, never to arbitrary strings in routing or argv.
 */
function parseModels(stdout: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.slice(0, CURSOR_LIMITS.outputMax).split(/\r?\n/)) {
    if (out.length >= CURSOR_LIMITS.modelsMax) break;
    const line = rawLine.trim();
    if (!line || line.includes(':')) continue;
    const token = line.replace(/^[-*•>→]+\s*/, '').split(/\s+/)[0] ?? '';
    if (!token || token.length > CURSOR_LIMITS.modelIdMax) continue;
    if (!CURSOR_MODEL_ID_RE.test(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Hosts the login URL may point at — Cursor's authenticator is always a
 * Cursor-owned domain. Exact hostname or subdomain match only (suffix on a
 * dot boundary, never substring), so a compromised or spoofed CLI can't
 * steer the card's "Open Browser" action to an arbitrary site.
 */
const LOGIN_URL_DOMAINS = ['cursor.com', 'cursor.sh'];

function isAllowedLoginHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOGIN_URL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** First validated https URL in the login child's output (manual mode). */
function extractLoginUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/\S+/);
  if (!match) return undefined;
  const candidate = match[0].replace(/[)\]}>.,'"]+$/, '');
  if (candidate.length > CURSOR_LIMITS.loginUrlMax) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    if (!isAllowedLoginHost(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
