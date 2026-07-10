/**
 * The `read_service_knowledge` MCP tool handler (#100). Returns a service's
 * human-editable markdown runbook, read fresh from disk each call so out-of-band
 * hand edits are always seen. Optionally appends a listing of registry resources
 * whose service matches, so prose that references a dashboard/query by name can
 * resolve to the real link.
 *
 * Read-only: never writes. Path safety + symlink refusal + size bounds live in
 * the store; this handler only maps store results to MCP text.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { knowledgeFilePathForService, readServiceKnowledge } from '../knowledge/store'
import { listResourcesByService, type ServiceResource } from '../context/registry'
import { resolveProjectIdByName } from '../db/routing-rules'

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

/** Render matching resources as a compact markdown list the model can resolve aliases against. */
function formatResources(resources: readonly ServiceResource[], scoped: boolean): string {
  if (resources.length === 0) {
    return scoped
      ? 'No saved resources match this service in that project.'
      : 'No saved resources match this service.'
  }
  const lines = resources.map((r) => {
    const parts = [`- **${r.title}** _(project: ${r.projectName})_`]
    if (r.url !== null && r.url.length > 0) parts.push(`— ${r.url}`)
    if (r.aliases.length > 0) parts.push(`— aliases: ${r.aliases.join(', ')}`)
    return parts.join(' ')
  })
  return `## Linked resources\n${lines.join('\n')}`
}

/** Run the `read_service_knowledge` tool. Read-only. */
export function runReadServiceKnowledge(args: Record<string, unknown>): CallToolResult {
  const service = optionalString(args.service)
  if (service === null) {
    return errorResult('`service` is required and must be a non-empty string (a slug like "payments-api").')
  }

  const res = readServiceKnowledge(service)
  switch (res.status) {
    case 'invalid_service':
      return errorResult(`Invalid service name: ${res.reason}`)
    case 'blocked':
      return errorResult(res.reason)
    case 'too_large': {
      const path = knowledgeFilePathForService(res.service)
      const where = path === null ? 'on disk' : `on disk at ${path}`
      return textResult(
        `The runbook for "${res.service}" is ${res.size} bytes, which is too large to return via this tool. Edit it ${where}.`
      )
    }
    case 'missing':
      return textResult(
        `No runbook yet for service "${res.service}". Use write_service_knowledge to create one.`
      )
    case 'ok': {
      const blocks: string[] = [res.knowledge.markdown]
      if (args.includeResources === true) {
        const project = optionalString(args.project)
        let projectId: number | undefined
        let note = ''
        if (project !== null) {
          const id = resolveProjectIdByName(project)
          if (id === null) {
            note = `\n\n_(No active project named "${project}"; listing resources across all projects.)_`
          } else {
            projectId = id
          }
        }
        const resources = listResourcesByService(res.knowledge.service, projectId)
        blocks.push(`${formatResources(resources, projectId !== undefined)}${note}`)
      }
      return { content: blocks.map((text) => ({ type: 'text', text })) }
    }
  }
}
