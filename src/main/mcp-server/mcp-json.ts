/**
 * App-managed registration of the stdio shim in the user's global `~/.mcp.json`,
 * so the Copilot app can discover and spawn it. Idempotent and ownership-aware:
 * we only ever touch OUR entry (`gh-projects`), and only when it carries our
 * managed marker (or is absent). An unmanaged `gh-projects` entry that a user
 * hand-added is left untouched — we never clobber someone's global config.
 *
 * Writes are atomic (temp file + same-directory rename). A present-but-unparseable
 * file is a hard error, NOT an excuse to overwrite it. Unknown servers and other
 * top-level keys are preserved.
 */

import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Our entry key in `mcpServers`. */
export const MCP_ENTRY_NAME = 'gh-projects'

/** Env marker stamped on our entry so we can prove ownership before mutating it. */
export const MANAGED_MARKER_ENV = 'GH_PROJECTS_MCP_MANAGED'
export const MANAGED_MARKER_VALUE = '1'

/** The shim command shape written into `~/.mcp.json`. */
export interface ShimCommand {
  command: string
  args: string[]
  env: Record<string, string>
}

export type EnableOutcome = 'added' | 'updated' | 'skipped-unmanaged'
export type DisableOutcome = 'removed' | 'absent' | 'skipped-unmanaged'

/** Path to the user's global MCP config. */
export function mcpJsonPath(): string {
  return join(homedir(), '.mcp.json')
}

interface McpConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

/** True for a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read + parse the config. Returns null when the file is absent. THROWS when the
 * file exists but can't be read or parsed — so a corrupt file is never clobbered.
 *
 * NOTE: this is a read-modify-write against a file another process/user could also
 * edit. The temp-file + rename makes each write atomic (never a partial file), but
 * a concurrent external edit in the window between read and rename could be lost.
 * In practice the app is the only writer of OUR entry and edits are rare, so we
 * accept that rather than take a lock.
 */
function readConfig(path: string): McpConfig | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (raw.trim().length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`~/.mcp.json exists but is not valid JSON; refusing to overwrite: ${path}`)
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`~/.mcp.json is not a JSON object; refusing to overwrite: ${path}`)
  }
  const config = parsed as McpConfig
  // A malformed `mcpServers` (e.g. an array) would silently drop on re-serialize.
  if (config.mcpServers !== undefined && !isPlainObject(config.mcpServers)) {
    throw new Error(`~/.mcp.json has a non-object "mcpServers"; refusing to overwrite: ${path}`)
  }
  return config
}

/** Atomically write the config, preserving the file's mode (0600 for a new file). */
function writeConfig(path: string, config: McpConfig): void {
  let mode = 0o600
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    /* new file → default 0600 */
  }
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode })
  renameSync(tmp, path)
}

/** Whether an existing entry is one WE manage (carries our marker). */
function isManagedEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false
  const env = (entry as { env?: unknown }).env
  if (env === null || typeof env !== 'object') return false
  return (env as Record<string, unknown>)[MANAGED_MARKER_ENV] === MANAGED_MARKER_VALUE
}

/**
 * Add or update our `gh-projects` entry, but ONLY when it is absent or already
 * managed by us. Returns what happened. `command.env` must already carry the
 * managed marker (see `lifecycle.ts`).
 */
export function enableMcpJsonEntry(command: ShimCommand, path: string = mcpJsonPath()): EnableOutcome {
  const config = readConfig(path) ?? {}
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>
  const existing = servers[MCP_ENTRY_NAME]

  if (existing !== undefined && !isManagedEntry(existing)) {
    // A user-authored entry with the same name — never clobber it.
    console.warn(`[mcp-json] leaving unmanaged '${MCP_ENTRY_NAME}' entry untouched`)
    return 'skipped-unmanaged'
  }

  const outcome: EnableOutcome = existing === undefined ? 'added' : 'updated'
  servers[MCP_ENTRY_NAME] = { command: command.command, args: command.args, env: command.env }
  config.mcpServers = servers
  writeConfig(path, config)
  return outcome
}

/** Remove our entry, but ONLY when it carries our marker. Returns what happened. */
export function disableMcpJsonEntry(path: string = mcpJsonPath()): DisableOutcome {
  const config = readConfig(path)
  if (config === null) return 'absent'
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>
  const existing = servers[MCP_ENTRY_NAME]
  if (existing === undefined) return 'absent'
  if (!isManagedEntry(existing)) {
    console.warn(`[mcp-json] leaving unmanaged '${MCP_ENTRY_NAME}' entry untouched`)
    return 'skipped-unmanaged'
  }
  delete servers[MCP_ENTRY_NAME]
  config.mcpServers = servers
  writeConfig(path, config)
  return 'removed'
}
