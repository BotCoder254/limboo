/**
 * Compact Scripts & Services strip for the active session — rendered under the
 * session header only when the repo's limboo.json declares services or scripts.
 * Each service shows a status dot, a clickable loopback (or *.localhost proxy)
 * URL, and start/stop/restart controls; scripts get one-click run buttons; logs
 * stream into the session's terminal. Until the workspace has acknowledged the
 * repo config, controls are disabled and a "Review commands…" affordance opens
 * the approval dialog. Reuses the h-8 header-row idiom (border-line,
 * text-[11px], token colors).
 */
import { useEffect } from 'react';
import { Play, RotateCcw, ShieldAlert, Square } from 'lucide-react';
import type { ServiceInfo } from '@shared/types';
import { IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useServiceStore } from '@/renderer/stores/useServiceStore';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

const STATUS_DOT: Record<ServiceInfo['status'], string> = {
  starting: 'bg-warning',
  running: 'bg-success',
  exited: 'bg-faint',
  crashed: 'bg-danger',
  stopped: 'bg-faint',
};

/**
 * Stable fallback for sessions with no service entry yet. A selector must
 * return a referentially stable snapshot — an inline `?? []` allocates a new
 * array every check, which useSyncExternalStore treats as a changed store and
 * re-renders forever ("Maximum update depth exceeded").
 */
const NO_SERVICES: ServiceInfo[] = [];

/** Stable fallback for sessions whose repo config declares no scripts. */
const NO_SCRIPTS: string[] = [];

export function ServicesStrip({ sessionId }: { sessionId: string }) {
  const services = useServiceStore((s) => s.bySession[sessionId] ?? NO_SERVICES);
  const config = useServiceStore((s) => s.configBySession[sessionId] ?? null);
  const load = useServiceStore((s) => s.load);
  const start = useServiceStore((s) => s.start);
  const stop = useServiceStore((s) => s.stop);
  const restart = useServiceStore((s) => s.restart);
  const runScript = useServiceStore((s) => s.runScript);
  const promptRepoConfig = useSessionStore((s) => s.promptRepoConfig);

  useEffect(() => {
    void load(sessionId);
  }, [sessionId, load]);

  const scripts = config?.scripts ?? NO_SCRIPTS;
  // Missing summary (config unreadable) fails open — actions still surface
  // their errors as toasts; the main process enforces the real trust gate.
  const acked = config?.acked ?? true;
  if (services.length === 0 && scripts.length === 0) return null;

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-b border-line bg-surface px-4">
      {services.length > 0 && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-faint">
          Services
        </span>
      )}
      {services.map((svc) => {
        const url = svc.proxyUrl ?? svc.url;
        const running = svc.status === 'running' || svc.status === 'starting';
        return (
          <div key={svc.name} className="flex shrink-0 items-center gap-1.5 text-[11px]">
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[svc.status])} />
            <span className="font-medium text-fg">{svc.name}</span>
            {url && running ? (
              <button
                type="button"
                title={url}
                onClick={() => void window.limboo?.system.openExternal(url)}
                className="text-accent hover:underline"
              >
                {url.replace(/^https?:\/\//, '')}
              </button>
            ) : (
              <span className="text-faint">{svc.status}</span>
            )}
            {running ? (
              <>
                <IconButton
                  label={`Restart ${svc.name}`}
                  size="sm"
                  onClick={() => void restart(sessionId, svc.name)}
                >
                  <RotateCcw size={11} />
                </IconButton>
                <IconButton
                  label={`Stop ${svc.name}`}
                  size="sm"
                  onClick={() => void stop(sessionId, svc.name)}
                >
                  <Square size={11} />
                </IconButton>
              </>
            ) : (
              <IconButton
                label={`Start ${svc.name}`}
                size="sm"
                disabled={!acked}
                onClick={() => void start(sessionId, svc.name)}
              >
                <Play size={11} />
              </IconButton>
            )}
          </div>
        );
      })}
      {scripts.length > 0 && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-faint">
          Scripts
        </span>
      )}
      {scripts.map((name) => (
        <div key={name} className="flex shrink-0 items-center gap-1 text-[11px]">
          <span className="font-medium text-fg">{name}</span>
          <IconButton
            label={`Run ${name}`}
            size="sm"
            disabled={!acked}
            onClick={() => void runScript(sessionId, name)}
          >
            <Play size={11} />
          </IconButton>
        </div>
      ))}
      {!acked && (
        <button
          type="button"
          onClick={() => void promptRepoConfig(sessionId)}
          className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-warning transition-opacity hover:opacity-80"
        >
          <ShieldAlert size={11} />
          Review commands…
        </button>
      )}
    </div>
  );
}
