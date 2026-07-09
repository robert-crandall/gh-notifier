import { describe, it, expect, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startMcpServer, type McpServerHandle } from './server'
import { readRunFiles } from './runfiles'
import { PING_TOOL_NAME } from './tool-manifest'

/**
 * Stand up the REAL loopback server and drive it with a REAL SDK client over
 * Streamable HTTP. This proves the server end to end without needing the Copilot
 * app. Uses a temp run dir so the developer's real ~/.gh-projects/run is untouched.
 */

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

async function startServer(): Promise<{ handle: McpServerHandle; dir: string; token: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'gh-mcp-srv-'))
  const handle = await startMcpServer({ runDir: dir })
  cleanups.push(async () => {
    await handle.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const endpoint = readRunFiles(dir)
  if (endpoint === null) throw new Error('run files were not published')
  expect(endpoint.port).toBe(handle.port)
  return { handle, dir, token: endpoint.token }
}

function connectClient(port: number, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'integration-test', version: '1.0.0' }, { capabilities: {} })
  cleanups.push(async () => {
    await client.close()
  })
  return client.connect(transport).then(() => client)
}

/** Raw request with full header control, for the negative security-gate tests. */
function rawPost(
  port: number,
  headers: Record<string, string>,
  body: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
})

describe('loopback MCP server (real SDK client)', () => {
  it('initialize advertises tool capability', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    expect(client.getServerCapabilities()?.tools).toBeDefined()
  })

  it('lists the ping tool', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain(PING_TOOL_NAME)
  })

  it('calls ping and gets pong (separate POST from list — stateless)', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    await client.listTools()
    const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
  })

  it('rotates the token per launch', async () => {
    const first = await startServer()
    const second = await startServer()
    expect(first.token).not.toBe(second.token)
  })
})

describe('loopback MCP server security gate (raw requests)', () => {
  it('401s a missing/bad bearer token', async () => {
    const { handle } = await startServer()
    const status = await rawPost(
      handle.port,
      { host: `127.0.0.1:${handle.port}`, 'content-type': 'application/json' },
      INIT_BODY
    )
    expect(status).toBe(401)
    const badToken = await rawPost(
      handle.port,
      { host: `127.0.0.1:${handle.port}`, authorization: 'Bearer wrong', 'content-type': 'application/json' },
      INIT_BODY
    )
    expect(badToken).toBe(401)
  })

  it('403s a request carrying an Origin header (browser gate)', async () => {
    const { handle, token } = await startServer()
    const status = await rawPost(
      handle.port,
      {
        host: `127.0.0.1:${handle.port}`,
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      INIT_BODY
    )
    expect(status).toBe(403)
  })

  it('403s a mismatched Host header (DNS-rebinding defense)', async () => {
    const { handle, token } = await startServer()
    const status = await rawPost(
      handle.port,
      { host: 'evil.example.com', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      INIT_BODY
    )
    expect(status).toBe(403)
  })

  it('404s a wrong path', async () => {
    const { handle, token } = await startServer()
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: '/nope',
          method: 'POST',
          headers: { host: `127.0.0.1:${handle.port}`, authorization: `Bearer ${token}` },
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        }
      )
      req.on('error', reject)
      req.end(INIT_BODY)
    })
    expect(status).toBe(404)
  })

  it('400s an authorized POST with an empty body', async () => {
    const { handle, token } = await startServer()
    const status = await rawPost(
      handle.port,
      { host: `127.0.0.1:${handle.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ''
    )
    expect(status).toBe(400)
  })

  it('does not hang the server when a client aborts mid-request', async () => {
    const { handle, token } = await startServer()
    // Announce a body via Content-Length but destroy the socket before sending it.
    await new Promise<void>((resolve) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: handle.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host: `127.0.0.1:${handle.port}`,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': '100',
        },
      })
      req.on('error', () => resolve()) // destroy → error, which is expected
      req.write('{"partial":')
      req.destroy()
      setTimeout(resolve, 50)
    })
    // The server must still answer a fresh, well-formed request.
    const client = await connectClient(handle.port, token)
    const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
  })
})
