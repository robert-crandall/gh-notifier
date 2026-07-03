import type {
  McpServerConfig,
  McpServerInput,
  McpStdioConfig,
  ProjectCard,
  ProjectCardPatch,
  Resource,
  ResourceInput,
  ResourceKind,
  ResourcePatch,
  ResourceProvenance,
  ResourceValidationState,
  ResolveFailureClass,
  ResolveVerdict,
} from '../../shared/ipc-channels'
import { getDb } from '../db'

// ── Row types (SQLite returns snake_case column names) ────────────────────────

interface ResourceRow {
  id: number
  project_id: number
  title: string
  kind: string
  source: string
  service: string
  env: string
  tags_json: string
  url: string | null
  description: string
  aliases_json: string
  provenance: string
  confidence: number
  last_used: string | null
  last_verified: string | null
  failure_count: number
  suspect: number
  pinned_group: string | null
  mcp_server: string | null
  tool_name: string | null
  tool_args_json: string | null
  external_ref: string | null
  validation_state: string
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface ProjectCardRow {
  project_id: number
  purpose: string
  repos_json: string
  services_json: string
  active_goal: string
  glossary_json: string
  updated_at: string
}

interface McpServerRow {
  id: string
  project_id: number
  label: string
  config_json: string
  created_at: string
  updated_at: string
}

// ── JSON helpers (defensive: a malformed column never crashes a read) ──────────

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  } catch {
    /* fall through to empty */
  }
  return []
}

function parseStringMap(raw: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {
    /* fall through */
  }
  return {}
}

function parseUnknownMap(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return null
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── Write-time normalization (avoid stray-whitespace duplicate groups / lookups) ─

/** Trims; falls back to a default when the result is empty. */
function trimOr(value: string | undefined, fallback: string): string {
  const t = (value ?? '').trim()
  return t.length > 0 ? t : fallback
}

/** Trims a nullable string; empty/whitespace becomes null. */
function trimToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

export function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    kind: row.kind as ResourceKind,
    source: row.source,
    service: row.service,
    env: row.env,
    tags: parseStringMap(row.tags_json),
    url: row.url,
    description: row.description,
    aliases: parseStringArray(row.aliases_json),
    provenance: row.provenance as ResourceProvenance,
    confidence: row.confidence,
    lastUsed: row.last_used,
    lastVerified: row.last_verified,
    failureCount: row.failure_count,
    suspect: row.suspect === 1,
    pinnedGroup: row.pinned_group,
    mcpServer: row.mcp_server,
    toolName: row.tool_name,
    toolArgs: parseUnknownMap(row.tool_args_json),
    externalRef: row.external_ref,
    validationState: row.validation_state as ResourceValidationState,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toProjectCard(row: ProjectCardRow): ProjectCard {
  return {
    projectId: row.project_id,
    purpose: row.purpose,
    repos: parseStringArray(row.repos_json),
    services: parseStringArray(row.services_json),
    activeGoal: row.active_goal,
    glossary: parseStringMap(row.glossary_json),
    updatedAt: row.updated_at,
  }
}

function parseStdioConfig(raw: string): McpStdioConfig {
  try {
    const value: unknown = JSON.parse(raw)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>
      const command = typeof v.command === 'string' ? v.command : ''
      const args = Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : []
      const env =
        v.env !== null && typeof v.env === 'object' && !Array.isArray(v.env)
          ? Object.fromEntries(
              Object.entries(v.env as Record<string, unknown>).filter(
                (e): e is [string, string] => typeof e[1] === 'string'
              )
            )
          : {}
      return { command, args, env }
    }
  } catch {
    /* fall through */
  }
  return { command: '', args: [], env: {} }
}

