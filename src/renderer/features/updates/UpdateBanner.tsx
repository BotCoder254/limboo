/**
 * UpdateBanner — a full-width bottom strip that appears only when the in-app
 * updater has something actionable: a new version available, a download in
 * progress, or a downloaded update ready to install. Purely presentational; all
 * logic lives in the main-process AutoUpdateManager mirrored through
 * useUpdateStore.
 *
 * Dark-only, token-driven (bg-elevated / border-line / text-fg / accent) — no new
 * colors, no gradients. Anchored to the bottom edge, spanning the window width,
 * above the Toaster. While downloading it shows a determinate CircularProgress
 * ring with the live percentage. The X dismisses the strip (renderer-only); the
 * Settings-icon badge stays lit so the update is still reachable.
 */
import { ArrowUpCircle, Download, RefreshCw, X } from 'lucide-react';
import { CircularProgress } from '@/renderer/components/ui';
import { useUpdateStore } from '@/renderer/stores/useUpdateStore';
import { cn } from '@/renderer/lib/cn';

export function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const busy = useUpdateStore((s) => s.busy);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);
  const dismiss = useUpdateStore((s) => s.dismiss);

  // Only surface actionable stages. Checking / not-available / idle / disabled /
  // errors stay quiet here (errors are visible in the Settings → Updates panel).
  const actionable =
    status.stage === 'available' ||
    status.stage === 'downloading' ||
    status.stage === 'downloaded';
  if (!actionable || dismissed) return null;

  const percent = status.percent ?? 0;
  const versionLabel = status.version ? `Limboo ${status.version}` : 'A new version';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center">
      <div className="pointer-events-auto flex w-full items-center gap-3 border-t border-line bg-elevated px-4 py-2.5 shadow-lg">
        {/* Leading indicator — ring + live % while downloading, otherwise an icon. */}
        {status.stage === 'downloading' ? (
          <CircularProgress value={percent} size={30} showLabel className="shrink-0" />
        ) : (
          <ArrowUpCircle size={20} className="shrink-0 text-accent" />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-fg">
            {status.stage === 'downloaded'
              ? 'Update ready to install'
              : status.stage === 'downloading'
                ? 'Downloading update…'
                : 'Update available'}
          </span>
          <span className="truncate text-[11px] text-muted">
            {status.stage === 'downloaded'
              ? `${versionLabel} — restart to finish`
              : status.stage === 'downloading'
                ? `${versionLabel} · ${percent}%`
                : `${versionLabel} is available to download`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status.stage === 'available' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void download()}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-base transition-opacity hover:opacity-90',
                'disabled:opacity-50',
              )}
            >
              <Download size={14} /> Download
            </button>
          )}
          {status.stage === 'downloading' && (
            <span className="text-[12px] tabular-nums text-muted">{percent}%</span>
          )}
          {status.stage === 'downloaded' && (
            <button
              type="button"
              onClick={() => void install()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-base transition-opacity hover:opacity-90"
            >
              <RefreshCw size={14} /> Restart & install
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="rounded p-1 text-faint transition-colors hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
