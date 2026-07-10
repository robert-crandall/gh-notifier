import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { registerTools, type ToolDeps } from './tools'
import { PING_TOOL_NAME, ADD_TODO_TOOL_NAME } from './tool-manifest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))

import { getDb } from '../db/index'
import { runMigrations } from '../db/migrate'

beforeEach(() => {
  const db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

/** Stand up a low-level Server with the tools registered, over an in-memory pair. */
async function withServer(
  deps: ToolDeps,
  fn: (client: Client) => Promise<void>
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
  registerTools(server, deps)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} })
  await client.connect(clientTransport)
  try {
    await fn(client)
  } finally {
    await client.close()
    await server.close()
  }
}

describe('registerTools', () => {
  it('advertises the ping tool via tools/list', async () => {
    await withServer(
      { getSecrets: () => [] },
      async (client) => {
        const { tools } = await client.listTools()
        const ping = tools.find((t) => t.name === PING_TOOL_NAME)
        expect(ping).toBeDefined()
        expect(ping?.inputSchema.type).toBe('object')
      }
    )
  })

  it('ping returns pong', async () => {
    await withServer(
      { getSecrets: () => [] },
      async (client) => {
        const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
        expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
      }
    )
  })

  it('returns an isError result for an unknown tool', async () => {
    await withServer(
      { getSecrets: () => [] },
      async (client) => {
        const result = (await client.callTool({ name: 'does-not-exist' })) as CallToolResult
        expect(result.isError).toBe(true)
      }
    )
  })
})

describe('add_todo registration', () => {
  it('advertises add_todo via tools/list', async () => {
    await withServer(
      { getSecrets: () => [] },
      async (client) => {
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain(ADD_TODO_TOOL_NAME)
      }
    )
  })

  it('fires onTodoChanged after a successful add_todo', async () => {
    const onTodoChanged = vi.fn()
    await withServer(
      { getSecrets: () => [], onTodoChanged },
      async (client) => {
        const result = (await client.callTool({
          name: ADD_TODO_TOOL_NAME,
          arguments: { title: 'A todo' },
        })) as CallToolResult
        expect(result.isError).toBeFalsy()
      }
    )
    expect(onTodoChanged).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onTodoChanged when the call errors', async () => {
    const onTodoChanged = vi.fn()
    await withServer(
      { getSecrets: () => [], onTodoChanged },
      async (client) => {
        const result = (await client.callTool({
          name: ADD_TODO_TOOL_NAME,
          arguments: {}, // missing title -> isError
        })) as CallToolResult
        expect(result.isError).toBe(true)
      }
    )
    expect(onTodoChanged).not.toHaveBeenCalled()
  })

  it('converts a handler exception into an isError result (no transport failure, no onTodoChanged)', async () => {
    const onTodoChanged = vi.fn()
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('db exploded')
    })
    await withServer(
      { getSecrets: () => [], onTodoChanged },
      async (client) => {
        const result = (await client.callTool({
          name: ADD_TODO_TOOL_NAME,
          arguments: { title: 'x' }, // valid input, but the DB access throws
        })) as CallToolResult
        expect(result.isError).toBe(true)
        // The generic failure text must not leak the thrown error's message.
        const text = result.content[0]
        expect(text.type === 'text' && text.text.includes('exploded')).toBe(false)
      }
    )
    expect(onTodoChanged).not.toHaveBeenCalled()
  })
})
