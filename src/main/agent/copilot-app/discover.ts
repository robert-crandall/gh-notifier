/**
 * Discover the installed Copilot desktop app's local WebSocket endpoint.
 *
 * The app writes two files under `~/.copilot/run/` when it's running:
 *   - `ws.port`  — line 1 is the localhost port it listens on.
 *   - `ws.token` — line 1 is a 43-char base64 auth token (mode 0600). It
 *     ROTATES on every app launch, so callers must re-read on every connect.
 *
 * We only ever READ these files (never write), and the token value is never
 * logged. When the app isn't running the files may be absent or stale; a stale
 * token simply fails the handshake, at which point delegation falls back to the
 * cloud path.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface WsEndpoint {
  port: number
  /** The auth token. Treat as a secret: never log or persist it. */
  token: string
}

/** Directory the desktop app writes its runtime files to. */
export function copilotRunDir(): string {
  return join(homedir(), '.copilot', 'run')
}

/** First non-empty line of a file's contents, trimmed; null when unreadable. */
function firstLine(path: string): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null // file missing / unreadable → app not running
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

/**
 * Read the current WS endpoint (port + token). Returns null when the app isn't
 * running (files absent) or the contents are malformed. Re-read on every
 * connect — the token rotates per app launch.
 */
export function discoverWsEndpoint(runDir: string = copilotRunDir()): WsEndpoint | null {
  const portRaw = firstLine(join(runDir, 'ws.port'))
  const token = firstLine(join(runDir, 'ws.token'))
  if (portRaw === null || token === null) return null

  const port = Number(portRaw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (token.length === 0) return null

  return { port, token }
}
