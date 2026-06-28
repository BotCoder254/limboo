/**
 * Renders the transient toast queue from the UI store in the bottom-right.
 * Each toast auto-dismisses; tones map to theme status colors (solid borders).
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Toast } from '@/renderer/stores';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { cn } from '@/renderer/lib/cn';

const TONE_BORDER: Record<Toast['tone'], string> = {
  info: 'border-l-accent',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
};

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useUIStore((s) => s.dismissToast);

  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);

  return (
    <div
      className={cn(
        'animate-pop-in pointer-events-auto flex items-start gap-2 rounded-lg border border-line border-l-2 bg-elevated px-3 py-2.5 shadow-lg',
        TONE_BORDER[toast.tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[12px] text-muted">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 text-faint transition-colors hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}
