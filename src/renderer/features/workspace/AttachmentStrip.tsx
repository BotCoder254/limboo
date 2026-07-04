/**
 * The composer's attachment strip — draft attachments rendered as compact
 * chips above the input row, ChatGPT-style. Lives INSIDE the composer card so
 * the whole surface reads as one input; hidden entirely while empty.
 */
import type { AttachmentMeta } from '@shared/types';
import { useAttachmentStore } from '@/renderer/stores/useAttachmentStore';
import { AttachmentChip } from './AttachmentChip';

export function AttachmentStrip({
  sessionId,
  drafts,
}: {
  sessionId: string;
  drafts: AttachmentMeta[];
}) {
  const progress = useAttachmentStore((s) => s.progress);
  const remove = useAttachmentStore((s) => s.remove);
  const reveal = useAttachmentStore((s) => s.reveal);

  if (drafts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line px-1 pb-2 pt-0.5">
      {drafts.map((meta) => (
        <AttachmentChip
          key={meta.id}
          meta={meta}
          progress={progress[meta.id]}
          onRemove={() => void remove(sessionId, meta.id)}
          onClick={meta.status === 'uploading' ? undefined : () => reveal(sessionId, meta.id)}
        />
      ))}
    </div>
  );
}
