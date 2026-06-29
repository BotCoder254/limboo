/**
 * Session checkpoints — lightweight recovery points stored as dedicated git refs.
 * Browse them, restore the working tree to any one (a safety checkpoint of the
 * current state is created first), or delete stale ones. Auto-checkpoints (made
 * before agent edits) are tagged so they're distinguishable from manual ones.
 */
import { useEffect, useState } from 'react';
import { History, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { GitCheckpoint } from '@shared/types';
import { EmptyState, IconButton } from '@/renderer/components/ui';
import { relativeTime } from '@/renderer/lib/format';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useUIStore } from '@/renderer/stores/useUIStore';

export function GitCheckpoints() {
  const checkpoints = useGitStore((s) => s.checkpoints);
  const loadCheckpoints = useGitStore((s) => s.loadCheckpoints);

  useEffect(() => {
    void loadCheckpoints();
  }, [loadCheckpoints]);

  if (checkpoints.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No checkpoints yet"
        description="Snapshots of the working tree — created automatically before agent edits, or manually — appear here for instant recovery."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {checkpoints.map((cp) => (
        <CheckpointRow key={cp.id} checkpoint={cp} />
      ))}
    </ul>
  );
}

function CheckpointRow({ checkpoint }: { checkpoint: GitCheckpoint }) {
  const restoreCheckpoint = useGitStore((s) => s.restoreCheckpoint);
  const deleteCheckpoint = useGitStore((s) => s.deleteCheckpoint);
  const addToast = useUIStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      await restoreCheckpoint(checkpoint.id);
      addToast({ title: `Restored to "${checkpoint.label}"`, tone: 'info' });
    } catch (err) {
      addToast({
        title: 'Could not restore checkpoint',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      {checkpoint.auto ? (
        <Sparkles size={13} className="shrink-0 text-accent" />
      ) : (
        <History size={13} className="shrink-0 text-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-fg" title={checkpoint.label}>
          {checkpoint.label}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-faint">
          <span>{relativeTime(checkpoint.createdAt)}</span>
          <span>
            {checkpoint.files.length} file{checkpoint.files.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Restore" size="sm" onClick={() => void restore()} disabled={busy}>
          <RotateCcw size={13} />
        </IconButton>
        <IconButton
          label="Delete checkpoint"
          size="sm"
          onClick={() => void deleteCheckpoint(checkpoint.id)}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </li>
  );
}
