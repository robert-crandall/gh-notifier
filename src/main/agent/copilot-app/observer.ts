/**
 * Persistent WS observer for directly-opened desktop-app sessions (#119).
 *
 * DISTINCT from the one-shot delegate client (client.ts): this keeps a single
 * long-lived listener on the desktop app's local WebSocket. The app emits
 * `session_event` "for ALL sessions", but the spike proved those frames carry
 * only a `session_id` — no cwd. So the observer's job is purely LIVENESS: when a
 * session shows activity, it triggers the on-disk reconciler (reconcile.ts) to map
 * that id → repo → project. All the mapping/storage lives in the reconciler; the
 * observer is a trigger plus a durable periodic backstop.
 *
 * Lifecycle / safety (per the #119 review):
 *   - `discoverWsEndpoint()` is re-read on EVERY (re)connect (the token rotates per
 *     app launch and is never logged or thrown).
 *   - `server_hello` marks a STABLE connection: backoff resets THERE (not on socket
 *     open) and a full reconcile is requested.
 *   - reconnect uses capped exponential backoff; when the app is closed
 *     (discover → null) it just retries quietly.
 *   - `stop()` disables the ENTIRE pipeline — socket, reconnect, periodic scan,
 *     debounce, and miss-retry timers — and bumps a generation token so any
 *     already-scheduled callback becomes a no-op. Toggling the feature off stops
 *     both WS-triggered and disk-scan-triggered ingestion.
 *   - reconcile work is synchronous (better-sqlite3 + sync fs reads), so there's no
 *     async overlap; a burst of events is debounced into one drain, and a pending
 *     full reconcile subsumes queued per-id requests.
 */

import WebSocket from 'ws'
import { parseFrame } from './protocol'
import { discoverWsEndpoint, type WsEndpoint } from './discover'
import {
  reconcileOne,
  reconcileRecent,
  createReconcileDeps,
  formatReconcileSummary,
  type ReconcileDeps,
} from './reconcile'

/** A minimal socket the observer drives (injectable so tests can use a fake server). */
export interface ObserverSocket {
  onOpen(cb: () => void): void
  onMessage(cb: (raw: string) => void): void
  onClose(cb: () => void): void
  onError(cb: (err: Error) => void): void
  close(): void
}

export type WsConnector = (endpoint: WsEndpoint) => ObserverSocket

export interface ObserverTiming {
  /** Debounce before draining queued per-id reconciles. Default 200ms. */
  debounceMs: number
  /** First reconnect delay; doubles per failure up to reconnectMaxMs. Default 1000ms. */
  reconnectBaseMs: number
  /** Cap on the reconnect backoff. Default 30000ms. */
  reconnectMaxMs: number
  /** Periodic full-reconcile backstop interval. Default 90000ms. */
  periodicMs: number
  /** Retry schedule (ms) for a session whose workspace.yaml isn't flushed yet. */
  missRetryMs: number[]
}

export const DEFAULT_TIMING: ObserverTiming = {
  debounceMs: 200,
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30000,
  periodicMs: 90000,
  missRetryMs: [250, 1000, 5000],
}

export interface ObserverDeps {
  discover: () => WsEndpoint | null
  connect: WsConnector
  reconcile: ReconcileDeps
  /** Called after a reconcile actually changed something (controller broadcasts). */
  onChanged: () => void
  timing?: Partial<ObserverTiming>
  /** Token-safe logger (defaults to console.warn). */
  log?: (msg: string) => void
}

/** Build the WS URL. Kept local so the token never lands in a log or error. */
function buildUrl(endpoint: WsEndpoint): string {
  return `ws://127.0.0.1:${endpoint.port}/?token=${encodeURIComponent(endpoint.token)}`
}

/** Production WS connector over the `ws` package (no Origin header — the non-browser gate). */
export function createWsConnector(): WsConnector {
  return (endpoint) => {
    const ws = new WebSocket(buildUrl(endpoint))
    return {
      onOpen: (cb) => ws.on('open', cb),
      onMessage: (cb) => ws.on('message', (data: WebSocket.RawData) => cb(data.toString())),
      onClose: (cb) => ws.on('close', () => cb()),
      onError: (cb) => ws.on('error', (err: Error) => cb(err)),
      close: () => {
        try {
          ws.close()
        } catch {
          /* already closing */
        }
      },
    }
  }
}

export class SessionObserver {
  private readonly discover: () => WsEndpoint | null
  private readonly connect: WsConnector
  private readonly reconcile: ReconcileDeps
  private readonly onChanged: () => void
  private readonly timing: ObserverTiming
  private readonly log: (msg: string) => void

  private running = false
  /** Bumped on every start()/stop(); scheduled callbacks capture it and bail if it moved. */
  private generation = 0

  private socket: ObserverSocket | null = null
  /** Guards against onError + onClose both scheduling a reconnect for one connection. */
  private connectionSettled = false
  private backoffMs: number

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private periodicTimer: ReturnType<typeof setInterval> | null = null
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()

  private readonly pendingIds = new Set<string>()
  private fullPending = false
  private readonly missAttempts = new Map<string, number>()

  constructor(deps: ObserverDeps) {
    this.discover = deps.discover
    this.connect = deps.connect
    this.reconcile = deps.reconcile
    this.onChanged = deps.onChanged
    this.timing = { ...DEFAULT_TIMING, ...(deps.timing ?? {}) }
    this.log = deps.log ?? ((msg) => console.warn(`[copilot/observe] ${msg}`))
    this.backoffMs = this.timing.reconnectBaseMs
  }

