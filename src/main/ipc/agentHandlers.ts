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
  AgentMode,
  AgentSessionSnapshot,
  AgentState,
  ClarificationDecision,
  PermissionDecision,
  SessionPlan,
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

/** Default to implement when unspecified; reject any value outside the union. */
function assertMode(value: unknown): AgentMode {
  if (value === undefined) return 'implement';
  if (value !== 'plan' && value !== 'implement') {
    throw new Error('Agent mode must be "plan" or "implement"');
  }
  return value;
}

export function registerAgentHandlers(agent: AgentManager): void {
  handle<[], AgentInstall>(IpcChannels.agentGetInstall, () => agent.getInstall());

  handle<[], AgentState>(IpcChannels.agentGetState, () => agent.getState());

  handle<[string], AgentSessionSnapshot>(IpcChannels.agentGetSnapshot, (_event, sessionId) =>
    agent.getSnapshot(assertSessionId(sessionId)),
  );

  handle<[string, string, AgentMode?, string?], void>(
    IpcChannels.agentSend,
    async (_event, sessionId, prompt, mode, clientMessageId) => {
      const id = assertSessionId(sessionId);
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new Error('Prompt must be a non-empty string');
      }
      if (prompt.length > AGENT_LIMITS.promptMax) {
        throw new Error('Prompt is too long');
      }
      // Optional renderer-supplied id so the optimistic bubble and the persisted
      // message share one id (dedup on echo). Validated: a short, plain string.
      const clientId =
        typeof clientMessageId === 'string' &&
        clientMessageId.length > 0 &&
        clientMessageId.length <= 64
          ? clientMessageId
          : undefined;
      await agent.send(id, prompt, assertMode(mode), clientId);
    },
  );

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

  /* ---- Plan Mode ---- */

  handle<[string], SessionPlan | null>(IpcChannels.agentGetPlan, (_event, sessionId) =>
    agent.getPlan(assertSessionId(sessionId)),
  );

  handle<[string], void>(IpcChannels.agentApprovePlan, async (_event, sessionId) => {
    await agent.approvePlan(assertSessionId(sessionId));
  });

  handle<[string], void>(IpcChannels.agentRejectPlan, (_event, sessionId) => {
    agent.rejectPlan(assertSessionId(sessionId));
  });

  handle<[string, string?], void>(
    IpcChannels.agentRegeneratePlan,
    async (_event, sessionId, extra) => {
      const id = assertSessionId(sessionId);
      if (extra !== undefined && typeof extra !== 'string') {
        throw new Error('Regenerate instructions must be a string');
      }
      if (typeof extra === 'string' && extra.length > AGENT_LIMITS.promptMax) {
        throw new Error('Regenerate instructions are too long');
      }
      await agent.regeneratePlan(id, extra);
    },
  );

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

  handle<[ClarificationDecision], void>(
    IpcChannels.agentClarificationRespond,
    (_event, decision) => {
      if (!decision || typeof decision !== 'object') {
        throw new Error('Expected a clarification decision object');
      }
      assertNoPollutingKeys(decision as unknown as Record<string, unknown>);
      if (typeof decision.id !== 'string' || decision.id.length === 0) {
        throw new Error('Clarification decision requires an id');
      }
      if (!decision.answers || typeof decision.answers !== 'object' || Array.isArray(decision.answers)) {
        throw new Error('Clarification answers must be an object');
      }
      // The answers object is used as a key map and forwarded to the SDK — screen
      // every key for prototype pollution and cap sizes (CLAUDE.md §6).
      assertNoPollutingKeys(decision.answers as Record<string, unknown>);
      const keys = Object.keys(decision.answers);
      if (keys.length > 4) {
        throw new Error('Too many clarification answers');
      }
      const answers: Record<string, string | string[]> = {};
      for (const key of keys) {
        if (key.length > 1000) throw new Error('Clarification question key is too long');
        const value = (decision.answers as Record<string, unknown>)[key];
        if (typeof value === 'string') {
          answers[key] = value.slice(0, 2000);
        } else if (Array.isArray(value)) {
          answers[key] = value
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 8)
            .map((v) => v.slice(0, 2000));
        } else {
          throw new Error('Clarification answer must be a string or string array');
        }
      }
      const response =
        typeof decision.response === 'string' ? decision.response.slice(0, 2000) : undefined;
      agent.respondClarification({ id: decision.id, answers, response });
    },
  );
}
