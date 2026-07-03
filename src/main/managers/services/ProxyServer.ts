/**
 * Reverse proxy — deterministic `*.localhost` hostnames for supervised
 * services. One loopback HTTP server routes `<service>--<slug>.localhost`
 * (RFC 6761: `*.localhost` resolves to 127.0.0.1 natively — no hosts-file
 * writes) to the owning service's assigned port, HTTP and WebSocket alike.
 *
 * Security (CLAUDE.md §6, SSRF guard): the server binds 127.0.0.1 ONLY, and
 * routing is a ServiceManager-registry lookup ONLY — a Host header can never
 * name an arbitrary target (registry hit → 127.0.0.1:<port>, anything else →
 * 404). Hop-by-hop headers are stripped; header sizes ride Node's built-in
 * limits; upstream connections never leave loopback.
 */
import http from 'node:http';
import net from 'node:net';
import { logger } from '../../logger';
import type { SettingsManager } from '../SettingsManager';
import type { ServiceManager } from './ServiceManager';

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export class ProxyServer {
  private server: http.Server | null = null;
  private port = 0;

  constructor(
    private readonly services: ServiceManager,
    private readonly settings: SettingsManager,
  ) {}

  /** Start/stop to match the current settings (idempotent). */
  sync(): void {
    const cfg = this.settings.getAll().git.services;
    if (cfg.proxyEnabled && (!this.server || this.port !== cfg.proxyPort)) {
      this.stop();
      this.start(cfg.proxyPort);
    } else if (!cfg.proxyEnabled && this.server) {
      this.stop();
    }
  }

  private start(port: number): void {
    const server = http.createServer((req, res) => {
      const target = this.route(req.headers.host);
      if (target === null) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Unknown service host');
        return;
      }
      const headers: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.includes(k.toLowerCase())) headers[k] = v;
      }
      headers['x-forwarded-host'] = req.headers.host ?? '';
      const upstream = http.request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('Service unavailable');
      });
      req.pipe(upstream);
    });

    // WebSocket upgrades: raw duplex pipe to the loopback service port.
    server.on('upgrade', (req, socket, head) => {
      const target = this.route(req.headers.host);
      if (target === null) {
        socket.destroy();
        return;
      }
      const upstream = net.connect(target, '127.0.0.1', () => {
        const lines = [
          `${req.method} ${req.url} HTTP/1.1`,
          ...Object.entries(req.headers)
            .filter(([k]) => !HOP_BY_HOP.includes(k.toLowerCase()) || k.toLowerCase() === 'upgrade' || k.toLowerCase() === 'connection')
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v ?? ''}`),
          '',
          '',
        ];
        upstream.write(lines.join('\r\n'));
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });

    server.on('error', (err) => {
      logger.warn(`Service proxy failed to listen on 127.0.0.1:${port}`, err);
      this.server = null;
    });
    server.listen(port, '127.0.0.1', () => {
      logger.info(`Service proxy listening on 127.0.0.1:${port} (*.localhost)`);
    });
    this.server = server;
    this.port = port;
  }

  /**
   * `Host: <service>--<slug>.localhost[:port]` → loopback service port, or
   * null. Pure registry lookup — never DNS, never a caller-supplied target.
   */
  private route(host: string | undefined): number | null {
    if (!host || host.length > 255) return null;
    const name = host.split(':')[0].toLowerCase();
    if (!name.endsWith('.localhost')) return null;
    const key = name.slice(0, -'.localhost'.length);
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(key)) return null;
    return this.services.resolveProxyTarget(key);
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }
}
