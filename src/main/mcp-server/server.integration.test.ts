import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startMcpServer, type McpServerHandle } from './server'
import { readRunFiles } from './runfiles'
import { PING_TOOL_NAME, ADD_TODO_TOOL_NAME } from './tool-manifest'

// The `add_todo` tool's import graph reaches the DB layer (and, through it, electron).
// Mock electron so `runMigrations` resolves the migrations dir, and mock the DB singleton
// so the in-process server's tool handler writes to a real in-memory SQLite we control.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { createProject, getProject, listInboxTodos, deleteTodo, restoreTodo } from '../db/projects'
import { createRepoRule } from '../db/notifications'

/**
 * Stand up the REAL loopback server and drive it with a REAL SDK client over
 * Streamable HTTP. This proves the server end to end without needing the Copilot
 * app. Uses a temp run dir so the developer's real ~/.gh-projects/run is untouched.
 */

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

// A fresh in-memory DB per test, wired into the mocked getDb so the tool handler writes to it.
beforeEach(() => {
  const db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
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

describe('add_todo tool over the real loopback server', () => {
  function callAddTodo(client: Client, args: Record<string, unknown>): Promise<CallToolResult> {
    return client.callTool({ name: ADD_TODO_TOOL_NAME, arguments: args }) as Promise<CallToolResult>
  }
  function textOf(result: CallToolResult): string {
    const first = result.content[0]
    return first.type === 'text' ? first.text : ''
  }

  it('advertises add_todo in tools/list', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain(ADD_TODO_TOOL_NAME)
  })

  it('lands a todo on the routed project, is undoable, and dedups a repeat', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)

    const project = createProject('Widgets')
    createRepoRule('acme', 'widgets', project.id)

    // 1. Create — lands on the routed project.
    const created = await callAddTodo(client, {
      repo: 'acme/widgets',
      title: 'Approve PR',
      sourceUrl: 'https://github.com/acme/widgets/pull/9',
      suggestedAction: { kind: 'pr_comment', url: 'https://github.com/acme/widgets/pull/9', comment: 'well thought out!' },
    })
    expect(created.isError).toBeFalsy()
    expect(textOf(created)).toMatch(/Created/)
    let todos = getProject(project.id).todos
    expect(todos).toHaveLength(1)
    expect(todos[0].origin).toBe('copilot')
    const todoId = todos[0].id

    // 2. Undo — soft-delete then restore round-trips (the app's undo affordance).
    deleteTodo(todoId)
    expect(getProject(project.id).todos).toHaveLength(0)
    restoreTodo(todoId)
    expect(getProject(project.id).todos).toHaveLength(1)

    // 3. Re-review the same PR + same action — updates in place, never duplicates.
    const repeat = await callAddTodo(client, {
      repo: 'acme/widgets',
      title: 'Approve PR (rechecked)',
      sourceUrl: 'https://github.com/acme/widgets/pull/9',
      suggestedAction: { kind: 'pr_comment', url: 'https://github.com/acme/widgets/pull/9', comment: 'well thought out!' },
    })
    expect(textOf(repeat)).toMatch(/Updated/)
    todos = getProject(project.id).todos
    expect(todos).toHaveLength(1)
    expect(todos[0].id).toBe(todoId)
    expect(todos[0].title).toBe('Approve PR (rechecked)')
  })

  it('drops an unresolved repo into the Inbox surface', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const result = await callAddTodo(client, { repo: 'unknown/repo', title: 'Stray' })
    expect(textOf(result)).toMatch(/Inbox/)
    expect(listInboxTodos().map((t) => t.title)).toContain('Stray')
  })

  it('returns an error result for a missing title', async () => {
    const { handle, token } = await startServer()
    const client = await connectClient(handle.port, token)
    const result = await callAddTodo(client, { repo: 'acme/widgets' })
    expect(result.isError).toBe(true)
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
