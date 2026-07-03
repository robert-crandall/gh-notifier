/**
 * The single WebSocket connection to the Copilot desktop app.
 *
 * Isolated here (with protocol.ts) so the app's unofficial protocol can only
 * break this one seam. The token is never logged, and it's never included in a
 * thrown error (we build the URL locally and keep it out of error messages).
 *
 * Idempotency boundary (prevents double-delegation): cloud fallback is only safe
 * BEFORE `create_session` is sent. So failures split into two typed errors:
 *   - `AppUnavailableError` — discovery/connect/handshake failed, or the socket
 *     died before we sent `create_session`. Pre-create → the caller may fall
 *     back to cloud.
 *   - `CreateAmbiguousError` — `create_session` was sent but we never got
 *     `session_created`. The app MIGHT have created a session we can't see, so
 *     the caller must NOT fall back to cloud (that would double-delegate).
 * Once `session_created` arrives, the session exists and is returned even if the
 * subsequent `send_message` fails.
 */

import WebSocket from 'ws'
import type { WsEndpoint } from './discover'
import { buildCreateSession, buildDeleteSession, buildSendMessage, encodeFrame, parseFrame } from './protocol'

/** Pre-create failure. Safe for the caller to fall back to cloud. */
export class AppUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppUnavailableError'
  }
}

/** `create_session` sent but never acknowledged. Ambiguous — do NOT fall back. */
export class CreateAmbiguousError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreateAmbiguousError'
  }
}

export interface DelegateOverWsResult {
  sessionId: string
  /** False when the session was created but the follow-up prompt couldn't be sent. */
  sendOk: boolean
}

export interface WsClientOptions {
  /** ms to wait for the 101 + server_hello. Default 8000. */
  helloTimeoutMs?: number
  /** ms to wait for session_created after create_session. Default 15000. */
  createTimeoutMs?: number
  /** ms to wait for a session_event confirming the prompt was accepted. Default 4000. */
  sendConfirmMs?: number
}

const DEFAULTS = { helloTimeoutMs: 8000, createTimeoutMs: 15000, sendConfirmMs: 4000 }

/** Build the WS URL. Kept out of error messages so the token can't leak. */
function buildUrl(endpoint: WsEndpoint): string {
  return `ws://127.0.0.1:${endpoint.port}/?token=${encodeURIComponent(endpoint.token)}`
}

/**
 * Create a session in the desktop app and send it the task prompt. Resolves once
 * the session exists and the prompt has been dispatched. Does NOT wait for the
 * agent to finish. See the idempotency boundary above for the error contract.
 */
