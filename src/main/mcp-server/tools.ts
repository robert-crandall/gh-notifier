/**
 * Wires the tool manifest to a low-level MCP `Server`: registers the `tools/list`
 * and `tools/call` request handlers. This is the ONE place tools are registered;
 * later epic issues add tools by extending `tool-manifest.ts` + the handler map
 * here.
 *
 * `tools/list` is served straight from `TOOL_MANIFEST` (the same source the shim
 * uses), so the advertised surface can't drift. `tools/call` output is scrubbed
 * through `sanitizeMcpJson` as defense-in-depth before it leaves the process.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { PING_TOOL_NAME, TOOL_MANIFEST } from './tool-manifest'
import { sanitizeMcpJson } from './sanitize'

/** Dependencies a tool handler may need. */
export interface ToolDeps {
  /**
   * The current set of secret strings to scrub from tool output (rotating token,
   * GitHub PAT, …). Read lazily so a rotated token is always current.
   */
  getSecrets: () => readonly string[]
}

/** A tool handler: validated args in, an MCP `CallToolResult` out. */
export type ToolHandler = (
  args: Record<string, unknown>
) => CallToolResult | Promise<CallToolResult>

/** Build the name → handler map. Foundation surface: just `ping`. */
export function buildToolHandlers(_deps: ToolDeps): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  handlers.set(PING_TOOL_NAME, () => ({ content: [{ type: 'text', text: 'pong' }] }))
  return handlers
}

/** Register `tools/list` + `tools/call` on `server`, driven by the manifest. */
export function registerTools(server: Server, deps: ToolDeps): void {
  const handlers = buildToolHandlers(deps)

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_MANIFEST.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name } = request.params
    const args = request.params.arguments ?? {}
    const handler = handlers.get(name)
    if (handler === undefined) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
    const result = await handler(args)
    // Defense-in-depth: scrub any known secret that slipped into the output.
    return sanitizeMcpJson(result, deps.getSecrets()) as CallToolResult
  })
}
