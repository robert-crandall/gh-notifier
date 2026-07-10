/**
 * The `write_service_knowledge` MCP tool handler (#100). Writes a service's
 * markdown runbook STRAIGHT THROUGH — ungated, no propose/accept step (the
 * owner's decision) — but recoverable: the store backs up the prior version
 * before every overwrite and refuses to overwrite if that backup fails.
 *
 * The handler validates its input and delegates all filesystem work (service-name
 * safety, symlink refusal, size bounds, atomic write, per-service serialization,
 * metadata stamping) to the store. Its text output is deliberately path-free.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { KNOWLEDGE_MAX_BYTES, writeServiceKnowledge } from '../knowledge/store'

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** Coerce an optional arg to a trimmed non-empty string, or null. */
function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Run the `write_service_knowledge` tool. Writes through the store (off the render thread). */
export async function runWriteServiceKnowledge(args: Record<string, unknown>): Promise<CallToolResult> {
  const service = optionalString(args.service)
  if (service === null) {
    return errorResult('`service` is required and must be a non-empty string (a slug like "payments-api").')
  }
  // `markdown` may be an empty string (intentionally clearing a runbook), so
  // only require that it is a string — don't reject empty.
  if (typeof args.markdown !== 'string') {
    return errorResult('`markdown` is required and must be a string.')
  }

  const res = await writeServiceKnowledge({ service, markdown: args.markdown })
  switch (res.status) {
    case 'invalid_service':
      return errorResult(`Invalid service name: ${res.reason}`)
    case 'blocked':
      return errorResult(res.reason)
    case 'backup_failed':
      return errorResult(
        `Refused to write: could not back up the current version (${res.reason}). No changes were made.`
      )
    case 'too_large':
      return errorResult(
        `Runbook is too large (${res.size} bytes). The maximum is ${KNOWLEDGE_MAX_BYTES} bytes.`
      )
    case 'ok': {
      const backup = res.backedUp ? ' Previous version backed up.' : ''
      return textResult(
        `Wrote the runbook for service "${res.service}" (stamped source: copilot, updated_at: ${res.updatedAt}).${backup}`
      )
    }
  }
}
