/**
 * Attachment store — the renderer mirror of the main-process Attachment
 * Manager. Holds every session's attachment set (drafts + sent) plus live
 * staging progress. All mutations go through `window.limboo.attachment.*`;
 * main pushes the authoritative set back via `attachment:changed`, so this
 * store never invents state — it only reflects it.
 */
import { create } from 'zustand';
import type { AttachmentMeta } from '@shared/types';
import { useUIStore } from './useUIStore';

interface AttachmentStoreState {
  /** All attachments per session (drafts + sent), oldest first. */
  bySession: Record<string, AttachmentMeta[]>;
  /** Live staging progress per attachment id (0–100). */
  progress: Record<string, number>;
  /** True once the push-event subscriptions are installed. */
  hydrated: boolean;

  /** Install push-event subscriptions (once, on boot). */
  hydrate: () => void;
  /** Load a session's attachment set (on session open/switch). */
  loadSession: (sessionId: string) => Promise<void>;
  /** Open the native file picker and stage the selection. */
  pickFiles: (sessionId: string) => Promise<void>;
  /** Stage files dropped onto the composer. */
  addDropped: (sessionId: string, files: File[]) => Promise<void>;
  /** Stage an image pasted into the composer. */
  pasteImage: (sessionId: string, file: File) => Promise<void>;
  remove: (sessionId: string, id: string) => Promise<void>;
  reveal: (sessionId: string, id: string) => void;
}

/** Composer drafts = attachments not yet bound to a sent message. */
export function draftAttachments(list: AttachmentMeta[] | undefined): AttachmentMeta[] {
  return (list ?? []).filter((a) => a.messageId === null);
}

function toastError(title: string, err: unknown): void {
  useUIStore.getState().addToast({
    title,
    description: err instanceof Error ? err.message : String(err),
    tone: 'danger',
  });
}

export const useAttachmentStore = create<AttachmentStoreState>((set, get) => ({
  bySession: {},
  progress: {},
  hydrated: false,

  hydrate: () => {
    const api = window.limboo?.attachment;
    if (!api || get().hydrated) return;
    api.onChanged(({ sessionId, attachments }) => {
      set((state) => {
        // Drop progress entries for attachments that finished staging.
        const uploading = new Set(
          attachments.filter((a) => a.status === 'uploading').map((a) => a.id),
        );
        const progress: Record<string, number> = {};
        for (const [id, pct] of Object.entries(state.progress)) {
          if (uploading.has(id)) progress[id] = pct;
        }
        return {
          bySession: { ...state.bySession, [sessionId]: attachments },
          progress,
        };
      });
    });
    api.onProgress(({ id, percent }) => {
      set((state) => ({ progress: { ...state.progress, [id]: percent } }));
    });
    set({ hydrated: true });
  },

  loadSession: async (sessionId) => {
    const api = window.limboo?.attachment;
    if (!api) return;
    try {
      const attachments = await api.list(sessionId);
      set((state) => ({ bySession: { ...state.bySession, [sessionId]: attachments } }));
    } catch {
      /* Session may be gone; the empty state is fine. */
    }
  },

  pickFiles: async (sessionId) => {
    const api = window.limboo?.attachment;
    if (!api) return;
    const before = new Set((get().bySession[sessionId] ?? []).map((a) => a.id));
    try {
      const metas = await api.pickFiles(sessionId);
      notifyDuplicates(metas, before);
    } catch (err) {
      toastError('Could not attach files', err);
    }
  },

  addDropped: async (sessionId, files) => {
    const api = window.limboo?.attachment;
    if (!api || files.length === 0) return;
    const paths: string[] = [];
    for (const file of files) {
      try {
        const p = api.getPathForFile(file);
        if (p) paths.push(p);
      } catch {
        /* Non-filesystem drop (e.g. text selection) — skipped. */
      }
    }
    if (paths.length === 0) return;
    const before = new Set((get().bySession[sessionId] ?? []).map((a) => a.id));
    try {
      const metas = await api.addPaths(sessionId, paths);
      notifyDuplicates(metas, before);
    } catch (err) {
      toastError('Could not attach files', err);
    }
  },

  pasteImage: async (sessionId, file) => {
    const api = window.limboo?.attachment;
    if (!api) return;
    const before = new Set((get().bySession[sessionId] ?? []).map((a) => a.id));
    try {
      const bytes = await file.arrayBuffer();
      const meta = await api.addPasted(
        sessionId,
        file.name || `pasted-${Date.now()}.png`,
        file.type,
        bytes,
      );
      notifyDuplicates([meta], before);
    } catch (err) {
      toastError('Could not attach the image', err);
    }
  },

  remove: async (sessionId, id) => {
    const api = window.limboo?.attachment;
    if (!api) return;
    try {
      await api.remove(sessionId, id);
    } catch (err) {
      toastError('Could not remove the attachment', err);
    }
  },

  reveal: (sessionId, id) => {
    void window.limboo?.attachment?.reveal(sessionId, id);
  },
}));

/** Content-identical re-attaches return the existing row — tell the user. */
function notifyDuplicates(metas: AttachmentMeta[], before: Set<string>): void {
  const dupes = metas.filter((m) => before.has(m.id));
  if (dupes.length === 0) return;
  useUIStore.getState().addToast({
    title: dupes.length === 1 ? 'Already attached' : 'Some files were already attached',
    description: dupes.map((d) => d.name).join(', '),
    tone: 'warning',
  });
}
