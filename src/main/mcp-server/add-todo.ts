/**
 * The `add_todo` MCP tool handler. Copilot calls this to file a rich, human-gated todo in a
 * GH Projects project — the first real tool on the inbound MCP server (#102).
 *
 * Hard invariant: this NEVER writes to GitHub. It validates its input, resolves a project,
 * and inserts (or idempotently updates) a todo row. Any "action" it carries is a PROPOSAL the
 * human approves in the app.
 *
 * Placement precedence mirrors how notifications resolve a repo: explicit `project` name wins;
 * else `repo` (owner/name) via the shared routing rules; else the Inbox. Dedup is by a
 * deterministic key derived from the (normalized) `sourceUrl` plus the full suggested-action
 * identity, so a re-review of the same PR proposing the same action updates in place, while a
 * genuinely different action produces a distinct todo.
 */

import { createHash } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SuggestedAction } from '../../shared/ipc-channels'
import { parseSafeExternalUrl } from '../../shared/safe-url'
import { resolveProjectIdByName, resolveProjectIdForRepo } from '../db/routing-rules'
import { addAgentTodo, getProjectNameById } from '../db/projects'

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

/** Parse `owner/name` (tolerating a leading `github.com/`). Returns null when unparseable. */
function parseRepo(repo: string): { owner: string; name: string } | null {
  const cleaned = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '')
  const parts = cleaned.split('/').filter((p) => p.length > 0)
  if (parts.length !== 2) return null
  return { owner: parts[0], name: parts[1] }
}

type ActionParse =
  | { ok: true; value: SuggestedAction | null }
  | { ok: false; error: string }

/** Validate + normalize the optional `suggestedAction`. URLs are gated to http/https. */
function parseSuggestedAction(raw: unknown): ActionParse {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object') {
    return { ok: false, error: 'suggestedAction must be an object.' }
  }
  const obj = raw as Record<string, unknown>
  switch (obj.kind) {
    case 'pr_comment': {
      const url = parseSafeExternalUrl(obj.url)
      if (url === null) return { ok: false, error: 'suggestedAction.url must be an http(s) URL.' }
      if (typeof obj.comment !== 'string' || obj.comment.trim().length === 0) {
        return { ok: false, error: 'suggestedAction.comment is required for kind "pr_comment".' }
      }
      return { ok: true, value: { kind: 'pr_comment', url, comment: obj.comment } }
    }
    case 'delegate': {
      if (typeof obj.prompt !== 'string' || obj.prompt.trim().length === 0) {
        return { ok: false, error: 'suggestedAction.prompt is required for kind "delegate".' }
      }
      return { ok: true, value: { kind: 'delegate', prompt: obj.prompt } }
    }
    case 'open_url': {
      const url = parseSafeExternalUrl(obj.url)
      if (url === null) return { ok: false, error: 'suggestedAction.url must be an http(s) URL.' }
      return { ok: true, value: { kind: 'open_url', url } }
    }
    default:
      return {
        ok: false,
        error: 'suggestedAction.kind must be one of: pr_comment, delegate, open_url.',
      }
  }
}

/** Stable, collision-resistant serialization of a suggested action's identity. */
function canonicalAction(action: SuggestedAction | null): string {
  if (action === null) return 'none'
  switch (action.kind) {
    case 'pr_comment':
      return `pr_comment\n${action.url}\n${action.comment}`
    case 'delegate':
      return `delegate\n${action.prompt}`
    case 'open_url':
      return `open_url\n${action.url}`
  }
}

/**
 * Deterministic dedup key = sha256(normalized sourceUrl + full action identity). Null when
 * there is no sourceUrl (nothing stable to dedup on → always insert). We hash the FULL action
 * (not just its kind) so two distinct actions on the same PR don't collide.
 */
function computeIdempotencyKey(sourceHref: string | null, action: SuggestedAction | null): string | null {
  if (sourceHref === null) return null
  return createHash('sha256').update(`${sourceHref}\n${canonicalAction(action)}`).digest('hex')
}

/** Run the `add_todo` tool. Pure w.r.t. the network; only reads/writes the local DB. */
export function runAddTodo(args: Record<string, unknown>): CallToolResult {
  const title = optionalString(args.title)
  if (title === null) {
    return errorResult('`title` is required and must be a non-empty string.')
  }

  const body = optionalString(args.body)

  // Validate sourceUrl (if present) and normalize it to a safe href for storage + dedup.
  let sourceHref: string | null = null
  if (args.sourceUrl !== undefined && args.sourceUrl !== null) {
    sourceHref = parseSafeExternalUrl(args.sourceUrl)
    if (sourceHref === null) {
      return errorResult('`sourceUrl` must be an http(s) URL.')
    }
  }

  const action = parseSuggestedAction(args.suggestedAction)
  if (!action.ok) {
    return errorResult(action.error)
  }

  // Resolve placement: explicit project wins; else repo; else Inbox.
  const project = optionalString(args.project)
  const repo = optionalString(args.repo)
  let resolvedProjectId: number | null = null
  let explicitPlacement = false

  if (project !== null) {
    const id = resolveProjectIdByName(project)
    if (id === null) {
      return errorResult(
        `No active project named "${project}". Create it first, or drop \`project\` to route by \`repo\` / land in the Inbox.`
      )
    }
    resolvedProjectId = id
    explicitPlacement = true
  } else if (repo !== null) {
    const parsed = parseRepo(repo)
    resolvedProjectId = parsed === null ? null : resolveProjectIdForRepo(parsed.owner, parsed.name)
  }

  const idempotencyKey = computeIdempotencyKey(sourceHref, action.value)

  const { todo, status } = addAgentTodo({
    resolvedProjectId,
    explicitPlacement,
    title,
    body,
    sourceUrl: sourceHref,
    suggestedAction: action.value,
    idempotencyKey,
  })

  const location =
    todo.projectId === null
      ? 'the Inbox'
      : `project "${getProjectNameById(todo.projectId) ?? `#${todo.projectId}`}"`
  const verb = status === 'created' ? 'Created' : 'Updated'
  const note =
    status === 'updated_dismissed'
      ? ' Note: this todo had been dismissed and remains dismissed.'
      : status === 'updated_completed'
        ? ' Note: this todo was already marked done and remains done.'
        : ''

  return textResult(`${verb} todo #${todo.id} "${todo.title ?? todo.text}" in ${location}.${note}`)
}
