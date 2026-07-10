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
import {
  ADD_TODO_TOOL_NAME,
  GET_PROJECT_CONTEXT_TOOL_NAME,
  GET_REENTRY_DIGEST_TOOL_NAME,
  LIST_PROJECTS_TOOL_NAME,
  PING_TOOL_NAME,
  READ_SERVICE_KNOWLEDGE_TOOL_NAME,
  WRITE_SERVICE_KNOWLEDGE_TOOL_NAME,
  TOOL_MANIFEST,
  findManifestTool,
} from './tool-manifest'
import { MAX_TEXT_LEN, sanitizeMcpJson } from './sanitize'
import { runAddTodo } from './add-todo'
import { runGetProjectContext, runGetReentryDigest, runListProjects } from './read-context'
import { runReadServiceKnowledge } from './read-service-knowledge'
import { runWriteServiceKnowledge } from './write-service-knowledge'

/** Dependencies a tool handler may need. */
export interface ToolDeps {
  /**
   * The current set of secret strings to scrub from tool output (rotating token,
   * GitHub PAT, …). Read lazily so a rotated token is always current.
   */
  getSecrets: () => readonly string[]
  /**
   * Fired after a tool successfully mutates todo state (the `add_todo` tool). The app uses
   * this to push a `todos:updated` event so open todo surfaces reload live. Optional so tests
   * and the shim can omit it.
   */
  onTodoChanged?: () => void
  /**
   * Fired after a tool successfully writes service knowledge (`write_service_knowledge`). The
   * app uses this to push a `knowledge:updated` event so open project runbook surfaces reload
   * live. Optional so tests and the shim can omit it.
   */
  onKnowledgeChanged?: () => void
}

/** A tool handler: validated args in, an MCP `CallToolResult` out. */
export type ToolHandler = (
  args: Record<string, unknown>
) => CallToolResult | Promise<CallToolResult>

/** Build the name → handler map. */
export function buildToolHandlers(deps: ToolDeps): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  handlers.set(PING_TOOL_NAME, () => ({ content: [{ type: 'text', text: 'pong' }] }))
  handlers.set(ADD_TODO_TOOL_NAME, (args) => {
    const result = runAddTodo(args)
    if (result.isError !== true) deps.onTodoChanged?.()
    return result
  })
  // Read-only context tools (#106): expose the app's own computed state. They mutate nothing,
  // so they take no deps and never fire onTodoChanged.
  handlers.set(LIST_PROJECTS_TOOL_NAME, () => runListProjects())
  handlers.set(GET_PROJECT_CONTEXT_TOOL_NAME, (args) => runGetProjectContext(args))
  handlers.set(GET_REENTRY_DIGEST_TOOL_NAME, (args) => runGetReentryDigest(args))
  handlers.set(READ_SERVICE_KNOWLEDGE_TOOL_NAME, (args) => runReadServiceKnowledge(args))
  handlers.set(WRITE_SERVICE_KNOWLEDGE_TOOL_NAME, async (args) => {
    const result = await runWriteServiceKnowledge(args)
    if (result.isError !== true) deps.onKnowledgeChanged?.()
    return result
  })
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
    let result: CallToolResult
    try {
      result = await handler(args)
    } catch (err) {
      // A tool handler that throws (e.g. a DB error) must surface as a clean isError result,
      // not a transport-level failure. Never echo the error detail — it could carry a secret
      // or an internal path. (onTodoChanged/onKnowledgeChanged live inside the handler and only
      // fire on a successful result, so a throw here never triggers them.)
      console.error(`[mcp-server] tool "${name}" threw:`, err instanceof Error ? err.name : 'error')
      result = { content: [{ type: 'text', text: `Tool "${name}" failed.` }], isError: true }
    }
    // Defense-in-depth: scrub any known secret that slipped into the output. Most
    // tools keep the small default cap; a tool with legitimately large output
    // (reading a runbook) opts into a larger `maxOutputLen` via the manifest.
    const maxOutputLen = findManifestTool(name)?.maxOutputLen ?? MAX_TEXT_LEN
    return sanitizeMcpJson(result, deps.getSecrets(), maxOutputLen) as CallToolResult
  })
}
