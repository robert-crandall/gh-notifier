import { randomUUID } from 'crypto'
import type { McpServerInput, McpStdioConfig } from '../../shared/ipc-channels'

/**
 * Per-project MCP config helpers. The stored config feeds the APP-OWNED MCP
 * client (mcp-client.ts), not Copilot. Config is always user/app-approved
 * (entered through the Resources UI) — never sourced from a repo file — which is
 * how the "no repo-injected commands" invariant holds. This module only
 * validates + normalizes what the user supplied and mints stable ids.
 */

export function newMcpServerId(): string {
  return `mcp-${randomUUID()}`
}

export type McpConfigValidation =
  | { ok: true; value: McpServerInput }
  | { ok: false; error: string }

/** Validates + normalizes a user-supplied MCP server config before it's stored. */
export function validateMcpServerInput(label: unknown, config: unknown): McpConfigValidation {
  const trimmedLabel = typeof label === 'string' ? label.trim() : ''

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'MCP config must be an object' }
  }
  const c = config as Record<string, unknown>

  const command = typeof c.command === 'string' ? c.command.trim() : ''
  if (command.length === 0) {
    return { ok: false, error: 'MCP config needs a command' }
  }

  const args = Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : []

  let env: Record<string, string> = {}
  if (c.env !== undefined) {
    if (c.env === null || typeof c.env !== 'object' || Array.isArray(c.env)) {
      return { ok: false, error: 'MCP config env must be an object of strings' }
    }
    env = Object.fromEntries(
      Object.entries(c.env as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  }

  const normalized: McpStdioConfig = { command, args, env }
  return { ok: true, value: { label: trimmedLabel, config: normalized } }
}
