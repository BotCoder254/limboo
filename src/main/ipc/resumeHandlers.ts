/**
 * IPC handlers for the Resume Pipeline. Registered through `handle()`, so every
 * call inherits sender-origin validation. The entire surface takes **string
 * session ids only** (length-capped here in the main process, CLAUDE.md §6) —
 * no renderer-supplied objects ever cross this boundary, so there is no
 * prototype-pollution surface. `revalidate` is additionally restricted to the
 * active session: the renderer may nudge a re-check of what it is looking at,
 * never drive git work against arbitrary sessions.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SESSION_LIMITS } from '@shared/constants';
import type { RepoDelta, ResumeState } from '@shared/types';
import { handle } from './registry';
import type { ResumeManager } from '../managers/resume/ResumeManager';
import type { SessionManager } from '../managers/SessionManager';

function assertSessionId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > SESSION_LIMITS.idMax) {
    throw new Error('resume: invalid session id');
  }
}

export function registerResumeHandlers(resume: ResumeManager, sessions: SessionManager): void {
  handle(IpcChannels.resumeGetState, (_e, sessionId: unknown): ResumeState => {
    assertSessionId(sessionId);
    return resume.getState(sessionId);
  });

  handle(IpcChannels.resumeGetDelta, (_e, sessionId: unknown): RepoDelta | null => {
    assertSessionId(sessionId);
    return resume.getDelta(sessionId);
  });

  handle(IpcChannels.resumeDismiss, (_e, sessionId: unknown): void => {
    assertSessionId(sessionId);
    resume.dismiss(sessionId);
  });

  handle(IpcChannels.resumeRevalidate, (_e, sessionId: unknown): void => {
    assertSessionId(sessionId);
    if (sessionId !== sessions.getActive()?.id) {
      throw new Error('resume: revalidate is limited to the active session');
    }
    void resume.revalidate(sessionId);
  });
}
