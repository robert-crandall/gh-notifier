/**
 * Persisted setting for the inbound MCP server, stored in the shared
 * `sync_metadata` key-value table (same pattern as `copilot-app/settings.ts`).
 * One key: whether the inbound server is enabled. Default ON — this is the
 * transport foundation the rest of the epic builds on.
 */

import { getDb } from '../db'

const MCP_SERVER_ENABLED_KEY = 'mcp_server_enabled'

function readMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row === undefined ? null : row.value
}

function writeMeta(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run(key, value)
}

/** Whether the inbound MCP server is enabled. Default true (unset => enabled). */
export function getMcpServerEnabled(): boolean {
  return readMeta(MCP_SERVER_ENABLED_KEY) !== 'false'
}

export function setMcpServerEnabled(enabled: boolean): void {
  writeMeta(MCP_SERVER_ENABLED_KEY, enabled ? 'true' : 'false')
}
