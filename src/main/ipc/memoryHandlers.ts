/**
 * IPC handlers for the Local Memory System. Registered through `handle()`, so
 * every call inherits sender-origin validation. All renderer input is validated
 * here in the main process (CLAUDE.md §6): ids/strings are length-capped, tier /
 * source enums are checked, numeric confidence is bounded, and any renderer-
 * supplied object is guarded against prototype-pollution keys before use. The
 * memory store is fully local — these handlers never touch the network.
 */
import { IpcChannels } from '@shared/ipc-channels';
import { MEMORY_LIMITS } from '@shared/constants';
import type {
  Memory,
  MemoryCreateInput,
  MemoryHit,
  MemoryListFilter,
  MemoryTier,
  MemoryUpdateInput,
} from '@shared/types';
import { handle } from './registry';
import { isMemoryTier, type MemoryManager } from '../managers/memory/MemoryManager';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function assertSafeObject(value: unknown, label: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`memory: invalid ${label}`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`memory: rejected unsafe key in ${label}: ${key}`);
    }
  }
}

function assertId(id: unknown, label = 'id'): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error(`memory: invalid ${label}`);
  }
}

/** A workspace id or null (global scope). */
function assertWorkspaceId(id: unknown): asserts id is string | null {
  if (id === null) return;
  assertId(id, 'workspaceId');
}

function assertText(value: unknown, max: number, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`memory: invalid ${label}`);
  }
}

function assertTier(tier: unknown): asserts tier is MemoryTier {
  if (!isMemoryTier(tier)) throw new Error('memory: invalid tier');
}

function assertTiers(tiers: unknown): MemoryTier[] | undefined {
  if (tiers === undefined) return undefined;
  if (!Array.isArray(tiers)) throw new Error('memory: invalid tiers');
  return tiers.filter(isMemoryTier);
}

export function registerMemoryHandlers(memory: MemoryManager): void {
  handle<[MemoryListFilter], Memory[]>(IpcChannels.memoryList, (_e, filter) => {
    assertSafeObject(filter, 'filter');
    assertWorkspaceId(filter?.workspaceId ?? null);
    return memory.list({
      workspaceId: filter?.workspaceId ?? null,
      tiers: assertTiers(filter?.tiers),
      includeArchived: !!filter?.includeArchived,
      limit: typeof filter?.limit === 'number' ? filter.limit : undefined,
    });
  });

  handle<[string], Memory | null>(IpcChannels.memoryGet, (_e, id) => {
    assertId(id);
    return memory.get(id);
  });

  handle<[string, { workspaceId: string | null; tiers?: MemoryTier[]; limit?: number }], MemoryHit[]>(
    IpcChannels.memorySearch,
    (_e, query, opts) => {
      if (typeof query !== 'string' || query.length > MEMORY_LIMITS.queryMax) {
        throw new Error('memory: invalid query');
      }
      assertSafeObject(opts, 'search options');
      assertWorkspaceId(opts?.workspaceId ?? null);
      return memory.search(query, {
        workspaceId: opts?.workspaceId ?? null,
        tiers: assertTiers(opts?.tiers),
        limit: typeof opts?.limit === 'number' ? opts.limit : undefined,
      });
    },
  );

  handle<[MemoryCreateInput], Memory>(IpcChannels.memoryCreate, (_e, input) => {
    assertSafeObject(input, 'create input');
    assertWorkspaceId(input?.workspaceId ?? null);
    assertTier(input?.tier);
    assertText(input?.title, MEMORY_LIMITS.titleMax, 'title');
    if (typeof input?.body !== 'string' || input.body.length > MEMORY_LIMITS.bodyMax) {
      throw new Error('memory: invalid body');
    }
    // Source references (Resume Pipeline back-links) are re-validated in the
    // manager; here we only length/shape-gate what the renderer may pass.
    const filePath =
      typeof input.filePath === 'string' && input.filePath.length <= 4096
        ? input.filePath
        : null;
    const symbolRefs = Array.isArray(input.symbolRefs)
      ? input.symbolRefs.filter((s): s is string => typeof s === 'string' && s.length <= 4096).slice(0, 50)
      : undefined;
    return memory.create({
      workspaceId: input.workspaceId ?? null,
      tier: input.tier,
      title: input.title,
      body: input.body,
      pinned: !!input.pinned,
      sessionId: typeof input.sessionId === 'string' ? input.sessionId : null,
      filePath,
      symbolRefs,
    });
  });

  handle<[string, MemoryUpdateInput], Memory | null>(
    IpcChannels.memoryUpdate,
    (_e, id, patch) => {
      assertId(id);
      assertSafeObject(patch, 'update patch');
      if (patch?.tier !== undefined) assertTier(patch.tier);
      if (patch?.title !== undefined) assertText(patch.title, MEMORY_LIMITS.titleMax, 'title');
      if (patch?.body !== undefined && (typeof patch.body !== 'string' || patch.body.length > MEMORY_LIMITS.bodyMax)) {
        throw new Error('memory: invalid body');
      }
      if (patch?.confidence !== undefined && typeof patch.confidence !== 'number') {
        throw new Error('memory: invalid confidence');
      }
      return memory.update(id, {
        title: patch?.title,
        body: patch?.body,
        tier: patch?.tier,
        pinned: patch?.pinned,
        confidence: patch?.confidence,
      });
    },
  );

  handle<[string], void>(IpcChannels.memoryDelete, (_e, id) => {
    assertId(id);
    memory.delete(id);
  });

  handle<[string, boolean], void>(IpcChannels.memoryArchive, (_e, id, archived) => {
    assertId(id);
    memory.setArchived(id, !!archived);
  });

  handle<[string, boolean], void>(IpcChannels.memoryPin, (_e, id, pinned) => {
    assertId(id);
    memory.setPinned(id, !!pinned);
  });

  handle<[string | null], Memory[]>(IpcChannels.memoryListProposals, (_e, workspaceId) => {
    assertWorkspaceId(workspaceId);
    return memory.listProposals(workspaceId);
  });

  handle<[string], Memory | null>(IpcChannels.memoryAcceptProposal, (_e, id) => {
    assertId(id);
    return memory.acceptProposal(id);
  });

  handle<[string], void>(IpcChannels.memoryRejectProposal, (_e, id) => {
    assertId(id);
    memory.rejectProposal(id);
  });
}
