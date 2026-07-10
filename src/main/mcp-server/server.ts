/**
 * The inbound loopback MCP server, hosted in the Electron main process. Bound to
 * `127.0.0.1:<ephemeral>`, it speaks MCP over Streamable HTTP using the SDK's
 * server transport. The stdio shim (spawned by the Copilot app) is the only
 * intended client.
 *
 * Why Streamable HTTP (not WebSocket like the OUTBOUND path): the SDK ships a
 * first-class server transport for Streamable HTTP but NONE for WebSocket, so WS
 * would mean hand-rolling MCP-over-WS server framing. We own both ends here, so
 * we use the SDK's supported transport — the protocol can only break in one seam.
 *
 * Stateless design: one local consumer doing tool calls needs no session state.
 * For each `POST /mcp` we build a fresh `Server` + `StreamableHTTPServerTransport`
 * (sessionIdGenerator undefined, enableJsonResponse), handle the one request, and
 * tear both down. No session map / GET-SSE / DELETE lifecycle.
 *
 * Security is enforced by `authorizeRequest` BEFORE the body is parsed and BEFORE
 * the SDK sees anything: POST /mcp only, Host == 127.0.0.1:port, loopback remote
 * address, reject-if-Origin-present, and the rotating bearer token. The token is
 * never logged.
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools, type ToolDeps } from './tools'
import { authorizeRequest, MAX_BODY_BYTES, type RequestMeta } from './security'
import { generateToken } from './token'
import { runDir as defaultRunDir, cleanupRunFiles, writeRunFiles } from './runfiles'

const SERVER_NAME = 'gh-projects'
const SERVER_VERSION = '1.0.0'

export interface StartMcpServerOptions {
  /** Override the run-files dir (tests). Defaults to `~/.gh-projects/run`. */
  runDir?: string
  /** Extra secrets to scrub from tool output beyond the rotating token (e.g. PAT). */
  extraSecrets?: () => readonly string[]
  /** Token generator (tests may inject a fixed value). Defaults to `generateToken`. */
  generateTokenFn?: () => string
  /** Called after a tool successfully mutates todo state, so the app can push `todos:updated`. */
  onTodoChanged?: () => void
  /** Called after a tool successfully writes service knowledge, so the app can push `knowledge:updated`. */
  onKnowledgeChanged?: () => void
}

export interface McpServerHandle {
  /** The bound loopback port. */
  port: number
  /** Stop the HTTP server and remove the run files. Idempotent. */
  close: () => Promise<void>
}

/** Build a fresh MCP `Server` that advertises tool capability + registers tools. */
function createConfiguredServer(deps: ToolDeps): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  )
  registerTools(server, deps)
  return server
}

/** Read the request body with a hard size cap, then JSON-parse it. */
function readBody(
  req: IncomingMessage,
  max: number
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (value: { ok: true; body: unknown } | { ok: false; status: number }): void => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      if (size > max) {
        req.destroy()
        finish({ ok: false, status: 413 })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      // An empty/whitespace body is not a valid JSON-RPC message — reject cleanly
      // rather than forwarding `undefined` (which the transport surfaces as a 500).
      if (raw.trim().length === 0) {
        finish({ ok: false, status: 400 })
        return
      }
      try {
        finish({ ok: true, body: JSON.parse(raw) })
      } catch {
        finish({ ok: false, status: 400 })
      }
    })
    req.on('error', () => finish({ ok: false, status: 400 }))
    // If the client aborts/closes before 'end', 'close' fires without 'end' —
    // resolve so the per-request handler never awaits forever. After a normal
    // 'end' this is a no-op (finish is idempotent).
    req.on('close', () => finish({ ok: false, status: 400 }))
  })
}

/** Send a minimal JSON error response (never leaks the token). */
function sendError(res: ServerResponse, status: number, reason: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify({ error: reason }))
}

function requestMeta(req: IncomingMessage): RequestMeta {
  // Pathname only — strip any query string. req.url is a path for HTTP servers.
  const rawUrl = req.url ?? ''
  const path = rawUrl.split('?', 1)[0]
  return {
    method: req.method,
    path,
    host: req.headers.host,
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
    authorization: req.headers.authorization,
    remoteAddress: req.socket.remoteAddress,
  }
}

/**
 * Start the loopback MCP server. Resolves once it is listening AND the run files
 * have been published (so a reader never sees a port that isn't accepting yet).
 */
export function startMcpServer(options: StartMcpServerOptions = {}): Promise<McpServerHandle> {
  const dir = options.runDir ?? defaultRunDir()
  const token = (options.generateTokenFn ?? generateToken)()
  const toolDeps: ToolDeps = {
    getSecrets: () => [token, ...(options.extraSecrets?.() ?? [])],
    onTodoChanged: options.onTodoChanged,
    onKnowledgeChanged: options.onKnowledgeChanged,
  }

  const httpServer: HttpServer = createServer((req, res) => {
    void handleRequest(req, res)
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (httpServer.address() as AddressInfo | null)?.port ?? 0
    const verdict = authorizeRequest(requestMeta(req), { port, token })
    if (!verdict.ok) {
      sendError(res, verdict.status, verdict.reason)
      return
    }

    const body = await readBody(req, MAX_BODY_BYTES)
    if (!body.ok) {
      sendError(res, body.status, body.status === 413 ? 'payload too large' : 'invalid json')
      return
    }

    // Fresh per-request server + stateless transport (see file header).
    const server = createConfiguredServer(toolDeps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    let closed = false
    const teardown = (): void => {
      if (closed) return
      closed = true
      transport.close().catch(() => {})
      server.close().catch(() => {})
    }
    // Covers the normal path (response finished/aborted).
    res.on('close', teardown)
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body.body)
    } catch (err) {
      // Never surface internals (which could include a secret) to the client.
      console.error('[mcp-server] request handling failed:', err instanceof Error ? err.name : 'error')
      sendError(res, 500, 'internal error')
      teardown()
    }
  }

  return new Promise<McpServerHandle>((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      const port = (httpServer.address() as AddressInfo).port
      // Publish run files only after listen() has succeeded. If publication fails
      // (unwritable dir, disk error, …), tear the server back down and reject the
      // start — never leave a listening server without discoverable run files.
      try {
        writeRunFiles({ port, token }, dir)
      } catch (err) {
        cleanupRunFiles(dir)
        httpServer.close()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      let stopped = false
      resolve({
        port,
        close: () =>
          new Promise<void>((resolveClose) => {
            if (stopped) {
              resolveClose()
              return
            }
            stopped = true
            cleanupRunFiles(dir)
            httpServer.close(() => resolveClose())
          }),
      })
    })
  })
}
