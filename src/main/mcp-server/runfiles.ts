/**
 * Runtime discovery files for the INBOUND MCP server — the reverse of
 * `agent/copilot-app/discover.ts`.
 *
 * The Projects app writes two files under `~/.gh-projects/run/` while it's
 * running so the stdio shim (spawned by the Copilot app) can find and
 * authenticate to the loopback MCP server:
 *   - `token` — a base64url auth token (mode 0600). ROTATES on every app launch.
 *   - `port`  — the localhost port the loopback server listens on (mode 0600).
 *
 * This module is deliberately dependency-free (node builtins only) so it can be
 * imported by BOTH the Electron main process (writer) and the bundled stdio shim
 * (reader) without dragging the app into the shim bundle. The token is a secret:
 * it is never logged here.
 *
 * Write discipline (see the issue #103 plan): the app writes `token` FIRST, then
 * `port` LAST, each via a same-directory temp file + atomic rename, and only
 * AFTER the HTTP server's `listen()` has succeeded. A reader therefore never sees
 * a `port` that isn't yet accepting, and observing a NEW port implies the NEW
 * token is already on disk. The only possible torn read is (old port, new token)
 * during a restart, which the shim heals by re-reading + retrying.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Directory the app writes its inbound-server runtime files to. */
export function runDir(): string {
  // `GH_PROJECTS_RUN_DIR` lets tests (and the spawned shim) point at an isolated
  // dir instead of the real `~/.gh-projects/run`. Both the writer (server) and the
  // reader (shim) honor it, so they always agree.
  const override = process.env.GH_PROJECTS_RUN_DIR
  if (override !== undefined && override.trim().length > 0) return override
  return join(homedir(), '.gh-projects', 'run')
}

function tokenPath(dir: string): string {
  return join(dir, 'token')
}

function portPath(dir: string): string {
  return join(dir, 'port')
}

/** The validated runtime endpoint the shim connects to. */
export interface RunEndpoint {
  port: number
  /** The auth token. Treat as a secret: never log or persist it. */
  token: string
}

/** First non-empty, trimmed line of a file; null when unreadable/empty. */
function firstLine(path: string): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null // missing / unreadable → app not running
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

/**
 * Atomically write `value` to `path` at mode 0600 via a same-directory temp file
 * + rename. The temp name embeds pid + a random suffix so concurrent writers
 * can't collide.
 */
function atomicWrite(path: string, value: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, value, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * Publish the run files. MUST be called only after the loopback server's
 * `listen()` has resolved. Writes `token` first, then `port` last (see the
 * write-discipline note above). Creates the run dir at mode 0700 if needed.
 * The token is never logged.
 */
export function writeRunFiles(endpoint: RunEndpoint, dir: string = runDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  atomicWrite(tokenPath(dir), `${endpoint.token}\n`)
  atomicWrite(portPath(dir), `${endpoint.port}\n`)
}

/**
 * Read the current endpoint (port + token), validating shape before use. Returns
 * null when the app isn't running (files absent) or the contents are malformed.
 * Re-read on every attempt — the token rotates per app launch. Reads `port`
 * first, then `token` (see the write-discipline note above).
 */
export function readRunFiles(dir: string = runDir()): RunEndpoint | null {
  const portRaw = firstLine(portPath(dir))
  const token = firstLine(tokenPath(dir))
  if (portRaw === null || token === null) return null

  // Digits-only: reject hex/exponent/other Number() quirks (port is decimal).
  if (!/^\d+$/.test(portRaw)) return null
  const port = Number.parseInt(portRaw, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (token.length === 0) return null

  return { port, token }
}

/**
 * Best-effort removal of the run files (on quit / disable). Never throws — a
 * missing file is fine. Leaves the run dir in place.
 */
export function cleanupRunFiles(dir: string = runDir()): void {
  for (const path of [portPath(dir), tokenPath(dir)]) {
    try {
      rmSync(path, { force: true })
    } catch {
      /* best-effort */
    }
  }
}
