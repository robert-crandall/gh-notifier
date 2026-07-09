import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keep the electron + native module graph out of these tests; we only exercise
// the serialization/guard logic with fakes.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp/gh-mcp-nonexistent-shim-dir' },
}))
vi.mock('../auth/storage', () => ({ loadToken: () => null }))

const startMcpServer = vi.fn()
const enableMcpJsonEntry = vi.fn()
const disableMcpJsonEntry = vi.fn()
const cleanupRunFiles = vi.fn()

vi.mock('./server', () => ({ startMcpServer: (...a: unknown[]) => startMcpServer(...a) }))
vi.mock('./mcp-json', () => ({
  enableMcpJsonEntry: (...a: unknown[]) => enableMcpJsonEntry(...a),
  disableMcpJsonEntry: (...a: unknown[]) => disableMcpJsonEntry(...a),
  MANAGED_MARKER_ENV: 'GH_PROJECTS_MCP_MANAGED',
  MANAGED_MARKER_VALUE: '1',
}))
vi.mock('./runfiles', () => ({ cleanupRunFiles: (...a: unknown[]) => cleanupRunFiles(...a) }))

type Lifecycle = typeof import('./lifecycle')

async function freshLifecycle(): Promise<Lifecycle> {
  vi.resetModules()
  return import('./lifecycle')
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  startMcpServer.mockReset()
  enableMcpJsonEntry.mockReset()
  disableMcpJsonEntry.mockReset()
  cleanupRunFiles.mockReset()
})

describe('lifecycle serialization', () => {
  it('two concurrent enables start the loopback server exactly once', async () => {
    let closeCount = 0
    startMcpServer.mockImplementation(async () => {
      await tick() // simulate startup latency during which a second enable races
      return { port: 1234, close: async () => { closeCount++ } }
    })
    const lifecycle = await freshLifecycle()

    await Promise.all([lifecycle.enableMcpServer(), lifecycle.enableMcpServer()])

    expect(startMcpServer).toHaveBeenCalledTimes(1)
    expect(lifecycle.isMcpServerRunning()).toBe(true)
    expect(closeCount).toBe(0)
  })

  it('enable then shutdown closes the server and leaves nothing running', async () => {
    let closeCount = 0
    startMcpServer.mockResolvedValue({ port: 1, close: async () => { closeCount++ } })
    const lifecycle = await freshLifecycle()

    await lifecycle.enableMcpServer()
    await lifecycle.shutdownMcpServer()

    expect(closeCount).toBe(1)
    expect(lifecycle.isMcpServerRunning()).toBe(false)
    // Shutdown leaves ~/.mcp.json alone (quit != disable).
    expect(disableMcpJsonEntry).not.toHaveBeenCalled()
  })

  it('a shutdown queued during an in-flight start still closes that server', async () => {
    let closeCount = 0
    startMcpServer.mockImplementation(async () => {
      await tick()
      return { port: 2, close: async () => { closeCount++ } }
    })
    const lifecycle = await freshLifecycle()

    // Fire enable and shutdown back-to-back without awaiting the enable first.
    const enabling = lifecycle.enableMcpServer()
    const shuttingDown = lifecycle.shutdownMcpServer()
    await Promise.all([enabling, shuttingDown])

    // Serialized: start completes, THEN shutdown closes it. No orphan server.
    expect(startMcpServer).toHaveBeenCalledTimes(1)
    expect(closeCount).toBe(1)
    expect(lifecycle.isMcpServerRunning()).toBe(false)
  })

  it('disable removes the mcp.json entry', async () => {
    startMcpServer.mockResolvedValue({ port: 3, close: async () => {} })
    const lifecycle = await freshLifecycle()

    await lifecycle.enableMcpServer()
    await lifecycle.disableMcpServer()

    expect(disableMcpJsonEntry).toHaveBeenCalledTimes(1)
    expect(lifecycle.isMcpServerRunning()).toBe(false)
  })
})
