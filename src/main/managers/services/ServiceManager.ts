/**
 * Service Manager — supervised Scripts & Services for the Session System.
 *
 * Named scripts are on-demand commands (test, lint, migrate); services are
 * long-running processes (dev servers, APIs, workers) supervised for the
 * lifetime of their owning session: auto-assigned loopback port, restart
 * policy, status, and logs streamed through the integrated terminal (the PTY
 * scrollback IS the structured log). Both come from the repo's `limboo.json`
 * (see worktree/config.ts) and are inert until the workspace acknowledges that
 * config — the same trust gate as setup/teardown hooks.
 *
 * Security (CLAUDE.md §6): commands are repo/user-authored config, never
 * renderer-composed; execution is argv-only PTYs via the TerminalManager; ports
 * are probed and bound on 127.0.0.1 exclusively; peer-discovery env vars carry
 * only loopback URLs; nothing here is ever logged with its environment.
 */
import net from 'node:net';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IpcEvents } from '@shared/ipc-channels';
import { WORKTREE_LIMITS } from '@shared/constants';
import type { RepoServiceConfig, ServiceInfo, TerminalSession } from '@shared/types';
import { logger } from '../../logger';
import type { SessionManager } from '../SessionManager';
import type { SettingsManager } from '../SettingsManager';

/** Narrow view of the TerminalManager the supervisor needs. */
interface TerminalOwner {
  createForCommand(opts: {
    workspaceId: string;
    sessionId: string;
    cwd: string;
    command: string;
    title: string;
    origin: 'hook' | 'service';
    env?: Record<string, string>;
    onExit?: (exitCode: number) => void;
  }): TerminalSession;
  kill(terminalId: string): void;
}

/** Narrow view of the WorktreeManager (root + acknowledged repo config). */
interface ConfigSource {
  resolveSessionRoot(sessionId: string): string | null;
  getRepoConfigState(sessionId: string): {
    config: {
      scripts: Record<string, string>;
      services: Record<string, RepoServiceConfig>;
    } | null;
    hash: string;
    acked: boolean;
  };
}

