import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { runShimProxy, type LoopbackClient, type ShimProxyDeps } from './proxy'
import { PING_TOOL_NAME } from '../tool-manifest'

/**
 * Drive the shim's MCP `Server` with a REAL SDK `Client` over an in-memory
 * transport pair, so we exercise the exact `tools/list` / `tools/call` request
 * flow without spawning a process or opening a socket. The loopback `connect`
 * dependency is faked per test.
 */
async function withShim(
  connect: ShimProxyDeps['connect'],
  fn: (client: Client) => Promise<void>,
  timeoutMs = 200
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const proxy = await runShimProxy({ connect, transport: serverTransport, timeoutMs })
  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} })
  await client.connect(clientTransport)
  try {
    await fn(client)
  } finally {
    await client.close()
    await proxy.close()
  }
}

/** A fake loopback client whose `callTool` behavior is scripted per attempt. */
function fakeClient(callTool: LoopbackClient['callTool']): LoopbackClient {
  return { callTool, close: async () => {} }
}

const pong: CallToolResult = { content: [{ type: 'text', text: 'pong' }] }

describe('shim proxy: tools/list', () => {
  it('returns the static manifest even when the app is down (never empty)', async () => {
    const connect = async (): Promise<LoopbackClient> => {
      throw new Error('run files absent')
    }
    await withShim(connect, async (client) => {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain(PING_TOOL_NAME)
    })
  })

  it('does not connect to the loopback just to list tools', async () => {
    let connects = 0
    const connect = async (): Promise<LoopbackClient> => {
      connects++
      throw new Error('should not be called')
    }
    await withShim(connect, async (client) => {
      await client.listTools()
    })
    expect(connects).toBe(0)
  })
})

describe('shim proxy: tools/call (app running)', () => {
  it('forwards the call and returns the loopback result', async () => {
    const connect = async (): Promise<LoopbackClient> =>
      fakeClient(async (name) => (name === PING_TOOL_NAME ? pong : { content: [], isError: true }))
    await withShim(connect, async (client) => {
      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result).toEqual(pong)
    })
  })

  it('forwards a tool-level isError result WITHOUT retrying', async () => {
    let calls = 0
    const appError: CallToolResult = { content: [{ type: 'text', text: 'boom' }], isError: true }
    const connect = async (): Promise<LoopbackClient> =>
      fakeClient(async () => {
        calls++
        return appError
      })
    await withShim(connect, async (client) => {
      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result).toEqual(appError)
    })
    expect(calls).toBe(1) // no retry on a legitimate tool error
  })
})

describe('shim proxy: tools/call (app down / stale)', () => {
  it('returns a clean isError when the app is not running', async () => {
    const connect = async (): Promise<LoopbackClient> => {
      throw new Error('run files absent')
    }
    await withShim(connect, async (client) => {
      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/isn't running/)
    })
  })

  it.each([
    ['connection refused', new Error('ECONNREFUSED')],
    ['timeout', new Error('request timed out')],
    ['401 rotated token', new Error('HTTP 401')],
    ['5xx startup race', new Error('HTTP 503')],
    ['invalid/non-MCP response', new Error('invalid JSON-RPC response')],
  ])('self-heals after a first-attempt %s by reconnecting once', async (_label, err) => {
    let connects = 0
    let attempt = 0
    const connect = async (): Promise<LoopbackClient> => {
      connects++
      return fakeClient(async () => {
        attempt++
        if (attempt === 1) throw err // first attempt fails
        return pong // second (post-reconnect) attempt succeeds
      })
    }
    await withShim(connect, async (client) => {
      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result).toEqual(pong)
    })
    expect(connects).toBe(2) // disposed + reconnected exactly once
  })

  it('returns one clean error after TWO consecutive failures', async () => {
    let attempt = 0
    const connect = async (): Promise<LoopbackClient> =>
      fakeClient(async () => {
        attempt++
        throw new Error('HTTP 500')
      })
    await withShim(connect, async (client) => {
      const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/isn't running/)
    })
    expect(attempt).toBe(2) // one retry, then give up
  })

  it('never hangs when connect never resolves (per-attempt timeout)', async () => {
    const connect = (): Promise<LoopbackClient> => new Promise<LoopbackClient>(() => {})
    await withShim(
      connect,
      async (client) => {
        const result = (await client.callTool({ name: PING_TOOL_NAME })) as CallToolResult
        expect(result.isError).toBe(true)
      },
      50
    )
  })
})
