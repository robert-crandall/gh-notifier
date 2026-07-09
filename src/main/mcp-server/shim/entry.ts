/**
 * The shipped stdio-shim entrypoint. The Copilot app spawns this (via
 * `~/.mcp.json`) as a stdio MCP server. It bridges that stdio channel to the
 * app's loopback MCP server:
 *
 *   Copilot app  <--stdio-->  [this shim]  <--Streamable HTTP-->  loopback server
 *
 * It reads `~/.gh-projects/run/{port,token}` on each connect attempt (the token
 * rotates per app launch), dials the loopback server with a bearer header, and
 * proxies via `runShimProxy`. When the app isn't running, `tools/list` still
 * returns the static manifest and `tools/call` returns a clean error — it never
 * hangs.
 *
 * This file is bundled self-contained (`bun build --target=node`) into
 * `build/mcp-shim.cjs` and shipped UNPACKED, then run via Electron-as-Node. It
 * must import ONLY the SDK + dependency-free helpers (never electron / sqlite),
 * and must write nothing to stdout except the MCP protocol (diagnostics → stderr).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readRunFiles } from '../runfiles'
import { runShimProxy, type LoopbackClient } from './proxy'

/** Connect a fresh loopback client from the current run files. Throws when down. */
async function connectLoopback(): Promise<LoopbackClient> {
  const endpoint = readRunFiles()
  if (endpoint === null) throw new Error('run files absent')

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${endpoint.port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } } }
  )
  const client = new Client({ name: 'gh-projects-shim', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)

  return {
    callTool: async (name, args): Promise<CallToolResult> => {
      const result = await client.callTool({ name, arguments: args })
      return result as CallToolResult
    },
    close: async (): Promise<void> => {
      await client.close()
    },
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  const proxy = await runShimProxy({ connect: connectLoopback, transport })

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    proxy.close().finally(() => process.exit(0))
  }
  // Exit when the stdio channel closes (Copilot app went away) or on a signal.
  proxy.server.onclose = shutdown
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  // Never leak details to stdout; a terse stderr line aids debugging.
  process.stderr.write(`[gh-projects-shim] fatal: ${err instanceof Error ? err.message : 'error'}\n`)
  process.exit(1)
})
