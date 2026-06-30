/**
 * UpdateBanner — a slim, themed surface that appears only when the in-app updater
 * has something actionable: a new version available, a download in progress, or a
 * downloaded update ready to install. Purely presentational; all logic lives in
 * the main-process AutoUpdateManager mirrored through useUpdateStore.
 *
 * Dark-only, token-driven (bg-elevated / border-line / text-fg / accent) — no new
 * colors, no gradients. Anchored bottom-right above the Toaster.
 */
import { ArrowUpCircle, Download, RefreshCw, X } from 'lucide-react';
import { useUpdateStore } from '@/renderer/stores/useUpdateStore';
import { cn } from '@/renderer/lib/cn';

export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const busy = useUpdateStore((s) => s.busy);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);
  const dismiss = useUpdateStore((s) => s.dismiss);

  // Only surface actionable stages. Checking / not-available / idle / disabled /
  // errors stay quiet here (errors are visible in the Settings → Updates panel).
  const visible =
    status.stage === 'available' ||
    status.stage === 'downloading' ||
    status.stage === 'downloaded';
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[320px] flex-col">
      <div className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-line bg-elevated p-3 shadow-lg">
        <div className="flex items-start gap-2.5">
          <ArrowUpCircle size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-medium text-fg">
              {status.stage === 'downloaded'
                ? 'Update ready to install'
                : status.stage === 'downloading'
                  ? 'Downloading update…'
                  : 'Update available'}
            </span>
            <span className="truncate text-[11px] text-muted">
              {status.version ? `Limboo ${status.version}` : 'A new version is available'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>

        {status.stage === 'downloading' && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${status.percent ?? 0}%` }}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {status.stage === 'available' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void download()}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-base transition-opacity hover:opacity-90',
                'disabled:opacity-50',
              )}
            >
              <Download size={13} /> Download
            </button>
          )}
          {status.stage === 'downloading' && (
            <span className="text-[11px] tabular-nums text-muted">{status.percent ?? 0}%</span>
          )}
          {status.stage === 'downloaded' && (
            <button
              type="button"
              onClick={() => void install()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-base transition-opacity hover:opacity-90"
            >
              <RefreshCw size={13} /> Restart & install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
