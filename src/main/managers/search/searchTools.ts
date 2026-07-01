/**
 * Search tools — an in-process MCP server that lets the coding agent query the
 * local Search Engine on demand. The Search Engine is the app's **retrieval**
 * layer: these tools help the agent decide *what* to explore before it invokes its
 * own authoritative Read/Grep/Glob. They never replace those tools.
 *
 * Security (CLAUDE.md §6): every tool is read-only and scoped to the active
 * workspace. They are auto-allowed in `AgentManager.makeCanUseTool` precisely
 * because they cannot mutate anything. The SDK is ESM-only, so
 * `createSdkMcpServer`/`tool` are passed in from the runtime-loaded module rather
 * than statically imported here.
 */
import { z } from 'zod';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { SearchHit } from '@shared/types';
import type { SearchManager } from './SearchManager';
import type { WorkspaceManager } from '../WorkspaceManager';

type SdkMcpApi = Pick<typeof import('@anthropic-ai/claude-agent-sdk'), 'createSdkMcpServer' | 'tool'>;

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

/** One hit as a single compact, navigable line. */
function fmt(h: SearchHit): string {
  const loc = h.line ? `${h.path}:${h.line}` : h.path ?? h.ref;
  if (h.kind === 'symbol') return `- [${h.symbolKind ?? 'symbol'}] ${h.title} — ${loc}`;
  if (h.kind === 'file' || h.kind === 'doc') return `- ${loc}`;
  return `- [${h.kind}] ${h.title}${h.subtitle ? ` — ${h.subtitle}` : ''}`;
}

/**
 * Build the `limboo_search` MCP server exposing read-only retrieval tools to the
 * agent. Returns a server instance ready to drop into `Options.mcpServers`.
 */
export function createSearchMcpServer(
  sdk: SdkMcpApi,
  search: SearchManager,
  workspace: WorkspaceManager,
): McpSdkServerConfigWithInstance {
  const { createSdkMcpServer, tool } = sdk;
  const wsId = (): string | null => workspace.getActive()?.id ?? null;

  return createSdkMcpServer({
    name: 'limboo_search',
    version: '1.0.0',
    tools: [
      tool(
        'search_project',
        'Retrieve the files, symbols and documentation the local Search Engine ' +
          'judges most relevant to a query, across the whole workspace. Use this ' +
          'FIRST to decide what to open — then read the ranked results with your own ' +
          'Read/Grep/Glob tools. Faster than blind exploration.',
        {
          query: z.string().min(1).describe('What to look for (keywords, a symbol name, a phrase).'),
          limit: z.number().int().min(1).max(50).optional().describe('Max hits per group (default 12).'),
        },
        async (args) => {
          const groups = search.globalSearch(args.query, { workspaceId: wsId(), limit: args.limit ?? 12 });
          if (groups.length === 0) return text(`No matches for "${args.query}".`);
          const body = groups
            .map((g) => `${g.label}:\n${g.hits.map(fmt).join('\n')}`)
            .join('\n\n');
          return text(body);
        },
      ),
      tool(
        'find_files',
        'Find workspace files by name, path fragment, or content. Returns ranked, ' +
          'workspace-relative paths to open.',
        {
          query: z.string().min(1).describe('Filename, path fragment, or content keywords.'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20).'),
        },
        async (args) => {
          const hits = search.searchFiles(args.query, { workspaceId: wsId(), limit: args.limit ?? 20 });
          if (hits.length === 0) return text(`No files match "${args.query}".`);
          return text(hits.map(fmt).join('\n'));
        },
      ),
      tool(
        'find_symbols',
        'Find declarations (functions, classes, interfaces, types, …) by name across ' +
          'the workspace. Returns path:line locations to jump to.',
        {
          query: z.string().min(1).describe('Symbol name or fragment.'),
          limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20).'),
        },
        async (args) => {
          const hits = search.searchSymbols(args.query, { workspaceId: wsId(), limit: args.limit ?? 20 });
          if (hits.length === 0) return text(`No symbols match "${args.query}".`);
          return text(hits.map(fmt).join('\n'));
        },
      ),
    ],
  });
}
