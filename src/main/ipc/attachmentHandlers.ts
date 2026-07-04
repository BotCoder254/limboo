/**
 * IPC handlers for the Attachment Manager. Reached from the renderer through
 * `window.limboo.attachment.*`. Every handler validates and caps its input
 * before it touches the manager (CLAUDE.md §6): ids/paths are bounded strings,
 * pasted bytes are size-capped, and the manager re-validates everything again
 * (realpath, magic bytes, session ownership) as defense in depth.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { ATTACHMENT_LIMITS } from '@shared/constants';
import type { AttachmentMeta } from '@shared/types';
import type { AttachmentManager } from '../managers/attachments/AttachmentManager';
import { handle } from './registry';

function assertSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error('Expected a valid session id');
  }
  return value;
}

function assertAttachmentId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > ATTACHMENT_LIMITS.idMax ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error('Expected a valid attachment id');
  }
  return value;
}

export function registerAttachmentHandlers(attachments: AttachmentManager): void {
  handle<[string], AttachmentMeta[]>(IpcChannels.attachmentList, (_event, sessionId) =>
    attachments.list(assertSessionId(sessionId)),
  );

  handle<[string], AttachmentMeta[]>(IpcChannels.attachmentPickFiles, (_event, sessionId) =>
    attachments.pickAndAdd(assertSessionId(sessionId)),
  );

  handle<[string, string[]], AttachmentMeta[]>(
    IpcChannels.attachmentAddPaths,
    (_event, sessionId, paths) => {
      const id = assertSessionId(sessionId);
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new Error('Expected a non-empty array of paths');
      }
      if (paths.length > ATTACHMENT_LIMITS.maxFilesPerMessage.max) {
        throw new Error('Too many files');
      }
      for (const p of paths) {
        if (typeof p !== 'string' || p.length === 0 || p.length > ATTACHMENT_LIMITS.pathMax) {
          throw new Error('Invalid path');
        }
      }
      return attachments.addFromPaths(id, paths, 'drop');
    },
  );

  handle<[string, string, string, ArrayBuffer], AttachmentMeta>(
    IpcChannels.attachmentAddPasted,
    (_event, sessionId, name, mime, bytes) => {
      const id = assertSessionId(sessionId);
      if (typeof name !== 'string' || name.length > ATTACHMENT_LIMITS.nameMax * 2) {
        throw new Error('Invalid file name');
      }
      if (typeof mime !== 'string' || mime.length === 0 || mime.length > 64) {
        throw new Error('Invalid MIME type');
      }
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
        throw new Error('Expected image bytes');
      }
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer);
      if (view.byteLength === 0 || view.byteLength > ATTACHMENT_LIMITS.pasteBytesMax) {
        throw new Error('Pasted image is too large');
      }
      return attachments.addFromBytes(id, name, mime, view);
    },
  );

  handle<[string, string], void>(IpcChannels.attachmentRemove, (_event, sessionId, id) => {
    attachments.remove(assertSessionId(sessionId), assertAttachmentId(id));
  });

  handle<[string, string], void>(IpcChannels.attachmentReveal, (_event, sessionId, id) => {
    attachments.reveal(assertSessionId(sessionId), assertAttachmentId(id));
  });
}
