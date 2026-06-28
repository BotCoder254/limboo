/**
 * IPC handlers for the Coding Agent Manager. Reached from the renderer through
 * `window.limboo.agent.*`. Every handler validates and caps its input before it
 * touches the manager (CLAUDE.md §6): prompt length is bounded, ids must be
 * non-empty strings, and any renderer-supplied object is screened for
 * prototype-polluting keys.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { AGENT_LIMITS } from '@shared/constants';
import type {
  AgentDiagnostic,
  AgentInstall,
  AgentSessionSnapshot,
  AgentState,
  PermissionDecision,
} from '@shared/types';
import type { AgentManager } from '../managers/AgentManager';
import { handle } from './registry';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertNoPollutingKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Rejected polluting key: ${key}`);
  }
}

function assertSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error('Expected a valid session id');
  }
  return value;
}

export function registerAgentHandlers(agent: AgentManager): void {
  handle<[], AgentInstall>(IpcChannels.agentGetInstall, () => agent.getInstall());

  handle<[], AgentState>(IpcChannels.agentGetState, () => agent.getState());

  handle<[string], AgentSessionSnapshot>(IpcChannels.agentGetSnapshot, (_event, sessionId) =>
    agent.getSnapshot(assertSessionId(sessionId)),
  );

  handle<[string, string], void>(IpcChannels.agentSend, async (_event, sessionId, prompt) => {
    const id = assertSessionId(sessionId);
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('Prompt must be a non-empty string');
    }
    if (prompt.length > AGENT_LIMITS.promptMax) {
      throw new Error('Prompt is too long');
    }
    await agent.send(id, prompt);
  });

  handle<[string], void>(IpcChannels.agentStop, (_event, sessionId) => {
    agent.stop(assertSessionId(sessionId));
  });

  handle<[string], void>(IpcChannels.agentClearSession, (_event, sessionId) => {
    agent.clearSession(assertSessionId(sessionId));
  });

  handle<[string | null | undefined], AgentDiagnostic[]>(
    IpcChannels.agentGetDiagnostics,
    (_event, sessionId) => {
      const id = sessionId == null ? null : assertSessionId(sessionId);
      return agent.getDiagnostics(id);
    },
  );

  handle<[], void>(IpcChannels.agentClearRateLimit, () => {
    agent.clearRateLimitManual();
  });

  handle<[], AgentInstall>(IpcChannels.agentRetryAuth, () => agent.retryAuth());

  handle<[PermissionDecision], void>(IpcChannels.agentPermissionRespond, (_event, decision) => {
    if (!decision || typeof decision !== 'object') {
      throw new Error('Expected a permission decision object');
    }
    assertNoPollutingKeys(decision as unknown as Record<string, unknown>);
    if (typeof decision.id !== 'string' || decision.id.length === 0) {
      throw new Error('Permission decision requires an id');
    }
    if (decision.behavior !== 'allow' && decision.behavior !== 'deny') {
      throw new Error('Permission decision behavior must be allow or deny');
    }
    agent.respondPermission({
      id: decision.id,
      behavior: decision.behavior,
      remember: decision.remember === true,
      message: typeof decision.message === 'string' ? decision.message.slice(0, 500) : undefined,
    });
  });
}