export function delegateOverWs(
  endpoint: WsEndpoint,
  cwd: string,
  prompt: string,
  model: string | undefined,
  options: WsClientOptions = {}
): Promise<DelegateOverWsResult> {
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULTS.helloTimeoutMs
  const createTimeoutMs = options.createTimeoutMs ?? DEFAULTS.createTimeoutMs
  const sendConfirmMs = options.sendConfirmMs ?? DEFAULTS.sendConfirmMs

  return new Promise<DelegateOverWsResult>((resolve, reject) => {
    // ws omits the Origin header by default — required for the non-browser gate.
    const ws = new WebSocket(buildUrl(endpoint))

    type Phase = 'connecting' | 'created_sent' | 'session_live' | 'settled'
    let phase: Phase = 'connecting'
    let sessionId: string | null = null
    let timer: NodeJS.Timeout | null = null

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const settle = (fn: () => void): void => {
      if (phase === 'settled') return
      phase = 'settled'
      clearTimer()
      try {
        ws.close()
      } catch {
        /* already closing */
      }
      fn()
    }
    const fail = (err: Error): void => settle(() => reject(err))
    const succeed = (result: DelegateOverWsResult): void => settle(() => resolve(result))

    /** Timeout appropriate to the current phase. */
    const armTimer = (ms: number, onFire: () => void): void => {
      clearTimer()
      timer = setTimeout(onFire, ms)
    }

    armTimer(helloTimeoutMs, () =>
      fail(new AppUnavailableError('timed out waiting for the Copilot app handshake'))
    )

    const sendPrompt = (): void => {
      // Session exists now — from here on, never surface a fallback-eligible error.
      const trySend = (): boolean => {
        try {
          ws.send(encodeFrame(buildSendMessage(sessionId as string, prompt)))
          return true
        } catch {
          return false
        }
      }
      // one retry on the same live connection
      if (!(trySend() || trySend())) {
        succeed({ sessionId: sessionId as string, sendOk: false })
        return
      }
      // Give the app a moment to accept; a session_event for our id confirms it,
      // but success doesn't depend on seeing one.
      armTimer(sendConfirmMs, () => succeed({ sessionId: sessionId as string, sendOk: true }))
    }

    ws.on('open', () => {
      // Connected; still waiting for server_hello (handled in 'message').
    })

    ws.on('unexpected-response', (_req, res) => {
      // Non-101 (e.g. stale/rotated token → auth rejected). Pre-create.
      fail(new AppUnavailableError(`Copilot app rejected the connection (HTTP ${res.statusCode})`))
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const frame = parseFrame(data.toString())
      switch (frame.kind) {
        case 'server_hello': {
          if (phase !== 'connecting') return
          phase = 'created_sent'
          try {
            ws.send(encodeFrame(buildCreateSession(cwd, model)))
          } catch {
            fail(new AppUnavailableError('failed to send create_session'))
            return
          }
          armTimer(createTimeoutMs, () =>
            fail(new CreateAmbiguousError('create_session was sent but never acknowledged'))
          )
          return
        }
        case 'session_created': {
          if (phase !== 'created_sent') return
          phase = 'session_live'
          sessionId = frame.sessionId
          sendPrompt()
          return
        }
        case 'session_event': {
          // Confirmation that our just-sent prompt was accepted.
          if (phase === 'session_live' && sessionId !== null && frame.sessionId === sessionId) {
            succeed({ sessionId, sendOk: true })
          }
          return
        }
        default:
          return // ambient chatter — ignore
      }
    })

    ws.on('error', (err: Error) => {
      // Classify by phase: before create_session is sent → fall-back-eligible;
      // after → ambiguous (never auto-fall-back).
      if (phase === 'connecting') {
        fail(new AppUnavailableError(`Copilot app connection error: ${err.message}`))
      } else if (phase === 'created_sent') {
        fail(new CreateAmbiguousError('connection error after create_session was sent'))
      } else if (phase === 'session_live' && sessionId !== null) {
        succeed({ sessionId, sendOk: false })
      }
      // 'settled' → ignore
    })

    ws.on('close', () => {
      if (phase === 'connecting') {
        fail(new AppUnavailableError('Copilot app closed the connection before the handshake completed'))
      } else if (phase === 'created_sent') {
        fail(new CreateAmbiguousError('connection closed after create_session was sent'))
      } else if (phase === 'session_live' && sessionId !== null) {
        // Session exists; the prompt may or may not have been delivered.
        succeed({ sessionId, sendOk: false })
      }
    })
  })
}

/**
 * Best-effort delete of a session (used to clean up test/aborted sessions).
 * Resolves when the delete frame is dispatched; never rejects on transport
 * issues (the caller treats cleanup as best-effort).
 */
export function deleteAppSession(endpoint: WsEndpoint, sessionId: string, timeoutMs = 6000): Promise<void> {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(buildUrl(endpoint))
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    ws.on('message', (data: WebSocket.RawData) => {
      const frame = parseFrame(data.toString())
      if (frame.kind === 'server_hello') {
        try {
          ws.send(encodeFrame(buildDeleteSession(sessionId)))
        } catch {
          finish()
        }
      } else if (frame.kind === 'session_deleted' && frame.sessionId === sessionId) {
        finish()
      }
    })
    ws.on('error', finish)
    ws.on('close', finish)
  })
}
