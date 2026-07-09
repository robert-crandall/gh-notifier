/**
 * Pure request gate for the inbound loopback MCP server. No I/O — takes the
 * request metadata and the expected port/token and returns a verdict the HTTP
 * layer maps to a status code. Keeping it pure makes every branch unit-testable.
 *
 * Layers (bearer token is the real boundary; the rest is defense-in-depth):
 *   1. Method + path: only `POST /mcp`.
 *   2. Host header must equal `127.0.0.1:<port>` (DNS-rebinding defense).
 *   3. Remote address must be loopback.
 *   4. Reject any request carrying an `Origin` header — browsers always send one;
 *      the shim (Node `fetch`) does not. Mirrors the outbound-WS non-browser gate.
 *   5. Bearer token must match (constant-time compare).
 */

import { timingSafeEqualToken } from './token'

/** The single path the loopback MCP server serves. */
export const MCP_PATH = '/mcp'

/** Max accepted request body size (bytes). Oversized bodies are rejected pre-parse. */
export const MAX_BODY_BYTES = 1_000_000

/** A request's security-relevant metadata (all lower-cased header values). */
export interface RequestMeta {
  method: string | undefined
  /** URL pathname only (no query string). */
  path: string | undefined
  host: string | undefined
  origin: string | undefined
  authorization: string | undefined
  /** `req.socket.remoteAddress`. */
  remoteAddress: string | null | undefined
}

export type Verdict = { ok: true } | { ok: false; status: number; reason: string }

/** Loopback IPv4/IPv6 forms (incl. IPv4-mapped IPv6). */
export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (addr === null || addr === undefined) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/** Extract the bearer credential from an Authorization header, or null. */
function bearerCredential(authorization: string | undefined): string | null {
  if (authorization === undefined) return null
  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim())
  return match !== null ? match[1] : null
}

/**
 * Decide whether a request may reach the MCP transport. Returns `{ ok: true }`
 * or a `{ ok: false, status, reason }` verdict. Never logs the token.
 */
export function authorizeRequest(
  meta: RequestMeta,
  expected: { port: number; token: string }
): Verdict {
  // 1. Method + path.
  if (meta.path !== MCP_PATH) return { ok: false, status: 404, reason: 'not found' }
  if (meta.method !== 'POST') return { ok: false, status: 405, reason: 'method not allowed' }

  // 2. Host header (DNS-rebinding defense).
  if (meta.host !== `127.0.0.1:${expected.port}`) {
    return { ok: false, status: 403, reason: 'bad host' }
  }

  // 3. Loopback remote address.
  if (!isLoopbackAddress(meta.remoteAddress)) {
    return { ok: false, status: 403, reason: 'non-loopback' }
  }

  // 4. Origin gate: any Origin header means a browser is calling — reject.
  if (meta.origin !== undefined) {
    return { ok: false, status: 403, reason: 'origin not allowed' }
  }

  // 5. Bearer token (the real boundary).
  const presented = bearerCredential(meta.authorization)
  if (presented === null || !timingSafeEqualToken(presented, expected.token)) {
    return { ok: false, status: 401, reason: 'unauthorized' }
  }

  return { ok: true }
}
