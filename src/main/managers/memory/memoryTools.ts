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
 * Build the `limboo_memory` MCP server exposing read-only memory tools to the
 * agent. Returns a server instance ready to drop into `Options.mcpServers`.
 */
export function createMemoryMcpServer(
  sdk: SdkMcpApi,
  memory: MemoryManager,
  workspace: WorkspaceManager,
): McpSdkServerConfigWithInstance {
  const { createSdkMcpServer, tool } = sdk;
  const wsId = (): string | null => workspace.getActive()?.id ?? null;

  return createSdkMcpServer({
    name: 'limboo_memory',
    version: '1.0.0',
    tools: [
      tool(
        'list_memories',
        "List the developer's stored Limboo memories — durable project knowledge " +
          '(decisions, conventions, preferences, solutions, notes). Call this ' +
          'whenever the user asks what you remember or to read/show/list their ' +
          'memories, instead of describing the memory system.',
        {
          tier: z.enum(TIER_VALUES).optional().describe('Only return memories of this tier.'),
          includeArchived: z
            .boolean()
            .optional()
            .describe('Include archived memories (default false).'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('Max entries to return (default 50).'),
        },
        async (args) => {
          const rows = memory.list({
            workspaceId: wsId(),
            tiers: args.tier ? [args.tier as MemoryTier] : undefined,
            includeArchived: args.includeArchived ?? false,
            limit: args.limit ?? 50,
          });
          if (rows.length === 0) return text('No memories are stored yet.');
          return text(
            `You have ${rows.length} stored ${rows.length === 1 ? 'memory' : 'memories'}:\n` +
              rows.map(fmt).join('\n'),
          );
        },
      ),
      tool(
        'search_memories',
        "Full-text search the developer's stored Limboo memories by keyword (BM25). " +
          'Use for questions like "what do you know about X".',
        {
          query: z.string().min(1).describe('Keywords to search memory titles and bodies.'),
          limit: z.number().int().min(1).max(200).optional().describe('Max matches (default 20).'),
        },
        async (args) => {
          const rows = memory.search(args.query, { workspaceId: wsId(), limit: args.limit ?? 20 });
          if (rows.length === 0) return text(`No memories match "${args.query}".`);
          return text(
            `${rows.length} ${rows.length === 1 ? 'match' : 'matches'} for "${args.query}":\n` +
              rows.map(fmt).join('\n'),
          );
        },
      ),
      tool(
        'list_memory_proposals',
        'List pending memory proposals (auto-captured from commits/conversations) ' +
          "that are awaiting the developer's acceptance.",
        {},
        async () => {
          const rows = memory.listProposals(wsId());
          if (rows.length === 0) return text('No pending memory proposals.');
          return text(
            `${rows.length} pending ${rows.length === 1 ? 'proposal' : 'proposals'}:\n` +
              rows.map(fmt).join('\n'),
          );
        },
      ),
    ],
  });
}
