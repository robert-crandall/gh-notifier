/**
 * The rotating auth token for the inbound loopback MCP server.
 *
 * Dependency-free (node builtins only) so both the main process and the bundled
 * shim can use the constant-time compare. A fresh token is generated on every app
 * launch (see server.ts) and written to `~/.gh-projects/run/token` (mode 0600).
 * The token is a secret: never log it.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Generate a fresh auth token: 32 random bytes, base64url-encoded (43 chars, no
 * padding, URL/header-safe). Cryptographically strong via `crypto.randomBytes`.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Constant-time equality for the bearer token. Length-safe (returns false on a
 * length mismatch without leaking timing) and never throws on non-ASCII input.
 * Both arguments are treated as secrets.
 */
export function timingSafeEqualToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
