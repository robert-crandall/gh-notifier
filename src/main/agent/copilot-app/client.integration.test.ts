import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { delegateOverWs, AppUnavailableError, CreateAmbiguousError } from './client'
import type { WsEndpoint } from './discover'

type OnConnection = (socket: WsSocket, req: { headers: Record<string, unknown> }) => void

interface FakeServer {
  endpoint: WsEndpoint
  originsSeen: (string | undefined)[]
  close: () => Promise<void>
}

function startServer(onConnection: OnConnection, verifyClient?: () => boolean): Promise<FakeServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, ...(verifyClient ? { verifyClient } : {}) })
    const originsSeen: (string | undefined)[] = []
    wss.on('connection', (socket, req) => {
      originsSeen.push(req.headers.origin as string | undefined)
      onConnection(socket, req as unknown as { headers: Record<string, unknown> })
    })
    wss.on('listening', () => {
      const port = (wss.address() as AddressInfo).port
      resolve({
        endpoint: { port, token: 'test-token' },
        originsSeen,
        close: () =>
          new Promise<void>((r) => {
            // Force-terminate any lingering sockets so close() can't hang.
            for (const c of wss.clients) {
              try {
                c.terminate()
              } catch {
                /* ignore */
              }
            }
            const done = setTimeout(r, 1000)
            wss.close(() => {
              clearTimeout(done)
              r()
            })
          }),
      })
    })
  })
}

let server: FakeServer | null = null
afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

const fastOpts = { helloTimeoutMs: 1500, createTimeoutMs: 1500, sendConfirmMs: 300 }

describe('delegateOverWs — happy path', () => {
  it('completes the handshake with no Origin header, creates + sends', async () => {
    server = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'server_hello', instance_id: 'i1' }))
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'create_session') {
          socket.send(JSON.stringify({ type: 'session_created', session_id: 'srv-1', cwd: msg.cwd }))
        } else if (msg.type === 'send_message') {
          socket.send(JSON.stringify({ type: 'session_event', session_id: msg.session_id }))
        }
      })
    })

    const res = await delegateOverWs(server.endpoint, '/repos/foo', 'do it', undefined, fastOpts)
    expect(res).toEqual({ sessionId: 'srv-1', sendOk: true })
    // The Node ws client must NOT send an Origin header (the non-browser gate).
    expect(server.originsSeen).toEqual([undefined])
  })
})

describe('delegateOverWs — pre-create failures (fall-back-eligible)', () => {
  it('AppUnavailableError when the server never sends server_hello', async () => {
    server = await startServer(() => { /* silent — no hello */ })
    await expect(delegateOverWs(server.endpoint, '/x', 'p', undefined, fastOpts)).rejects.toBeInstanceOf(
      AppUnavailableError
    )
  })

  it('AppUnavailableError when the upgrade is rejected (stale token)', async () => {
    server = await startServer(() => { /* unreached */ }, () => false)
    await expect(delegateOverWs(server.endpoint, '/x', 'p', undefined, fastOpts)).rejects.toBeInstanceOf(
      AppUnavailableError
    )
  })
})

describe('delegateOverWs — idempotency boundary (post-create is NOT fall-back-eligible)', () => {
  it('CreateAmbiguousError when create_session is never acknowledged', async () => {
    server = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'server_hello', instance_id: 'i1' }))
      // deliberately never respond to create_session
    })
    await expect(delegateOverWs(server.endpoint, '/x', 'p', undefined, fastOpts)).rejects.toBeInstanceOf(
      CreateAmbiguousError
    )
  })

  it('CreateAmbiguousError when the socket closes right after create_session', async () => {
    server = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'server_hello', instance_id: 'i1' }))
      socket.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'create_session') socket.close()
      })
    })
    await expect(delegateOverWs(server.endpoint, '/x', 'p', undefined, fastOpts)).rejects.toBeInstanceOf(
      CreateAmbiguousError
    )
  })

  it('returns the session (sendOk:false) when it was created but the socket then dies', async () => {
    server = await startServer((socket) => {
      socket.send(JSON.stringify({ type: 'server_hello', instance_id: 'i1' }))
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'create_session') {
          socket.send(JSON.stringify({ type: 'session_created', session_id: 'srv-1' }))
          // close before the prompt confirmation
          setTimeout(() => socket.close(), 10)
        }
      })
    })
    const res = await delegateOverWs(server.endpoint, '/x', 'p', undefined, fastOpts)
    expect(res.sessionId).toBe('srv-1')
    expect(res.sendOk).toBe(false)
  })
})
