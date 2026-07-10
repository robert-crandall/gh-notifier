import type {
  ProjectCard,
  ProjectCardPatch,
  Resource,
  ResourceInput,
  ResourceKind,
  ResourcePatch,
  ResourceProvenance,
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
  pinned_group: string | null
  external_ref: string | null
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
    pinnedGroup: row.pinned_group,
    externalRef: row.external_ref,
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

/** A live resource plus the name of its owning project. */
export interface ServiceResource extends Resource {
  projectName: string
}

/**
 * Read-only lookup of live resources whose `service` matches (case-insensitively)
 * — used by the `read_service_knowledge` tool so prose that references a resource
 * by alias can resolve to the link truth. Each row carries its owning project's
 * name so results are never silently conflated across projects; pass `projectId`
 * to scope to a single project. Newest first.
 */
export function listResourcesByService(service: string, projectId?: number): ServiceResource[] {
  const norm = service.trim().toLowerCase()
  const params: unknown[] = [norm]
  let sql =
    'SELECT r.*, p.name AS project_name FROM resources r ' +
    'JOIN projects p ON p.id = r.project_id ' +
    'WHERE r.deleted_at IS NULL AND lower(r.service) = ?'
  if (projectId !== undefined) {
    sql += ' AND r.project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY r.updated_at DESC, r.id DESC'
  const rows = getDb().prepare(sql).all(...params) as Array<ResourceRow & { project_name: string }>
  return rows.map((row) => ({ ...toResource(row), projectName: row.project_name }))
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
         aliases_json, provenance, external_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         url = ?, description = ?, aliases_json = ?, pinned_group = ?, external_ref = ?,
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

/**
 * Read the project card WITHOUT lazily creating it — for read-only callers (the
 * recommendation path, #88) that must not write. Returns a default empty card
 * when none is saved yet.
 */
export function getProjectCardReadOnly(projectId: number): ProjectCard {
  const existing = getDb()
    .prepare('SELECT * FROM project_cards WHERE project_id = ?')
    .get(projectId) as ProjectCardRow | undefined
  if (existing) return toProjectCard(existing)
  // Match the DB's updated_at default shape (a parseable ISO timestamp) so a
  // future caller can't trip on an unparseable empty string. Still read-only.
  return { projectId, purpose: '', repos: [], services: [], activeGoal: '', glossary: {}, updatedAt: new Date().toISOString() }
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
