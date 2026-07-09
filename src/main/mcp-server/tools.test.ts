import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { registerTools } from './tools'
import { PING_TOOL_NAME } from './tool-manifest'

/** Stand up a low-level Server with the tools registered, over an in-memory pair. */
async function withServer(
  getSecrets: () => readonly string[],
  fn: (client: Client) => Promise<void>
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
  registerTools(server, { getSecrets })
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
      () => [],
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
      () => [],
      async (client) => {
        const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
        expect(result.content).toEqual([{ type: 'text', text: 'pong' }])
      }
    )
  })

  it('returns an isError result for an unknown tool', async () => {
    await withServer(
      () => [],
      async (client) => {
        const result = (await client.callTool({ name: 'does-not-exist' })) as CallToolResult
        expect(result.isError).toBe(true)
      }
    )
  })
})