interface ManagedService {
  info: ServiceInfo;
  config: RepoServiceConfig;
  /** True when the user asked it to stop (suppresses the restart policy). */
  stopping: boolean;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class ServiceManager {
  /** Registry keyed `sessionId:serviceName`. */
  private readonly services = new Map<string, ManagedService>();
  private terminals?: TerminalOwner;
  private source?: ConfigSource;

  constructor(
    private readonly sessions: SessionManager,
    private readonly settings: SettingsManager,
  ) {}

  setTerminalManager(terminals: TerminalOwner): void {
    this.terminals = terminals;
  }

  setConfigSource(source: ConfigSource): void {
    this.source = source;
  }

  /* --------------------------------------------------------------- queries */

  /** Declared + running services for a session (declared ones show as stopped). */
  listForSession(sessionId: string): ServiceInfo[] {
    const state = this.source?.getRepoConfigState(sessionId);
    const declared = state?.config?.services ?? {};
    const out: ServiceInfo[] = [];
    for (const [name, cfg] of Object.entries(declared)) {
      const managed = this.services.get(key(sessionId, name));
      out.push(
        managed?.info ?? {
          sessionId,
          name,
          status: 'stopped',
          port: null,
          url: null,
          proxyUrl: null,
          terminalId: null,
          restarts: 0,
          autoStart: cfg.autoStart,
        },
      );
    }
    // Include running services whose declaration disappeared (still stoppable).
    for (const managed of this.services.values()) {
      if (managed.info.sessionId === sessionId && !(managed.info.name in declared)) {
        out.push(managed.info);
      }
    }
    return out;
  }

  /** Registry lookup for the reverse proxy: `<service>--<slug>` → port. */
  resolveProxyTarget(hostKey: string): number | null {
    for (const managed of this.services.values()) {
      if (managed.info.status !== 'running' || managed.info.port === null) continue;
      if (this.proxyKey(managed.info) === hostKey) return managed.info.port;
    }
    return null;
  }

  /**
   * Deterministic proxy host key: `<service>--<slug>`, where the slug is the
   * Paseo-style worktree directory basename (plain sessions fall back to a
   * session-id prefix — still unique per session).
   */
  private proxyKey(info: ServiceInfo): string {
    const session = this.sessions.get(info.sessionId);
    const slug = session?.worktreePath
      ? path.basename(session.worktreePath)
      : info.sessionId.slice(0, 8);
    return `${info.name}--${slug}`;
  }

  /* -------------------------------------------------------------- lifecycle */

  /** Start (or return the already-running) supervised service. */
  async start(sessionId: string, name: string): Promise<ServiceInfo> {
    assertName(name);
    const existing = this.services.get(key(sessionId, name));
    if (existing && (existing.info.status === 'running' || existing.info.status === 'starting')) {
      return existing.info;
    }
    const { cfg } = this.requireDeclared(sessionId, name);
    return this.spawn(sessionId, name, cfg, 0);
  }

  async stop(sessionId: string, name: string): Promise<void> {
    assertName(name);
    const managed = this.services.get(key(sessionId, name));
    if (!managed) return;
    managed.stopping = true;
    managed.info.status = 'stopped';
    if (managed.info.terminalId) this.terminals?.kill(managed.info.terminalId);
    managed.info.terminalId = null;
    managed.info.port = null;
    managed.info.url = null;
    managed.info.proxyUrl = null;
    this.broadcast(sessionId);
  }

  async restart(sessionId: string, name: string): Promise<ServiceInfo> {
    await this.stop(sessionId, name);
    return this.start(sessionId, name);
  }

  /** Run a named on-demand script in the session's root (visible terminal). */
  runScript(sessionId: string, name: string): void {
    assertName(name);
    const state = this.requireAckedConfig(sessionId);
    const command = state.config?.scripts[name];
    if (!command) throw new Error(`Unknown script '${name}'`);
    const session = this.sessions.get(sessionId);
    const root = this.source?.resolveSessionRoot(sessionId);
    if (!session || !root) throw new Error('Session root unavailable');
    this.terminals?.createForCommand({
      workspaceId: session.workspaceId,
      sessionId,
      cwd: root,
      command,
      title: `Script: ${name}`,
      origin: 'hook',
    });
  }

  /** Stop every service owned by a session (worktree removal / delete / quit). */
  async stopForSession(sessionId: string): Promise<void> {
    for (const [k, managed] of this.services) {
      if (managed.info.sessionId !== sessionId) continue;
      managed.stopping = true;
      if (managed.info.terminalId) this.terminals?.kill(managed.info.terminalId);
      this.services.delete(k);
    }
    this.broadcast(sessionId);
  }

  /** Boot/activation: start the active session's autoStart services (acked only). */
  autoStartForSession(sessionId: string): void {
    try {
      const state = this.source?.getRepoConfigState(sessionId);
      if (!state?.config || !state.acked) return;
      for (const [name, cfg] of Object.entries(state.config.services)) {
        if (cfg.autoStart) {
          void this.start(sessionId, name).catch((err) =>
            logger.warn(`service autostart failed: ${name}`, err),
          );
        }
      }
    } catch (err) {
      logger.warn('service autostart scan failed', err);
    }
  }

  /** Kill every supervised service on app shutdown. */
  dispose(): void {
    for (const managed of this.services.values()) {
      managed.stopping = true;
      if (managed.info.terminalId) this.terminals?.kill(managed.info.terminalId);
    }
    this.services.clear();
  }

  /* -------------------------------------------------------------- internals */

  private async spawn(
    sessionId: string,
    name: string,
    cfg: RepoServiceConfig,
    restarts: number,
  ): Promise<ServiceInfo> {
    if (!this.terminals) throw new Error('Terminal manager unavailable');
    const session = this.sessions.get(sessionId);
    const root = this.source?.resolveSessionRoot(sessionId);
    if (!session || !root) throw new Error('Session root unavailable');

    const port = await this.allocatePort(sessionId);
    const svc = this.settings.getAll().git.services;
    const info: ServiceInfo = {
      sessionId,
      name,
      status: 'starting',
      port,
      url: `http://127.0.0.1:${port}`,
      proxyUrl: null,
      terminalId: null,
      restarts,
      autoStart: cfg.autoStart,
    };
    const managed: ManagedService = { info, config: cfg, stopping: false };
    this.services.set(key(sessionId, name), managed);
    if (svc.proxyEnabled) {
      info.proxyUrl = `http://${this.proxyKey(info)}.localhost:${svc.proxyPort}`;
    }

    // Peer discovery: already-running siblings of the SAME session see each
    // other's ports/URLs (loopback only) — no hard-coded networking.
    const env: Record<string, string> = {
      LIMBOO_PORT: String(port),
      PORT: String(port),
      LIMBOO_SERVICE_NAME: name,
      LIMBOO_SESSION_ID: sessionId,
    };
    for (const peer of this.services.values()) {
      if (
        peer.info.sessionId === sessionId &&
        peer.info.name !== name &&
        peer.info.status === 'running' &&
        peer.info.port !== null
      ) {
        const envName = peer.info.name.toUpperCase().replace(/-/g, '_');
        env[`LIMBOO_SERVICE_${envName}_PORT`] = String(peer.info.port);
        env[`LIMBOO_SERVICE_${envName}_URL`] = `http://127.0.0.1:${peer.info.port}`;
      }
    }

    const term = this.terminals.createForCommand({
      workspaceId: session.workspaceId,
      sessionId,
      cwd: root,
      command: cfg.command,
      title: `Service: ${name}`,
      origin: 'service',
      env,
      // Bind THIS terminal's id into the exit path: a restart replaces the
      // registry entry before the old PTY's exit event lands, and that stale
      // exit must not clobber (or respawn over) the new process.
      onExit: (exitCode) => this.onServiceExit(sessionId, name, term.id, exitCode),
    });
    info.terminalId = term.id;
    info.status = 'running';
    this.broadcast(sessionId);
    logger.info(`Service started: ${name} (session ${sessionId}, port ${port})`);

    // A respawned service that stays healthy earns its restart budget back —
    // otherwise crashes hours apart eventually exhaust maxRestarts forever.
    if (restarts > 0) {
      setTimeout(() => {
        const current = this.services.get(key(sessionId, name));
        if (current === managed && managed.info.status === 'running') {
          managed.info.restarts = 0;
        }
      }, 60_000);
    }
    return info;
  }

  private onServiceExit(
    sessionId: string,
    name: string,
    terminalId: string,
    exitCode: number,
  ): void {
    const managed = this.services.get(key(sessionId, name));
    if (!managed) return;
    if (managed.info.terminalId !== terminalId) return; // stale exit from a replaced PTY
    if (managed.stopping) return; // user-initiated; state already set
    managed.info.status = exitCode === 0 ? 'exited' : 'crashed';
    managed.info.port = null;
    managed.info.url = null;
    managed.info.proxyUrl = null;
    this.broadcast(sessionId);

    // Restart policy: exponential backoff, capped respawns, never for clean exits.
    if (
      managed.config.restart === 'on-failure' &&
      exitCode !== 0 &&
      managed.info.restarts < WORKTREE_LIMITS.maxRestarts
    ) {
      const attempt = managed.info.restarts + 1;
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
      setTimeout(() => {
        const current = this.services.get(key(sessionId, name));
        if (!current || current.stopping) return;
        void this.spawn(sessionId, name, managed.config, attempt).catch((err) =>
          logger.warn(`service respawn failed: ${name}`, err),
        );
      }, delayMs);
    }
  }

  /**
   * Probe-allocate a free loopback port inside the configured range. Ports
   * already held by our own registry are skipped without probing.
   *
   * Known limitation (accepted for local dev): probe→close→child-bind is
   * inherently TOCTOU-racy — an external process (or a concurrent spawn) can
   * grab the port in the gap, and a service that binds `::1`/`0.0.0.0` isn't
   * seen by the 127.0.0.1 probe. The service surfaces its own bind error in
   * its terminal when that happens.
   */
  private async allocatePort(sessionId: string): Promise<number> {
    const svc = this.settings.getAll().git.services;
    const taken = new Set<number>();
    for (const managed of this.services.values()) {
      if (managed.info.port !== null) taken.add(managed.info.port);
    }
    for (let port = svc.portRangeStart; port <= svc.portRangeEnd; port += 1) {
      if (taken.has(port)) continue;
      if (await probePort(port)) return port;
    }
    throw new Error(
      `No free port in the service range ${svc.portRangeStart}–${svc.portRangeEnd} (session ${sessionId})`,
    );
  }

  private requireDeclared(
    sessionId: string,
    name: string,
  ): { cfg: RepoServiceConfig } {
    const state = this.requireAckedConfig(sessionId);
    const cfg = state.config?.services[name];
    if (!cfg) throw new Error(`Unknown service '${name}'`);
    return { cfg };
  }

  /** Trust gate: repo commands never run before the workspace acked the config. */
  private requireAckedConfig(sessionId: string): ReturnType<ConfigSource['getRepoConfigState']> {
    if (!this.source) throw new Error('Worktree manager unavailable');
    const state = this.source.getRepoConfigState(sessionId);
    if (!state.config) throw new Error('No limboo.json in this session');
    if (!state.acked) {
      throw new Error('Review and confirm the repo commands first (run worktree setup once)');
    }
    return state;
  }

  private broadcast(sessionId: string): void {
    const payload = { sessionId, services: this.listForSession(sessionId) };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcEvents.servicesUpdated, payload);
    }
  }
}

/* ----------------------------------------------------------------- helpers */

function key(sessionId: string, name: string): string {
  return `${sessionId}:${name}`;
}

function assertName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error('service: invalid name');
  }
}

/** True when the port is bindable on 127.0.0.1 (probe server closed after). */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}
