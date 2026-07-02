/**
 * One downloadable speech model in Settings › Voice. Renders the circular
 * progress ring (download / verify / extract / installed states), the live
 * transfer line (size · speed · ETA), and phase-appropriate inline actions —
 * no modals, matching the app's flat settings design.
 */
import { AlertTriangle, ArrowDownToLine, Check, Pause } from 'lucide-react';
import type { VoiceModelState } from '@shared/types';
import { CircularProgress, Spinner } from '@/renderer/components/ui';
import { formatBytes } from '@/renderer/lib/format';
import { cn } from '@/renderer/lib/cn';
import { useVoiceStore } from '@/renderer/stores/useVoiceStore';

function formatEta(sec?: number): string | null {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return `${Math.round(sec)}s left`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m left`;
  return `${Math.round(min / 60)}h left`;
}

function statusLine(model: VoiceModelState): string {
  switch (model.phase) {
    case 'not-installed':
      return `Not installed · ${formatBytes(model.totalBytes)} download`;
    case 'downloading': {
      const parts = [
        `${formatBytes(model.receivedBytes ?? 0)} / ${formatBytes(model.totalBytes)}`,
      ];
      if (model.bytesPerSec) parts.push(`${formatBytes(model.bytesPerSec)}/s`);
      const eta = formatEta(model.etaSec);
      if (eta) parts.push(eta);
      return parts.join(' · ');
    }
    case 'paused':
      return `Paused · ${formatBytes(model.receivedBytes ?? 0)} of ${formatBytes(model.totalBytes)}`;
    case 'verifying':
      return 'Verifying integrity…';
    case 'extracting':
      return 'Extracting…';
    case 'installed': {
      const parts = [`Installed · ${formatBytes(model.installedBytes ?? 0)}`];
      if (model.installedAt) {
        parts.push(new Date(model.installedAt).toLocaleDateString());
      }
      if (model.rev != null) parts.push(`v${model.rev}`);
      if (model.updateAvailable) parts.push('update available');
      return parts.join(' · ');
    }
    case 'error':
      return model.error ?? 'Download failed';
  }
}

function ActionButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] transition-colors',
        danger ? 'text-danger hover:border-danger' : 'text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

export function VoiceModelCard({ model }: { model: VoiceModelState }) {
  const download = useVoiceStore((s) => s.downloadModel);
  const pause = useVoiceStore((s) => s.pauseModel);
  const resume = useVoiceStore((s) => s.resumeModel);
  const cancel = useVoiceStore((s) => s.cancelModel);
  const remove = useVoiceStore((s) => s.removeModel);
  const verify = useVoiceStore((s) => s.verifyModel);

  const busy = model.phase === 'verifying' || model.phase === 'extracting';
  const ringValue =
    model.phase === 'installed' ? 100 : model.phase === 'error' ? 0 : (model.percent ?? 0);

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2.5">
      {/* Ring + centered phase glyph */}
      <button
        type="button"
        aria-label={
          model.phase === 'not-installed'
            ? `Download ${model.label}`
            : model.phase === 'downloading'
              ? `Pause ${model.label} download`
              : model.label
        }
        onClick={() => {
          if (model.phase === 'not-installed' || model.phase === 'error') void download(model.id);
          else if (model.phase === 'downloading') void pause(model.id);
          else if (model.phase === 'paused') void resume(model.id);
        }}
        disabled={busy || model.phase === 'installed'}
        className={cn(
          'shrink-0 rounded-full transition-opacity',
          busy || model.phase === 'installed' ? 'cursor-default' : 'hover:opacity-80',
        )}
      >
        <CircularProgress value={ringValue} size={44}>
          {model.phase === 'installed' ? (
            <Check size={16} className="text-success" />
          ) : model.phase === 'error' ? (
            <AlertTriangle size={14} className="text-danger" />
          ) : busy ? (
            <Spinner size={14} />
          ) : model.phase === 'downloading' ? (
            <Pause size={13} className="text-fg" />
          ) : model.phase === 'paused' ? (
            <span className="font-mono text-[10px] font-semibold text-muted">
              {Math.round(model.percent ?? 0)}
            </span>
          ) : (
            <ArrowDownToLine size={15} className="text-accent" />
          )}
        </CircularProgress>
      </button>

      {/* Label + live status */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-fg">{model.label}</span>
          {/* STT + VAD are what the mic needs to hear you; TTS only powers
              spoken replies. Tag them so it's obvious which to install. */}
          {model.kind === 'tts' ? (
            <span className="shrink-0 rounded border border-line px-1.5 py-px text-[10px] text-faint">
              Optional
            </span>
          ) : (
            <span className="shrink-0 rounded border border-line-strong px-1.5 py-px text-[10px] text-muted">
              Required for voice input
            </span>
          )}
          {model.phase === 'downloading' && (
            <span className="font-mono text-[11px] tabular-nums text-accent">
              {Math.round(model.percent ?? 0)}%
            </span>
          )}
        </div>
        <span className="truncate text-[11px] leading-relaxed text-faint">
          {model.description}
        </span>
        <span
          className={cn(
            'truncate font-mono text-[11px] tabular-nums',
            model.phase === 'error' ? 'text-danger' : 'text-muted',
          )}
          title={model.phase === 'error' ? model.error : undefined}
        >
          {statusLine(model)}
        </span>
      </div>

      {/* Phase-appropriate inline actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {model.phase === 'not-installed' && (
          <ActionButton label="Download" onClick={() => void download(model.id)} />
        )}
        {model.phase === 'downloading' && (
          <>
            <ActionButton label="Pause" onClick={() => void pause(model.id)} />
            <ActionButton label="Cancel" onClick={() => void cancel(model.id)} danger />
          </>
        )}
        {model.phase === 'paused' && (
          <>
            <ActionButton label="Resume" onClick={() => void resume(model.id)} />
            <ActionButton label="Cancel" onClick={() => void cancel(model.id)} danger />
          </>
        )}
        {model.phase === 'error' && (
          <ActionButton label="Retry" onClick={() => void download(model.id)} />
        )}
        {model.phase === 'installed' && (
          <>
            {model.updateAvailable && (
              <ActionButton label="Update" onClick={() => void download(model.id)} />
            )}
            <ActionButton label="Verify" onClick={() => void verify(model.id)} />
            <ActionButton label="Remove" onClick={() => void remove(model.id)} danger />
          </>
        )}
      </div>
    </div>
  );
}
