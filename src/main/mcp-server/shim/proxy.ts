/**
 * The stdio shim's proxy LOGIC (transport-agnostic + dependency-injected so it's
 * unit-testable without spawning anything). The Copilot app spawns the shim as a
 * stdio MCP server; this runs a low-level `Server` over that stdio transport and:
 *
 *   - `tools/list` → serves the bundled static manifest ALWAYS. The advertised
 *     surface is therefore stable and never empty, even when the app is down, so
 *     the host can't cache "no tools". Shim + server ship together, so no drift.
 *   - `tools/call` → forwards to the loopback server. It re-reads the run files
 *     per attempt (never caches a dead client) and, on ANY first-attempt failure
 *     that could mean stale state (connect refused/reset, timeout, 401/403 rotated
 *     token, 5xx startup/shutdown race, invalid/non-MCP response), disposes the
 *     client and retries ONCE with the current token/port. Two failures → one
 *     clean "app isn't running" result. A per-attempt timeout guarantees no hang.
 *
 * A tool that legitimately RETURNS `isError: true` is NOT a transport failure —
 * it's forwarded as-is with no retry.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_MANIFEST } from '../tool-manifest'

const SHIM_NAME = 'gh-projects'
const SHIM_VERSION = '1.0.0'
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000

/** The minimal loopback surface the shim needs. Injected so tests can fake it. */
export interface LoopbackClient {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}

export interface ShimProxyDeps {
  /**
   * Connect a FRESH loopback client — reads the run files and dials the loopback
   * server. Throws when the app isn't running (no run files) or connect fails.
   */
  connect: () => Promise<LoopbackClient>
  /** The stdio transport to serve MCP over (a StdioServerTransport in prod). */
  transport: Transport
  /** Per-attempt timeout guard (ms). Default 10s. Prevents any hang. */
  timeoutMs?: number
}

/** The clean result surfaced when the loopback app can't be reached. */
export function appNotRunningResult(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: "The GH Projects app isn't running, so this tool is unavailable. Start GH Projects and try again.",
      },
    ],
    isError: true,
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('loopback attempt timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

/**
 * Holds the (lazily connected) loopback client and implements reread+retry-once.
 * Every failure disposes the client so the next attempt reconnects with fresh
 * run-file values — this is what heals app restarts and token rotation.
 */
class LoopbackSession {
  private client: LoopbackClient | null = null

  constructor(
    private readonly connect: () => Promise<LoopbackClient>,
    private readonly timeoutMs: number
  ) {}

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    // At most two attempts total (one retry). Any connect/transport failure
    // disposes the client and counts as a failed attempt.
    for (let attempt = 1; attempt <= 2; attempt++) {
      let client: LoopbackClient
      try {
        client = this.client ?? (await withTimeout(this.connect(), this.timeoutMs))
        this.client = client
      } catch {
        this.client = null
        if (attempt === 2) return appNotRunningResult()
        continue
      }
      try {
        return await withTimeout(client.callTool(name, args), this.timeoutMs)
      } catch {
        // Transport/auth/protocol failure (incl. non-2xx like 401/5xx): dispose
        // and, on the first attempt, reconnect with fresh run-file values.
        await this.dispose()
        if (attempt === 2) return appNotRunningResult()
      }
    }
    return appNotRunningResult()
  }

  async dispose(): Promise<void> {
    const client = this.client
    this.client = null
    if (client !== null) {
      try {
        await client.close()
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Build + connect the shim's MCP server over the given stdio transport. Returns
 * the connected `Server` plus a `close()` that tears down both the server and any
 * live loopback client.
 */
export async function runShimProxy(
  deps: ShimProxyDeps
): Promise<{ server: Server; close: () => Promise<void> }> {
  const session = new LoopbackSession(deps.connect, deps.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS)
  const server = new Server(
    { name: SHIM_NAME, version: SHIM_VERSION },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_MANIFEST.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, (request): Promise<CallToolResult> => {
    const { name } = request.params
    const args = request.params.arguments ?? {}
    return session.call(name, args)
  })

  await server.connect(deps.transport)

  return {
    server,
    close: async (): Promise<void> => {
      await session.dispose()
      await server.close()
    },
  }
}
