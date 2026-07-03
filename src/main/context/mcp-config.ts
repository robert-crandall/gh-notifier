import { randomUUID } from 'crypto'
import type { McpServerInput, McpServerPatch, McpStdioConfig } from '../../shared/ipc-channels'

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
  if (trimmedLabel.length === 0) {
    return { ok: false, error: 'MCP server needs a label' }
  }

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
    // Validate keys (consistency with the edit-patch path): a bad env key would
    // corrupt the child's environment.
    for (const key of Object.keys(env)) {
      if (!isValidEnvKey(key)) return { ok: false, error: `Invalid env key: ${JSON.stringify(key)}` }
    }
  }

  const normalized: McpStdioConfig = { command, args, env }
  return { ok: true, value: { label: trimmedLabel, config: normalized } }
}

// ── Edit-patch + wiring validation (all main-owned; the renderer is decoration) ──

/** An env var key is a non-empty string with no `=` or NUL (would corrupt the env). */
function isValidEnvKey(key: string): boolean {
  return key.length > 0 && !key.includes('=') && !key.includes('\0')
}

export type McpPatchValidation =
  | { ok: true; value: { label?: string; command?: string; args?: string[]; envSet: Record<string, string>; envDelete: string[] } }
  | { ok: false; error: string }

/**
 * Validates + normalizes an MCP server edit patch. Env is one-way: `envSet`
 * adds/replaces, `envDelete` removes; a key can't appear in both. Omitted env
 * keys are preserved by the caller (the renderer never sees or re-sends secrets).
 */
export function validateMcpServerPatch(patch: McpServerPatch): McpPatchValidation {
  const out: { label?: string; command?: string; args?: string[]; envSet: Record<string, string>; envDelete: string[] } = {
    envSet: {},
    envDelete: [],
  }

  if (patch.label !== undefined) {
    const label = patch.label.trim()
    if (label.length === 0) return { ok: false, error: 'MCP server needs a label' }
    out.label = label
  }
  if (patch.command !== undefined) {
    const command = patch.command.trim()
    if (command.length === 0) return { ok: false, error: 'MCP config needs a command' }
    out.command = command
  }
  if (patch.args !== undefined) {
    if (!Array.isArray(patch.args) || !patch.args.every((a): a is string => typeof a === 'string')) {
      return { ok: false, error: 'MCP args must be an array of strings' }
    }
    out.args = patch.args
  }

  if (patch.envSet !== undefined) {
    if (patch.envSet === null || typeof patch.envSet !== 'object' || Array.isArray(patch.envSet)) {
      return { ok: false, error: 'envSet must be an object of strings' }
    }
    for (const [k, v] of Object.entries(patch.envSet)) {
      if (!isValidEnvKey(k)) return { ok: false, error: `Invalid env key: ${JSON.stringify(k)}` }
      if (typeof v !== 'string') return { ok: false, error: `env value for ${k} must be a string` }
      out.envSet[k] = v
    }
  }
  if (patch.envDelete !== undefined) {
    if (!Array.isArray(patch.envDelete) || !patch.envDelete.every((k): k is string => typeof k === 'string')) {
      return { ok: false, error: 'envDelete must be an array of strings' }
    }
    for (const key of patch.envDelete) {
      if (!isValidEnvKey(key)) return { ok: false, error: `Invalid env key: ${JSON.stringify(key)}` }
    }
    out.envDelete = patch.envDelete
  }

  // A key in both is ambiguous (set-then-delete) — reject rather than guess.
  const setKeys = new Set(Object.keys(out.envSet))
  const overlap = out.envDelete.filter((k) => setKeys.has(k))
  if (overlap.length > 0) {
    return { ok: false, error: `env keys in both envSet and envDelete: ${overlap.join(', ')}` }
  }

  return { ok: true, value: out }
}

/** Validates a tool name for wiring: a non-empty trimmed string. */
export function validateToolName(name: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0) return { ok: false, error: 'A tool name is required' }
  return { ok: true, value: trimmed }
}

const MAX_TOOL_ARGS_BYTES = 16_384

/** True for a value that is faithfully representable as JSON (no data loss). */
function isJsonValue(v: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(v)
  if (t === 'object') {
    // Reject cycles (reachable via a direct IPC structured-clone payload) before
    // recursing, so validation can't stack-overflow.
    if (seen.has(v as object)) return false
    seen.add(v as object)
    if (Array.isArray(v)) return v.every((x) => isJsonValue(x, seen))
    // Reject class instances / Date / Map etc. — only plain objects are allowed.
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(v as Record<string, unknown>).every((x) => isJsonValue(x, seen))
  }
  // function / undefined / symbol / bigint
  return false
}

/**
 * Validates tool args: a PLAIN JSON object with only JSON-representable values,
 * within a size cap. Rejects (rather than silently drops) functions, undefined,
 * BigInt, class instances, and cycles, so a malformed IPC payload can't persist
 * mangled args or crash the read.
 */
export function validateToolArgs(
  args: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'Tool args must be a JSON object' }
  }
  const proto = Object.getPrototypeOf(args)
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, error: 'Tool args must be a plain JSON object' }
  }
  if (!isJsonValue(args)) {
    return { ok: false, error: 'Tool args must contain only JSON values' }
  }
  let serialized: string
  try {
    serialized = JSON.stringify(args)
  } catch {
    return { ok: false, error: 'Tool args must be JSON-serializable' }
  }
  if (serialized.length > MAX_TOOL_ARGS_BYTES) {
    return { ok: false, error: 'Tool args are too large' }
  }
  return { ok: true, value: args as Record<string, unknown> }
}
