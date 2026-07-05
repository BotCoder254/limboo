/**
 * One attachment chip — the compact card rendered in the composer strip
 * (drafts, removable) and on sent user messages (read-only). Leading visual is
 * the image thumbnail when available, else the per-language file icon; the
 * trailing slot reflects the lifecycle: a circular progress ring while staging,
 * a check once the agent actually read the file, a warning for elevated-risk
 * or errored files, and a remove button for drafts.
 */
import { AlertTriangle, Check, X } from 'lucide-react';
import type { AttachmentMeta } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { CircularProgress } from '@/renderer/components/ui';
import { getFileIcon } from '@/renderer/lib/fileIcons';
import { formatBytes } from '@/renderer/lib/format';

/** Short human label for the type column (extension over raw MIME noise). */
function typeLabel(meta: AttachmentMeta): string {
  const dot = meta.name.lastIndexOf('.');
  if (dot > 0 && dot < meta.name.length - 1) return meta.name.slice(dot + 1).toUpperCase();
  return meta.category;
}

export function AttachmentChip({
  meta,
  progress,
  onRemove,
  onClick,
}: {
  meta: AttachmentMeta;
  /** Live staging progress (0–100) while `status === 'uploading'`. */
  progress?: number;
  /** Present only for composer drafts — sent chips are read-only. */
  onRemove?: () => void;
  /** Optional activation (e.g. reveal in the OS file manager). */
  onClick?: () => void;
}) {
  const { icon: Icon, className: iconClass } = getFileIcon(meta.name);
  const uploading = meta.status === 'uploading';
  const warn = meta.status === 'error' || meta.risk === 'elevated';

  return (
    <div
      className={cn(
        'group flex max-w-[220px] items-center gap-2 rounded-lg border bg-surface px-2 py-1.5',
        warn ? 'border-warning/40' : 'border-line',
        onClick && 'cursor-pointer transition-colors hover:bg-elevated',
      )}
      onClick={onClick}
      title={meta.error ?? `${meta.name} — ${formatBytes(meta.size)}`}
    >
      {meta.thumb ? (
        <img
          src={meta.thumb}
          alt=""
          className="h-8 w-8 shrink-0 rounded object-cover"
          draggable={false}
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-surface-2">
          <Icon size={15} className={iconClass} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-tight text-fg">{meta.name}</span>
        <span className="block truncate text-[10px] leading-tight text-muted">
          {typeLabel(meta)} · {formatBytes(meta.size)}
          {meta.status === 'read' && ' · read'}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {uploading ? (
          <CircularProgress value={progress ?? 0} size={16} />
        ) : meta.status === 'error' ? (
          <AlertTriangle size={13} className="text-danger" />
        ) : meta.risk === 'elevated' ? (
          <AlertTriangle size={13} className="text-warning" />
        ) : meta.status === 'read' ? (
          <Check size={13} className="text-success" />
        ) : null}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label={`Remove ${meta.name}`}
          >
            <X size={12} />
          </button>
        )}
      </span>
    </div>
  );
}
