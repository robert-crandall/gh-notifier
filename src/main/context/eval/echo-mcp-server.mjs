/**
 * SYNTHETIC stdio MCP server used only by tests + the --live resolver round-trip.
 * It proves the app-owned read path end to end without any real (SSO-gated)
 * observability tool. Exposes three tools:
 *   - echo:  returns a deterministic "live value" string built from its args.
 *   - empty: returns no content (exercises the no_data source-failure class).
 *   - fail:  returns an error result (exercises the query_invalid failure class).
 *
 * Run as: node echo-mcp-server.mjs  (spawned by the MCP client under test).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo-mcp', version: '1.0.0' })

server.registerTool(
  'echo',
  {
    description: 'Echoes a synthetic live value derived from the metric argument.',
    inputSchema: { metric: z.string().optional(), value: z.string().optional() },
  },
  async ({ metric, value }) => {
    const v = value ?? '240ms'
    const label = metric ?? 'metric'
    return { content: [{ type: 'text', text: `${label} = ${v} (synthetic)` }] }
  }
)

server.registerTool(
  'empty',
  { description: 'Returns no data.', inputSchema: {} },
  async () => ({ content: [] })
)

server.registerTool(
  'fail',
  { description: 'Returns a tool error.', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: 'query invalid: percentile disabled' }], isError: true })
)

const transport = new StdioServerTransport()
await server.connect(transport)
