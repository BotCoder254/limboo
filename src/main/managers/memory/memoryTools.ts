/**
 * Memory tools — an in-process MCP server that lets the coding agent **read** the
 * Local Memory System on demand. Without this the agent only sees the static
 * `<project-memory>` block injected once at the start of a run, so a follow-up like
 * "read my memories" has nothing to call and the agent ends up describing the
 * system instead of listing entries. These tools give it a live, read-only view.
 *
 * Security (CLAUDE.md §6): every tool is read-only and scoped to the active
 * workspace (plus global-scope rows). They are auto-allowed in
 * `AgentManager.makeCanUseTool` precisely because they cannot mutate anything.
 * The SDK is ESM-only, so `createSdkMcpServer`/`tool` are passed in from the
 * runtime-loaded module rather than statically imported here.
 */
import { z } from 'zod';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { Memory, MemoryTier } from '@shared/types';
import { intArg, strArg, type PlainTool } from '../cursor/bridge/plainTool';
import type { MemoryManager } from './MemoryManager';
import type { WorkspaceManager } from '../WorkspaceManager';

/** The two SDK factories we need, taken from the runtime-loaded (ESM) module. */
type SdkMcpApi = Pick<
  typeof import('@anthropic-ai/claude-agent-sdk'),
  'createSdkMcpServer' | 'tool'
>;

const TIER_VALUES = [
  'session',
  'workspace',
  'project',
  'preference',
  'convention',
  'decision',
  'solution',
  'note',
] as const;

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

/** One memory rendered as a single compact, readable line. */
function fmt(m: Memory): string {
  const body = m.body.replace(/\s+/g, ' ').trim();
  const tags = [
    m.pinned ? 'pinned' : null,
    `confidence ${Math.round(m.confidence * 100)}%`,
    m.status !== 'active' ? m.status : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `- [${m.tier}] ${m.title}${body ? ` — ${body}` : ''}${tags ? ` (${tags})` : ''}`;
}

/**
 * The `limboo_memory` tool set as transport-neutral plain tools — the single
 * handler implementation behind both the SDK-shaped server (Claude runs) and
 * the stdio bridge dispatcher (Cursor runs). Read-only, workspace-scoped.
 */
export function memoryPlainTools(memory: MemoryManager, workspace: WorkspaceManager): PlainTool[] {
  const wsId = (): string | null => workspace.getActive()?.id ?? null;
  return [
    {
      name: 'list_memories',
      description:
        "List the developer's stored Limboo memories — durable project knowledge " +
        '(decisions, conventions, preferences, solutions, notes). Call this ' +
        'whenever the user asks what you remember or to read/show/list their ' +
        'memories, instead of describing the memory system.',
      inputSchema: {
        type: 'object',
        properties: {
          tier: {
            type: 'string',
            enum: [...TIER_VALUES],
            description: 'Only return memories of this tier.',
          },
          includeArchived: {
            type: 'boolean',
            description: 'Include archived memories (default false).',
          },
          limit: { type: 'number', description: 'Max entries to return (default 50).' },
        },
      },
      run: (args) => {
        const tier = strArg(args.tier, 40);
        const rows = memory.list({
          workspaceId: wsId(),
          tiers:
            tier && (TIER_VALUES as readonly string[]).includes(tier)
              ? [tier as MemoryTier]
              : undefined,
          includeArchived: args.includeArchived === true,
          limit: intArg(args.limit, 1, 200, 50),
        });
        if (rows.length === 0) return 'No memories are stored yet.';
        return (
          `You have ${rows.length} stored ${rows.length === 1 ? 'memory' : 'memories'}:\n` +
          rows.map(fmt).join('\n')
        );
      },
    },
    {
      name: 'search_memories',
      description:
        "Full-text search the developer's stored Limboo memories by keyword (BM25). " +
        'Use for questions like "what do you know about X".',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search memory titles and bodies.' },
          limit: { type: 'number', description: 'Max matches (default 20).' },
        },
        required: ['query'],
      },
      run: (args) => {
        const query = strArg(args.query);
        if (!query) return 'A non-empty "query" is required.';
        const rows = memory.search(query, { workspaceId: wsId(), limit: intArg(args.limit, 1, 200, 20) });
        if (rows.length === 0) return `No memories match "${query}".`;
        return (
          `${rows.length} ${rows.length === 1 ? 'match' : 'matches'} for "${query}":\n` +
          rows.map(fmt).join('\n')
        );
      },
    },
    {
      name: 'list_memory_proposals',
      description:
        'List pending memory proposals (auto-captured from commits/conversations) ' +
        "that are awaiting the developer's acceptance.",
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const rows = memory.listProposals(wsId());
        if (rows.length === 0) return 'No pending memory proposals.';
        return (
          `${rows.length} pending ${rows.length === 1 ? 'proposal' : 'proposals'}:\n` +
          rows.map(fmt).join('\n')
        );
      },
    },
  ];
}

/** Zod arg shapes per memory tool (the SDK path keeps typed validation). */
const MEMORY_ZOD_ARGS: Record<string, Record<string, z.ZodTypeAny>> = {
  list_memories: {
    tier: z.enum(TIER_VALUES).optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  search_memories: {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
  },
  list_memory_proposals: {},
};

/**
 * Build the `limboo_memory` MCP server exposing read-only memory tools to the
 * agent. Returns a server instance ready to drop into `Options.mcpServers`.
 */
export function createMemoryMcpServer(
  sdk: SdkMcpApi,
  memory: MemoryManager,
  workspace: WorkspaceManager,
): McpSdkServerConfigWithInstance {
  const { createSdkMcpServer, tool } = sdk;
  return createSdkMcpServer({
    name: 'limboo_memory',
    version: '1.0.0',
    tools: memoryPlainTools(memory, workspace).map((t) =>
      tool(t.name, t.description, MEMORY_ZOD_ARGS[t.name] ?? {}, async (args) =>
        text(t.run(args as Record<string, unknown>)),
      ),
    ),
  });
}