  /** Start observing. Idempotent. Runs an initial reconcile even if the app is closed. */
  start(): void {
    if (this.running) return
    this.running = true
    const gen = ++this.generation
    this.backoffMs = this.timing.reconnectBaseMs
    // Surface recently-opened sessions immediately, independent of the WS.
    this.requestFullReconcile()
    this.periodicTimer = setInterval(() => this.requestFullReconcile(), this.timing.periodicMs)
    this.openConnection(gen)
  }

  /** Stop observing and tear down every timer/socket. Idempotent. */
  stop(): void {
    if (!this.running) return
    this.running = false
    this.generation++ // invalidate all in-flight callbacks
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    if (this.periodicTimer !== null) clearInterval(this.periodicTimer)
    for (const t of this.retryTimers) clearTimeout(t)
    this.retryTimers.clear()
    this.reconnectTimer = null
    this.debounceTimer = null
    this.periodicTimer = null
    this.pendingIds.clear()
    this.missAttempts.clear()
    this.fullPending = false
    if (this.socket !== null) {
      this.socket.close()
      this.socket = null
    }
  }

  // ── WS connection ───────────────────────────────────────────────────────────

  private openConnection(gen: number): void {
    if (gen !== this.generation) return
    const endpoint = this.discover()
    if (endpoint === null) {
      // App not running — retry quietly on the backoff schedule.
      this.scheduleReconnect(gen)
      return
    }
    this.connectionSettled = false
    let socket: ObserverSocket
    try {
      socket = this.connect(endpoint)
    } catch {
      this.scheduleReconnect(gen)
      return
    }
    this.socket = socket
    socket.onMessage((raw) => this.handleMessage(gen, raw))
    socket.onClose(() => this.onDisconnect(gen))
    socket.onError(() => this.onDisconnect(gen))
  }

  private handleMessage(gen: number, raw: string): void {
    if (gen !== this.generation) return
    const frame = parseFrame(raw)
    if (frame.kind === 'server_hello') {
      // Stable connection: reset backoff and catch anything opened while we were away.
      this.backoffMs = this.timing.reconnectBaseMs
      this.requestFullReconcile()
      return
    }
    if (frame.kind === 'session_event' && frame.sessionId !== null) {
      this.requestOne(frame.sessionId)
    }
  }

  private onDisconnect(gen: number): void {
    if (gen !== this.generation) return
    if (this.connectionSettled) return // onError + onClose for the same socket
    this.connectionSettled = true
    this.socket = null
    this.scheduleReconnect(gen)
  }

  private scheduleReconnect(gen: number): void {
    if (gen !== this.generation) return
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, this.timing.reconnectMaxMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openConnection(gen)
    }, delay)
  }

  // ── Reconcile coordinator (debounced, single-flight by virtue of sync work) ──

  private requestFullReconcile(): void {
    this.fullPending = true
    this.scheduleDrain()
  }

  private requestOne(id: string): void {
    this.pendingIds.add(id)
    this.scheduleDrain()
  }

  private scheduleDrain(): void {
    if (this.debounceTimer !== null) return
    const gen = this.generation
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.drain(gen)
    }, this.timing.debounceMs)
  }

  private drain(gen: number): void {
    if (gen !== this.generation || !this.running) return
    let changed = false

    if (this.fullPending) {
      // A full reconcile subsumes every queued per-id request.
      this.fullPending = false
      this.pendingIds.clear()
      try {
        const summary = reconcileRecent(this.reconcile)
        this.log(formatReconcileSummary(summary))
        if (summary.changed > 0) changed = true
      } catch (err) {
        this.log(`full reconcile failed: ${err instanceof Error ? err.name : 'error'}`)
      }
    } else {
      const ids = [...this.pendingIds]
      this.pendingIds.clear()
      for (const id of ids) {
        const outcome = this.runOne(gen, id)
        if (outcome === 'changed') changed = true
      }
    }

    if (changed) this.onChanged()
  }

  /** Reconcile one id, handling the workspace.yaml flush race with bounded retries. */
  private runOne(gen: number, id: string): 'changed' | 'noop' {
    let outcome: ReturnType<typeof reconcileOne>
    try {
      outcome = reconcileOne(id, this.reconcile)
    } catch (err) {
      this.log(`reconcileOne failed: ${err instanceof Error ? err.name : 'error'}`)
      this.missAttempts.delete(id)
      return 'noop'
    }
    if (outcome.kind === 'missing') {
      this.scheduleMissRetry(gen, id)
      return 'noop'
    }
    // Resolved one way or another — stop retrying this id.
    this.missAttempts.delete(id)
    return outcome.kind === 'upserted' && outcome.changed ? 'changed' : 'noop'
  }

  private scheduleMissRetry(gen: number, id: string): void {
    const attempt = this.missAttempts.get(id) ?? 0
    if (attempt >= this.timing.missRetryMs.length) {
      // Give up on the targeted retry; the periodic backstop is the final net.
      this.missAttempts.delete(id)
      return
    }
    this.missAttempts.set(id, attempt + 1)
    const delay = this.timing.missRetryMs[attempt] ?? this.timing.missRetryMs[this.timing.missRetryMs.length - 1]
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer)
      if (gen !== this.generation || !this.running) return
      this.requestOne(id)
    }, delay)
    this.retryTimers.add(timer)
  }
}

/** Production wiring for the observer. */
export function createSessionObserver(onChanged: () => void): SessionObserver {
  return new SessionObserver({
    discover: () => discoverWsEndpoint(),
    connect: createWsConnector(),
    reconcile: createReconcileDeps(),
    onChanged,
  })
}
