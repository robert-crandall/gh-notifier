/**
 * The Copilot desktop app's local WebSocket protocol — pure builders + parsers.
 *
 * This is the app's UNOFFICIAL internal protocol (serde `tag:"type"`,
 * snake_case). It's isolated here so a Copilot-app update can only break this
 * one module. Everything is pure and unit-tested; the socket lives in client.ts.
 *
 * Verified against GitHub Copilot app v1.0.67 (see the PR2 spike):
 *   server → { type: "server_hello", instance_id }
 *   client → { type: "create_session", cwd, model? }
 *   server → { type: "session_created", session_id, cwd, session_type, ... }
 *   client → { type: "send_message", session_id, prompt }
 *   client → { type: "delete_session", session_id }
 *   server → { type: "session_deleted", session_id }
 *   server → { type: "session_event", session_id, ... }   (for ALL sessions)
 */

// ── Outgoing frames (client → app) ────────────────────────────────────────────

export interface CreateSessionFrame {
  type: 'create_session'
  cwd: string
  model?: string
}

export interface SendMessageFrame {
  type: 'send_message'
  session_id: string
  prompt: string
}

export interface DeleteSessionFrame {
  type: 'delete_session'
  session_id: string
}

/** Build a `create_session` frame (optionally pinning a model). Pure. */
export function buildCreateSession(cwd: string, model?: string): CreateSessionFrame {
  const frame: CreateSessionFrame = { type: 'create_session', cwd }
  if (model !== undefined && model.trim().length > 0) frame.model = model.trim()
  return frame
}

/** Build a `send_message` frame. Pure. */
export function buildSendMessage(sessionId: string, prompt: string): SendMessageFrame {
  return { type: 'send_message', session_id: sessionId, prompt }
}

/** Build a `delete_session` frame (used to clean up test/aborted sessions). Pure. */
export function buildDeleteSession(sessionId: string): DeleteSessionFrame {
  return { type: 'delete_session', session_id: sessionId }
}

/** Serialize an outgoing frame to a WS text payload. Pure. */
export function encodeFrame(frame: CreateSessionFrame | SendMessageFrame | DeleteSessionFrame): string {
  return JSON.stringify(frame)
}

// ── Incoming frames (app → client) ────────────────────────────────────────────

export interface ServerHello {
  kind: 'server_hello'
  instanceId: string | null
}

export interface SessionCreated {
  kind: 'session_created'
  sessionId: string
}

export interface SessionDeleted {
  kind: 'session_deleted'
  sessionId: string
}

export interface SessionEvent {
  kind: 'session_event'
  /** The session this event belongs to (frames arrive for ALL sessions). */
  sessionId: string | null
}

/** Any frame type we don't model explicitly (ambient app chatter). */
export interface OtherFrame {
  kind: 'other'
  type: string
}

export type IncomingFrame = ServerHello | SessionCreated | SessionDeleted | SessionEvent | OtherFrame

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === 'string' ? v : null
}

/**
 * Parse a raw WS text frame into a typed incoming frame. Pure. Unknown or
 * malformed frames become `{ kind: 'other' }` rather than throwing, so the
 * client can ignore ambient chatter (`keep_awake_changed`, `resource_snapshot`,
 * auth updates, session_event for other sessions, …) gracefully.
 */
export function parseFrame(raw: string): IncomingFrame {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'other', type: '<unparseable>' }
  }
  const obj = asRecord(parsed)
  if (obj === null) return { kind: 'other', type: '<non-object>' }

  const type = readString(obj, 'type') ?? '<untyped>'
  switch (type) {
    case 'server_hello':
      return { kind: 'server_hello', instanceId: readString(obj, 'instance_id') }
    case 'session_created': {
      const sessionId = readString(obj, 'session_id')
      // A session_created with no id is malformed; treat as ambient.
      return sessionId !== null ? { kind: 'session_created', sessionId } : { kind: 'other', type }
    }
    case 'session_deleted': {
      const sessionId = readString(obj, 'session_id')
      return sessionId !== null ? { kind: 'session_deleted', sessionId } : { kind: 'other', type }
    }
    case 'session_event':
      return { kind: 'session_event', sessionId: readString(obj, 'session_id') }
    default:
      return { kind: 'other', type }
  }
}
