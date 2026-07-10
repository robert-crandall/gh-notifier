import { describe, it, expect, afterEach, vi } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { CopilotAppSession } from '../../../shared/ipc-channels'
import { SessionObserver, type ObserverTiming } from './observer'
import { createWsConnector } from './observer'
import type { ReconcileDeps, ReconcileFs } from './reconcile'
import type { WsEndpoint } from './discover'
import { buildAppSessionDeepLink } from './delegate'

// ── Fake desktop-app WS server ───────────────────────────────────────────────

interface FakeServer {
  port: number
  connectionCount: () => number
  sockets: () => WsSocket[]
  /** Send a frame to every connected socket. */
  broadcast: (frame: object) => void
  /** Drop all current sockets (simulates the app relaunching). */
  dropAll: () => void
  close: () => Promise<void>
}

function startServer(opts: { sendHello?: boolean } = {}): Promise<FakeServer> {
  const sendHello = opts.sendHello ?? true
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 })
    const live = new Set<WsSocket>()
    let count = 0
    wss.on('connection', (socket) => {
      count++
      live.add(socket)
      socket.on('close', () => live.delete(socket))
      if (sendHello) socket.send(JSON.stringify({ type: 'server_hello', instance_id: 'i1' }))
    })
    wss.on('listening', () => {
      const port = (wss.address() as AddressInfo).port
      resolve({
        port,
        connectionCount: () => count,
        sockets: () => [...live],
        broadcast: (frame) => {
          for (const s of live) s.send(JSON.stringify(frame))
        },
        dropAll: () => {
          for (const s of live) s.terminate()
          live.clear()
        },
        close: () =>
          new Promise<void>((r) => {
            for (const s of wss.clients) {
              try {
                s.terminate()
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

// ── In-memory reconcile backend (no SQL — keeps the observer test focused) ────

interface MemBackend {
  fs: ReconcileFs
  deps: ReconcileDeps
  store: Map<string, CopilotAppSession>
  /** id → workspace.yaml text (or a function returning it, for flush-race tests). */
  files: Map<string, () => string | null>
  /** ids surfaced by listSessions (the "recent" set). */
  listed: Set<string>
  knownRepos: Set<string>
}

function makeBackend(): MemBackend {
  const store = new Map<string, CopilotAppSession>()
  const files = new Map<string, () => string | null>()
  const listed = new Set<string>()
  const knownRepos = new Set<string>()

  const fs: ReconcileFs = {
    listSessions: () => [...listed].map((id) => ({ id, mtimeMs: 1000 })),
    readWorkspaceYaml: (id) => files.get(id)?.() ?? null,
  }
  const deps: ReconcileDeps = {
    fs,
    now: () => 2000,
    resolveProject: (owner, repo) => (knownRepos.has(`${owner}/${repo}`) ? 1 : null),
    getExisting: (id) => store.get(id) ?? null,
    upsertObserved: (input) => {
      const existing = store.get(input.id)
      const session: CopilotAppSession = {
        id: input.id,
        projectId: input.projectId,
        cwd: input.cwd,
        title: input.title,
        status: 'unknown',
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        origin: existing?.origin ?? 'observed',
        pinnedProjectId: existing?.pinnedProjectId ?? null,
        createdAt: existing?.createdAt ?? 'now',
        updatedAt: 'now',
      }
      store.set(input.id, session)
      return session
    },
  }
  return { fs, deps, store, files, listed, knownRepos }
}

function yaml(id: string, repository: string): string {
  return `id: ${id}\ncwd: /repos/${id}\nrepository: ${repository}`
}

const FAST: ObserverTiming = {
  debounceMs: 5,
  reconnectBaseMs: 10,
  reconnectMaxMs: 40,
  periodicMs: 100_000, // effectively off during a test
  missRetryMs: [5, 10, 20],
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

let server: FakeServer | null = null
let observer: SessionObserver | null = null
afterEach(async () => {
  observer?.stop()
  observer = null
  if (server) {
    await server.close()
    server = null
  }
})

function endpointFor(s: FakeServer): WsEndpoint {
  return { port: s.port, token: 'rotating-token' }
}

describe('SessionObserver — live WS drives the reconciler', () => {
  it('ingests known on-disk sessions via the initial full reconcile', async () => {
    server = await startServer()
    const b = makeBackend()
    b.knownRepos.add('me/foo')
    b.listed.add('s1')
    b.files.set('s1', () => yaml('s1', 'me/foo'))

    const onChanged = vi.fn()
    observer = new SessionObserver({
      discover: () => endpointFor(server as FakeServer),
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged,
      timing: FAST,
    })
    observer.start()

    await waitFor(() => b.store.has('s1'))
    expect(b.store.get('s1')?.origin).toBe('observed')
    expect(onChanged).toHaveBeenCalled()
    // The captured id yields a valid deep link (link-back works).
    expect(buildAppSessionDeepLink('s1')).toBe('github-app://sessions/s1')
  })

  it('ingests a session announced only via a WS session_event (not on the recent list)', async () => {
    server = await startServer()
    const b = makeBackend()
    b.knownRepos.add('me/bar')
    // NOT in listed → the full scan won't find it; only the session_event can.
    b.files.set('s2', () => yaml('s2', 'me/bar'))

    observer = new SessionObserver({
      discover: () => endpointFor(server as FakeServer),
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged: vi.fn(),
      timing: FAST,
    })
    observer.start()
    await waitFor(() => server?.connectionCount() === 1)
    server.broadcast({ type: 'session_event', session_id: 's2', event: { type: 'assistant.turn_start' } })

    await waitFor(() => b.store.has('s2'))
    expect(b.store.get('s2')?.repoName).toBe('bar')
  })

  it('reconnects and re-reads the endpoint after the app drops the socket', async () => {
    server = await startServer()
    const b = makeBackend()
    let discoverCalls = 0

    observer = new SessionObserver({
      discover: () => {
        discoverCalls++
        return endpointFor(server as FakeServer)
      },
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged: vi.fn(),
      timing: FAST,
    })
    observer.start()
    await waitFor(() => server?.connectionCount() === 1)
    const callsAfterFirst = discoverCalls

    // App relaunch: drop the socket. The observer must re-discover (fresh token) + reconnect.
    server.dropAll()
    await waitFor(() => (server?.connectionCount() ?? 0) >= 2)
    expect(discoverCalls).toBeGreaterThan(callsAfterFirst)
  })

  it('retries a not-yet-flushed workspace.yaml until it appears (flush race)', async () => {
    server = await startServer()
    const b = makeBackend()
    b.knownRepos.add('me/baz')
    let reads = 0
    b.files.set('s3', () => {
      reads++
      return reads >= 3 ? yaml('s3', 'me/baz') : null // missing on the first two reads
    })

    observer = new SessionObserver({
      discover: () => endpointFor(server as FakeServer),
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged: vi.fn(),
      timing: FAST,
    })
    observer.start()
    await waitFor(() => server?.connectionCount() === 1)
    server.broadcast({ type: 'session_event', session_id: 's3', event: { type: 'tool.execution_complete' } })

    await waitFor(() => b.store.has('s3'))
    expect(reads).toBeGreaterThanOrEqual(3)
  })

  it('a full reconcile does not drop a queued session_event for an old (unlisted) session', async () => {
    server = await startServer()
    const b = makeBackend()
    b.knownRepos.add('me/old')
    // NOT in listed → the recency-bounded full scan can't cover it; only the
    // targeted reconcileOne can. A larger debounce lets the session_event land in
    // the SAME drain window as the server_hello-triggered full reconcile.
    b.files.set('sOld', () => yaml('sOld', 'me/old'))

    observer = new SessionObserver({
      discover: () => endpointFor(server as FakeServer),
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged: vi.fn(),
      timing: { ...FAST, debounceMs: 60 },
    })
    observer.start()
    await waitFor(() => server?.connectionCount() === 1)
    // server_hello has set fullPending; queue the old id in the same window.
    server.broadcast({ type: 'session_event', session_id: 'sOld', event: { type: 'assistant.turn_start' } })

    await waitFor(() => b.store.has('sOld'))
    expect(b.store.get('sOld')?.repoName).toBe('old')
  })

  it('stop() halts ingestion and reconnection', async () => {
    server = await startServer()
    const b = makeBackend()
    b.knownRepos.add('me/foo')
    b.files.set('s4', () => yaml('s4', 'me/foo'))

    let discoverCalls = 0
    observer = new SessionObserver({
      discover: () => {
        discoverCalls++
        return endpointFor(server as FakeServer)
      },
      connect: createWsConnector(),
      reconcile: b.deps,
      onChanged: vi.fn(),
      timing: FAST,
    })
    observer.start()
    await waitFor(() => server?.connectionCount() === 1)
    observer.stop()
    const callsAtStop = discoverCalls

    // A post-stop event must be ignored, and no further reconnect/discover happens.
    server.broadcast({ type: 'session_event', session_id: 's4', event: { type: 'assistant.turn_start' } })
    server.dropAll()
    await new Promise((r) => setTimeout(r, 100))
    expect(b.store.has('s4')).toBe(false)
    expect(discoverCalls).toBe(callsAtStop)
  })
})
