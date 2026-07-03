/**
 * IPC handlers for the Service Manager (Scripts & Services). Registered through
 * `handle()`, so every call inherits sender-origin validation. Names are
 * whitelist-validated in the manager; ids are checked here (CLAUDE.md §6).
 */
import { IpcChannels } from '@shared/ipc-channels';
import { SESSION_LIMITS } from '@shared/constants';
import type { ServiceInfo } from '@shared/types';
import { handle } from './registry';
import type { ServiceManager } from '../managers/services/ServiceManager';

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > SESSION_LIMITS.idMax) {
    throw new Error('service: invalid id');
  }
}

export function registerServiceHandlers(services: ServiceManager): void {
  handle<[string], ServiceInfo[]>(IpcChannels.serviceList, (_e, sessionId) => {
    assertValidId(sessionId);
    return services.listForSession(sessionId);
  });

  handle<[string, string], ServiceInfo>(IpcChannels.serviceStart, (_e, sessionId, name) => {
    assertValidId(sessionId);
    return services.start(sessionId, name);
  });

  handle<[string, string], void>(IpcChannels.serviceStop, (_e, sessionId, name) => {
    assertValidId(sessionId);
    return services.stop(sessionId, name);
  });

  handle<[string, string], ServiceInfo>(IpcChannels.serviceRestart, (_e, sessionId, name) => {
    assertValidId(sessionId);
    return services.restart(sessionId, name);
  });

  handle<[string, string], void>(IpcChannels.scriptRun, (_e, sessionId, name) => {
    assertValidId(sessionId);
    services.runScript(sessionId, name);
  });
}
