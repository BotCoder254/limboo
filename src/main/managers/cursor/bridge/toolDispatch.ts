/**
 * MCP request dispatcher for the per-run bridge pipe — the main-process half
 * of {@link file://./mcpBridge.cjs}. Serves `tools/list` / `tools/call` for
 * the `limboo_memory` and `limboo_search` servers from the SAME plain-tool
 * handlers the Claude in-process servers use, so both agents query one memory
 * and one repository index.
 *
 * Security (CLAUDE.md §6): the surface is strictly read-only (the plain tools
 * cannot mutate anything), args are validated/bounded inside each tool, and
 * all better-sqlite3 access stays in this process.
 */
import { memoryPlainTools } from '../../memory/memoryTools';
import { searchPlainTools } from '../../search/searchTools';
import type { MemoryManager } from '../../memory/MemoryManager';
import type { SearchManager } from '../../search/SearchManager';
import type { WorkspaceManager } from '../../WorkspaceManager';
import type { PlainTool } from './plainTool';

export interface McpDispatcher {
  dispatch(server: string, method: string, params: Record<string, unknown>): unknown;
}

/** MCP result content wrapper (same shape the SDK servers return). */
function text(s: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text: s }], isError };
}

export function createMcpDispatcher(
  memory: MemoryManager | null,
  search: SearchManager | null,
  workspace: WorkspaceManager,
): McpDispatcher {
  const toolsFor = (server: string): PlainTool[] => {
    if (server === 'memory' && memory) return memoryPlainTools(memory, workspace);
    if (server === 'search' && search) return searchPlainTools(search, workspace);
    return [];
  };

  return {
    dispatch(server, method, params) {
      const tools = toolsFor(server);
      if (method === 'tools/list') {
        return {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      }
      if (method === 'tools/call') {
        const name = typeof params.name === 'string' ? params.name : '';
        const args =
          params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const tool = tools.find((t) => t.name === name);
        if (!tool) return text(`Unknown tool: ${name.slice(0, 80)}`, true);
        try {
          return text(tool.run(args));
        } catch (err) {
          return text(err instanceof Error ? err.message.slice(0, 500) : 'Tool failed.', true);
        }
      }
      throw new Error(`Unsupported MCP method: ${method.slice(0, 80)}`);
    },
  };
}