export function toMcpServer(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    config: parseStdioConfig(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Resource CRUD ─────────────────────────────────────────────────────────────

/** Lists a project's live (non-deleted) resources, newest first. */
export function listResources(projectId: number): Resource[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM resources WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC'
    )
    .all(projectId) as ResourceRow[]
  return rows.map(toResource)
}

/** Fetches one live resource by id, or null when missing/deleted. */
export function getResource(id: number): Resource | null {
  const row = getDb()
    .prepare('SELECT * FROM resources WHERE id = ? AND deleted_at IS NULL')
    .get(id) as ResourceRow | undefined
  return row ? toResource(row) : null
}

export function createResource(projectId: number, input: ResourceInput): Resource {
  const title = input.title.trim()
  if (title.length === 0) throw new Error('A resource title is required')

  const row = getDb()
    .prepare(
      `INSERT INTO resources (
         project_id, title, kind, source, service, env, tags_json, url, description,
         aliases_json, provenance, mcp_server, tool_name, tool_args_json, external_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      projectId,
      title,
      input.kind ?? 'link',
      trimOr(input.source, 'generic'),
      (input.service ?? '').trim(),
      (input.env ?? '').trim(),
      JSON.stringify(input.tags ?? {}),
      trimToNull(input.url),
      input.description ?? '',
      JSON.stringify(input.aliases ?? []),
      input.provenance ?? 'manual',
      trimToNull(input.mcpServer),
      trimToNull(input.toolName),
      input.toolArgs != null ? JSON.stringify(input.toolArgs) : null,
      trimToNull(input.externalRef)
    ) as ResourceRow
  return toResource(row)
}

/** Updates user-editable fields on a resource. Only supplied fields change. */
export function updateResource(id: number, patch: ResourcePatch): Resource {
  const db = getDb()
  const current = db
    .prepare('SELECT * FROM resources WHERE id = ? AND deleted_at IS NULL')
    .get(id) as ResourceRow | undefined
  if (!current) throw new Error(`Resource not found: ${id}`)

  const title = patch.title !== undefined ? patch.title.trim() : current.title
  if (title.length === 0) throw new Error('A resource title is required')

  const row = db
    .prepare(
      `UPDATE resources SET
         title = ?, kind = ?, source = ?, service = ?, env = ?, tags_json = ?,
         url = ?, description = ?, aliases_json = ?, pinned_group = ?,
         mcp_server = ?, tool_name = ?, tool_args_json = ?, external_ref = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?
       RETURNING *`
    )
    .get(
      title,
      patch.kind ?? current.kind,
      trimOr(patch.source ?? current.source, 'generic'),
      (patch.service ?? current.service).trim(),
      (patch.env ?? current.env).trim(),
      patch.tags !== undefined ? JSON.stringify(patch.tags) : current.tags_json,
      patch.url !== undefined ? trimToNull(patch.url) : current.url,
      patch.description ?? current.description,
      patch.aliases !== undefined ? JSON.stringify(patch.aliases) : current.aliases_json,
      patch.pinnedGroup !== undefined ? trimToNull(patch.pinnedGroup) : current.pinned_group,
      patch.mcpServer !== undefined ? trimToNull(patch.mcpServer) : current.mcp_server,
      patch.toolName !== undefined ? trimToNull(patch.toolName) : current.tool_name,
      patch.toolArgs !== undefined
        ? patch.toolArgs != null
          ? JSON.stringify(patch.toolArgs)
          : null
        : current.tool_args_json,
      patch.externalRef !== undefined ? trimToNull(patch.externalRef) : current.external_ref,
      id
    ) as ResourceRow
  return toResource(row)
}

/** Soft-deletes a resource (undoable via restoreResource). */
export function deleteResource(id: number): void {
  getDb()
    .prepare(
      "UPDATE resources SET deleted_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    )
    .run(nowIso(), id)
}

/** Restores a soft-deleted resource. */
export function restoreResource(id: number): void {
  getDb()
    .prepare(
      "UPDATE resources SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    )
    .run(id)
}

// ── Health mutators (maintenance-by-use) ──────────────────────────────────────

/** Clamps a confidence value into [0, 1]. */
function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Records a use of a resource. When `verified` (an app-owned read actually
 * succeeded), it bumps last_used/last_verified, nudges confidence up, clears
 * suspect + errors, and marks the query valid. When NOT verified (e.g. a
 * doc/link or a source we cited but couldn't read), it updates last_used ONLY —
 * it must never silently heal a previously-suspect query without a real read.
 */
export function markResourceUsed(id: number, verified: boolean): void {
  const db = getDb()
  const current = db.prepare('SELECT confidence FROM resources WHERE id = ?').get(id) as
    | { confidence: number }
    | undefined
  if (!current) return
  const ts = nowIso()

  if (!verified) {
    db.prepare(
      `UPDATE resources SET last_used = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
    ).run(ts, id)
    return
  }

  const nextConfidence = clampConfidence(current.confidence + 0.1)
  db.prepare(
    `UPDATE resources SET
       last_used = ?,
       last_verified = ?,
       confidence = ?,
       suspect = 0,
       failure_count = 0,
       validation_state = 'valid',
       last_error_code = NULL,
       last_error_message = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(ts, ts, nextConfidence, id)
}

/**
 * Marks a resource suspect because the *source itself* is bad (a query that
 * 400'd or returned no-data). Increments failure_count, nudges confidence down,
 * and records the validation state + error. Infra/model failures must NOT call
 * this — see resolve.ts failure classification.
 */
export function markResourceSuspect(
  id: number,
  validationState: Extract<ResourceValidationState, 'invalid' | 'no_data'>,
  errorCode: string | null,
  errorMessage: string | null
): void {
  const db = getDb()
  const current = db.prepare('SELECT confidence FROM resources WHERE id = ?').get(id) as
    | { confidence: number }
    | undefined
  if (!current) return
  const nextConfidence = clampConfidence(current.confidence - 0.2)
  db.prepare(
    `UPDATE resources SET
       suspect = 1,
       failure_count = failure_count + 1,
       confidence = ?,
       validation_state = ?,
       last_error_code = ?,
       last_error_message = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(nextConfidence, validationState, errorCode, errorMessage, id)
}

// ── Resolution audit log ──────────────────────────────────────────────────────

export interface ResolutionLogEntry {
  projectId: number
  resourceId: number | null
  question: string
  verdict: ResolveVerdict
  citedResourceId: number | null
  answer: string
  failureClass: ResolveFailureClass | null
}

/** Appends a resolution to the audit log (powers staleness-when-relevant). */
export function recordResolution(entry: ResolutionLogEntry): void {
  getDb()
    .prepare(
      `INSERT INTO resource_resolutions
         (project_id, resource_id, question, verdict, cited_resource_id, answer, failure_class)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.projectId,
      entry.resourceId,
      entry.question,
      entry.verdict,
      entry.citedResourceId,
      entry.answer,
      entry.failureClass
    )
}

// ── Project card ──────────────────────────────────────────────────────────────

/** Returns the project card, lazily creating an empty one on first read. */
export function getProjectCard(projectId: number): ProjectCard {
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM project_cards WHERE project_id = ?')
    .get(projectId) as ProjectCardRow | undefined
  if (existing) return toProjectCard(existing)

  const created = db
    .prepare('INSERT INTO project_cards (project_id) VALUES (?) RETURNING *')
    .get(projectId) as ProjectCardRow
  return toProjectCard(created)
}

/** Updates the project card (upsert). Only supplied fields change. */
export function upsertProjectCard(projectId: number, patch: ProjectCardPatch): ProjectCard {
  const current = getProjectCard(projectId)
  const row = getDb()
    .prepare(
      `UPDATE project_cards SET
         purpose = ?, repos_json = ?, services_json = ?, active_goal = ?, glossary_json = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ?
       RETURNING *`
    )
    .get(
      patch.purpose ?? current.purpose,
      JSON.stringify(patch.repos ?? current.repos),
      JSON.stringify(patch.services ?? current.services),
      patch.activeGoal ?? current.activeGoal,
      JSON.stringify(patch.glossary ?? current.glossary),
      projectId
    ) as ProjectCardRow
  return toProjectCard(row)
}

// ── Per-project MCP servers ───────────────────────────────────────────────────

export function listMcpServers(projectId: number): McpServerConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM project_mcp_servers WHERE project_id = ? ORDER BY created_at ASC, id ASC')
    .all(projectId) as McpServerRow[]
  return rows.map(toMcpServer)
}

/** Returns a single MCP server config by id, or null. */
export function getMcpServer(id: string): McpServerConfig | null {
  const row = getDb()
    .prepare('SELECT * FROM project_mcp_servers WHERE id = ?')
    .get(id) as McpServerRow | undefined
  return row ? toMcpServer(row) : null
}

/** Creates or updates an MCP server config. `id` is stable across updates. */
export function upsertMcpServer(projectId: number, id: string, input: McpServerInput): McpServerConfig {
  const configJson = JSON.stringify(input.config)
  const row = getDb()
    .prepare(
      `INSERT INTO project_mcp_servers (id, project_id, label, config_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         config_json = excluded.config_json,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       RETURNING *`
    )
    .get(id, projectId, input.label, configJson) as McpServerRow
  return toMcpServer(row)
}

export function deleteMcpServer(id: string): void {
  getDb().prepare('DELETE FROM project_mcp_servers WHERE id = ?').run(id)
}
