import type {
  CopilotSessionStatus,
  DriftState,
  Project,
  ProjectDetail,
  ProjectLink,
  ProjectLinkPatch,
  ProjectPatch,
  ProjectStatus,
  ProjectTodo,
  ProjectTodoPatch,
  SnoozeMode,
  SuggestedAction,
} from '../../shared/ipc-channels'
import { getDb } from './index'
import { classifyDrift } from '../digest/classify'

// ── Row types (SQLite returns snake_case column names) ────────────────────────

interface ProjectRow {
  id: number
  name: string
  notes: string
  next_action: string
  status: string
  sort_order: number
  created_at: string
  updated_at: string
  snooze_until: string | null
  snooze_mode: string | null
  last_focused_at: string | null
  digest_seen_at: string | null
  drift_snoozed_until: string | null
  deleted_at: string | null
}

interface TodoRow {
  id: number
  project_id: number | null
  text: string
  done: number
  sort_order: number
  created_at: string
  deleted_at: string | null
  title: string | null
  body: string | null
  source_url: string | null
  suggested_action: string | null
  origin: string
  idempotency_key: string | null
}

interface LinkRow {
  id: number
  project_id: number
  label: string
  url: string
  sort_order: number
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    nextAction: row.next_action,
    status: row.status as ProjectStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unreadCount: 0,
    activeTodoCount: 0,
    snoozeMode: (row.snooze_mode as SnoozeMode) ?? null,
    snoozeUntil: row.snooze_until ?? null,
    copilotStatus: null,
    lastFocusedAt: row.last_focused_at ?? null,
    // Status-only base classification (pure). listProjects/getProject overlay the
    // real time-based drift via classifyDrift.
    driftState: row.status === 'snoozed' ? 'parked' : 'active',
  }
}

/** Time-based drift classification for a project row. */
function driftStateForRow(row: ProjectRow, now: Date): DriftState {
  return classifyDrift({
    status: row.status as ProjectStatus,
    lastFocusedAt: row.last_focused_at ?? null,
    driftSnoozedUntil: row.drift_snoozed_until ?? null,
    createdAt: row.created_at,
    now,
  })
}

/**
 * Parse the stored `suggested_action` JSON back into a typed union. We wrote this value, so it
 * is normally well-formed, but this is the boundary where stored data re-enters the domain, so
 * validate per-kind (required string fields) and degrade a corrupt/partial blob to `null` (no
 * action affordance) rather than letting `undefined` fields leak into the UI.
 */
function parseSuggestedAction(raw: string | null): SuggestedAction | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  switch (obj.kind) {
    case 'pr_comment':
      return str(obj.url) && str(obj.comment) ? { kind: 'pr_comment', url: obj.url, comment: obj.comment } : null
    case 'delegate':
      return str(obj.prompt) ? { kind: 'delegate', prompt: obj.prompt } : null
    case 'open_url':
      return str(obj.url) ? { kind: 'open_url', url: obj.url } : null
    default:
      return null
  }
}

export function toTodo(row: TodoRow): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    text: row.text,
    done: row.done === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    title: row.title,
    body: row.body,
    sourceUrl: row.source_url,
    suggestedAction: parseSuggestedAction(row.suggested_action),
    origin: row.origin === 'copilot' ? 'copilot' : 'user',
    idempotencyKey: row.idempotency_key,
  }
}

export function toLink(row: LinkRow): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    url: row.url,
    sortOrder: row.sort_order,
  }
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  const now = new Date()
  const rows = getDb()
    .prepare(`
      SELECT p.*,
             COALESCE(nc.cnt, 0) AS unread_count,
             COALESCE(tc.cnt, 0) AS active_todo_count,
             cs.top_status AS copilot_status
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt
        FROM notification_threads
        WHERE unread = 1 AND project_id IS NOT NULL
        GROUP BY project_id
      ) nc ON nc.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt
        FROM project_todos
        WHERE done = 0 AND deleted_at IS NULL
        GROUP BY project_id
      ) tc ON tc.project_id = p.id
      LEFT JOIN (
        SELECT project_id,
               CASE MAX(CASE status
                 WHEN 'in_progress' THEN 4
                 WHEN 'waiting'     THEN 3
                 WHEN 'pr_ready'    THEN 2
                 ELSE 0
               END)
                 WHEN 4 THEN 'in_progress'
                 WHEN 3 THEN 'waiting'
                 WHEN 2 THEN 'pr_ready'
                 ELSE NULL
               END AS top_status
        FROM copilot_sessions
        WHERE project_id IS NOT NULL AND status != 'completed'
        GROUP BY project_id
      ) cs ON cs.project_id = p.id
      WHERE p.deleted_at IS NULL
      ORDER BY p.sort_order ASC, p.id ASC
    `)
    .all() as (ProjectRow & { unread_count: number; active_todo_count: number; copilot_status: string | null })[]
  return rows.map((r) => ({
    ...toProject(r),
    unreadCount: r.unread_count,
    activeTodoCount: r.active_todo_count,
    copilotStatus: (r.copilot_status as CopilotSessionStatus) ?? null,
    driftState: driftStateForRow(r, now),
  }))
}

export function getProject(id: number): ProjectDetail {
  const db = getDb()

  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project not found: ${id}`)

  const todos = (
    db
      .prepare(
        'SELECT * FROM project_todos WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
      )
      .all(id) as TodoRow[]
  ).map(toTodo)

  const links = (
    db
      .prepare(
        'SELECT * FROM project_links WHERE project_id = ? ORDER BY sort_order ASC, id ASC'
      )
      .all(id) as LinkRow[]
  ).map(toLink)

  // Compute counts from the data we just fetched
  const unreadCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM notification_threads WHERE project_id = ? AND unread = 1'
  ).get(id) as { cnt: number } | undefined
  
  const activeTodoCount = todos.filter((t) => !t.done).length

  // Compute copilot status for this project
  const copilotRow = db.prepare(`
    SELECT CASE MAX(CASE status
             WHEN 'in_progress' THEN 4
             WHEN 'waiting'     THEN 3
             WHEN 'pr_ready'    THEN 2
             ELSE 0
           END)
             WHEN 4 THEN 'in_progress'
             WHEN 3 THEN 'waiting'
             WHEN 2 THEN 'pr_ready'
             ELSE NULL
           END AS top_status
    FROM copilot_sessions
    WHERE project_id = ? AND status != 'completed'
  `).get(id) as { top_status: string | null } | undefined

  return { 
    ...toProject(row), 
    todos, 
    links,
    unreadCount: unreadCount?.cnt ?? 0,
    activeTodoCount,
    copilotStatus: (copilotRow?.top_status as CopilotSessionStatus) ?? null,
    driftState: driftStateForRow(row, new Date()),
  }
}

export function createProject(name: string): Project {
  const db = getDb()
  const { m } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM projects')
    .get() as { m: number }
  // A brand-new project is "focused now" so it never starts out drifting.
  const row = db
    .prepare(
      "INSERT INTO projects (name, sort_order, last_focused_at) VALUES (?, ?, ?) RETURNING *"
    )
    .get(name, m + 1, new Date().toISOString()) as ProjectRow
  // New project has no todos or notifications yet
  return { ...toProject(row), unreadCount: 0, activeTodoCount: 0 }
}

export function updateProject(id: number, patch: ProjectPatch): Project {
  const db = getDb()

  const current = db
    .prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(id) as ProjectRow | undefined
  if (!current) throw new Error(`Project not found: ${id}`)

  const name = patch.name ?? current.name
  const notes = patch.notes ?? current.notes
  const nextAction = patch.nextAction ?? current.next_action
  const status = patch.status ?? current.status
  const sortOrder = patch.sortOrder ?? current.sort_order

  // Clear snooze fields when un-snoozing via a status patch
  const snoozeUntil = status === 'active' ? null : current.snooze_until
  const snoozeMode = status === 'active' ? null : current.snooze_mode

  const row = db
    .prepare(
      `UPDATE projects
       SET name = ?, notes = ?, next_action = ?, status = ?, sort_order = ?,
           snooze_until = ?, snooze_mode = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(name, notes, nextAction, status, sortOrder, snoozeUntil, snoozeMode, id) as ProjectRow
  
  // Compute counts
  const unreadCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM notification_threads WHERE project_id = ? AND unread = 1'
  ).get(id) as { cnt: number } | undefined
  
  const activeTodoCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM project_todos WHERE project_id = ? AND done = 0 AND deleted_at IS NULL'
  ).get(id) as { cnt: number } | undefined

  // Compute copilot status
  const copilotRow = db.prepare(`
    SELECT CASE MAX(CASE status
             WHEN 'in_progress' THEN 4
             WHEN 'waiting'     THEN 3
             WHEN 'pr_ready'    THEN 2
             ELSE 0
           END)
             WHEN 4 THEN 'in_progress'
             WHEN 3 THEN 'waiting'
             WHEN 2 THEN 'pr_ready'
             ELSE NULL
           END AS top_status
    FROM copilot_sessions
    WHERE project_id = ? AND status != 'completed'
  `).get(id) as { top_status: string | null } | undefined
  
  return { 
    ...toProject(row), 
    unreadCount: unreadCount?.cnt ?? 0,
    activeTodoCount: activeTodoCount?.cnt ?? 0,
    copilotStatus: (copilotRow?.top_status as CopilotSessionStatus) ?? null,
    driftState: driftStateForRow(row, new Date()),
  }
}

/**
 * Soft-delete a project (undoable). Returns its live unread notifications to the
 * Inbox and detaches its Copilot sessions so deleting a project never hides live
 * external work. Todos/links stay attached and are restored with the project.
 */
export function deleteProject(id: number): void {
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare(
      "UPDATE projects SET deleted_at = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
    ).run(new Date().toISOString(), id)
    db.prepare('UPDATE notification_threads SET project_id = NULL WHERE project_id = ?').run(id)
    db.prepare('UPDATE copilot_sessions SET project_id = NULL, pinned_project_id = NULL WHERE project_id = ? OR pinned_project_id = ?').run(id, id)
    // Desktop-app sessions (launched + observed, #119) detach the same way, so a
    // deleted project doesn't keep hiding live external work behind a dead pin.
    db.prepare('UPDATE copilot_app_sessions SET project_id = NULL, pinned_project_id = NULL WHERE project_id = ? OR pinned_project_id = ?').run(id, id)
  })
  run()
}

/** Restore a soft-deleted project (clears the tombstone). */
export function restoreProject(id: number): void {
  getDb()
    .prepare("UPDATE projects SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(id)
}

/** Snoozes a project with the given mode. For date-based snooze, `until` must be an ISO datetime string. */
export function snoozeProject(id: number, mode: SnoozeMode, until?: string): Project {
  // Validate mode and until consistency
  if (mode === 'date' && !until) {
    throw new Error('snooze_until is required when mode is "date"')
  }
  if (mode !== 'date' && until) {
    throw new Error('snooze_until should only be provided when mode is "date"')
  }

  const db = getDb()
  const row = db
    .prepare(
      `UPDATE projects
       SET status = 'snoozed', snooze_mode = ?, snooze_until = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(mode, until ?? null, id) as ProjectRow | undefined
  if (!row) throw new Error(`Project not found: ${id}`)
  
  // Compute counts
  const unreadCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM notification_threads WHERE project_id = ? AND unread = 1'
  ).get(id) as { cnt: number } | undefined
  
  const activeTodoCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM project_todos WHERE project_id = ? AND done = 0 AND deleted_at IS NULL'
  ).get(id) as { cnt: number } | undefined
  
  // Compute copilot status for this project
  const copilotRow = db.prepare(`
    SELECT CASE MAX(CASE status
             WHEN 'in_progress' THEN 4
             WHEN 'waiting'     THEN 3
             WHEN 'pr_ready'    THEN 2
             ELSE 0
           END)
             WHEN 4 THEN 'in_progress'
             WHEN 3 THEN 'waiting'
             WHEN 2 THEN 'pr_ready'
             ELSE NULL
           END AS top_status
    FROM copilot_sessions
    WHERE project_id = ? AND status != 'completed'
  `).get(id) as { top_status: string | null } | undefined

  return { 
    ...toProject(row), 
    unreadCount: unreadCount?.cnt ?? 0,
    activeTodoCount: activeTodoCount?.cnt ?? 0,
    copilotStatus: (copilotRow?.top_status as CopilotSessionStatus) ?? null,
    driftState: driftStateForRow(row, new Date()),
  }
}

/**
 * Wakes any date-based snoozed projects whose snooze_until time has passed.
 * Returns the IDs of projects that were woken.
 */
export function wakeExpiredSnoozes(): number[] {
  const rows = getDb()
    .prepare(
      `UPDATE projects
       SET status = 'active', snooze_mode = NULL, snooze_until = NULL, updated_at = datetime('now')
       WHERE status = 'snoozed' AND snooze_mode = 'date'
         AND deleted_at IS NULL
         AND datetime(snooze_until) <= datetime('now')
       RETURNING id`
    )
    .all() as { id: number }[]
  return rows.map((r) => r.id)
}

// ── Todos ─────────────────────────────────────────────────────────────────────

/** Look up a project's display name by id (live or soft-deleted), or null if it's gone. */
export function getProjectNameById(id: number): string | null {
  const row = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  return row?.name ?? null
}

export function createTodo(projectId: number, text: string): ProjectTodo {
  const db = getDb()
  const { m } = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as m FROM project_todos WHERE project_id = ?'
    )
    .get(projectId) as { m: number }
  const row = db
    .prepare(
      'INSERT INTO project_todos (project_id, text, sort_order) VALUES (?, ?, ?) RETURNING *'
    )
    .get(projectId, text, m + 1) as TodoRow
  return toTodo(row)
}

export function updateTodo(id: number, patch: ProjectTodoPatch): ProjectTodo {
  const db = getDb()

  const current = db
    .prepare('SELECT * FROM project_todos WHERE id = ?')
    .get(id) as TodoRow | undefined
  if (!current) throw new Error(`Todo not found: ${id}`)

  const text = patch.text ?? current.text
  const done = patch.done !== undefined ? (patch.done ? 1 : 0) : current.done
  const sortOrder = patch.sortOrder ?? current.sort_order

  const row = db
    .prepare(
      `UPDATE project_todos SET text = ?, done = ?, sort_order = ? WHERE id = ? RETURNING *`
    )
    .get(text, done, sortOrder, id) as TodoRow
  return toTodo(row)
}

/** Soft-delete a todo (undoable via restoreTodo). */
export function deleteTodo(id: number): void {
  getDb()
    .prepare('UPDATE project_todos SET deleted_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id)
}

/** Restore a soft-deleted todo. */
export function restoreTodo(id: number): void {
  getDb().prepare('UPDATE project_todos SET deleted_at = NULL WHERE id = ?').run(id)
}

// ── Agent todos (the `add_todo` MCP tool) ─────────────────────────────────────

/** Input for {@link addAgentTodo}. Placement is pre-resolved by the tool layer. */
export interface AddAgentTodoInput {
  /** The project this todo resolves to, or `null` for the Inbox. */
  resolvedProjectId: number | null
  /**
   * True only when the caller passed an explicit `project`. On an idempotent update this
   * lets the explicit target MOVE the todo; a repo/inbox resolution leaves placement sticky.
   */
  explicitPlacement: boolean
  title: string
  body: string | null
  sourceUrl: string | null
  suggestedAction: SuggestedAction | null
  /** Deterministic dedup key, or `null` to always insert (no dedup). */
  idempotencyKey: string | null
}

export type AddAgentTodoStatus = 'created' | 'updated' | 'updated_dismissed' | 'updated_completed'

export interface AddAgentTodoResult {
  todo: ProjectTodo
  status: AddAgentTodoStatus
}

function isLiveProject(db: ReturnType<typeof getDb>, projectId: number): boolean {
  const row = db
    .prepare('SELECT 1 AS x FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId)
  return row != null
}

/**
 * Insert (or idempotently update) an agent-originated todo. NEVER touches GitHub — it only
 * writes a row. Dedup is by `idempotencyKey`: a repeated call with the same key updates the
 * existing todo's content instead of duplicating.
 *
 * Placement on an update:
 * - explicit `project` (explicitPlacement) MOVES the todo to the resolved project;
 * - else if the existing todo sits on a now-soft-deleted project, it MOVES to the freshly
 *   resolved target (project or Inbox) so it never gets stranded on a dead project;
 * - else placement is STICKY (respects wherever it currently lives).
 * `done` and `deleted_at` are always preserved — a re-review never silently un-completes or
 * un-dismisses a human's decision; the returned status reports when a hidden todo was touched.
 *
 * Runs read-then-write in a transaction. better-sqlite3 is synchronous and the app uses a
 * single DB connection, so this read-then-write block runs to completion before any other JS
 * (including another add_todo) can begin — there is no interleaving in practice. The partial
 * unique index on idempotency_key is the backstop if that assumption ever changes.
 */
export function addAgentTodo(input: AddAgentTodoInput): AddAgentTodoResult {
  const db = getDb()
  const actionJson = input.suggestedAction === null ? null : JSON.stringify(input.suggestedAction)

  const run = db.transaction((): AddAgentTodoResult => {
    const found =
      input.idempotencyKey === null
        ? undefined
        : (db
            // Scope to agent todos: the tool must never update a user todo, even if one
            // somehow carried a non-null idempotency_key (corrupt DB, manual edit, future
            // feature). A stray key on a user row then falls through to INSERT, where the
            // unique index rejects it — surfaced as a clean isError rather than a silent edit.
            .prepare("SELECT * FROM project_todos WHERE idempotency_key = ? AND origin = 'copilot'")
            .get(input.idempotencyKey) as TodoRow | undefined)
    // bun:sqlite returns null (better-sqlite3 returns undefined) for a missing row — normalize.
    const existing: TodoRow | null = found ?? null

    if (existing === null) {
      // `project_id IS ?` matches both a numeric bucket and the NULL (Inbox) bucket.
      const { m } = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_todos WHERE project_id IS ?')
        .get(input.resolvedProjectId) as { m: number }
      const row = db
        .prepare(
          `INSERT INTO project_todos
             (project_id, text, sort_order, title, body, source_url, suggested_action, origin, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'copilot', ?)
           RETURNING *`
        )
        .get(
          input.resolvedProjectId,
          input.title,
          m + 1,
          input.title,
          input.body,
          input.sourceUrl,
          actionJson,
          input.idempotencyKey
        ) as TodoRow
      return { todo: toTodo(row), status: 'created' }
    }

    let projectId = existing.project_id
    if (input.explicitPlacement) {
      projectId = input.resolvedProjectId
    } else if (existing.project_id !== null && !isLiveProject(db, existing.project_id)) {
      projectId = input.resolvedProjectId
    }

    // If the todo moves to a different bucket, append it (max sort_order + 1 in the
    // destination) rather than carrying its old sort_order, which would interleave it oddly
    // in the destination's (sort_order, id) ordering. Otherwise keep its place.
    const moved = projectId !== existing.project_id
    let sortOrder = existing.sort_order
    if (moved) {
      const { m } = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_todos WHERE project_id IS ?')
        .get(projectId) as { m: number }
      sortOrder = m + 1
    }

    const row = db
      .prepare(
        `UPDATE project_todos
           SET title = ?, body = ?, text = ?, source_url = ?, suggested_action = ?, project_id = ?, sort_order = ?
         WHERE id = ?
         RETURNING *`
      )
      .get(input.title, input.body, input.title, input.sourceUrl, actionJson, projectId, sortOrder, existing.id) as TodoRow

    const status: AddAgentTodoStatus =
      existing.deleted_at !== null
        ? 'updated_dismissed'
        : existing.done === 1
          ? 'updated_completed'
          : 'updated'
    return { todo: toTodo(row), status }
  })

  return run()
}

/** Lists Inbox todos (agent-origin, no owning project, not soft-deleted) for the Inbox surface. */
export function listInboxTodos(): ProjectTodo[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM project_todos WHERE project_id IS NULL AND deleted_at IS NULL AND origin = 'copilot' ORDER BY sort_order ASC, id ASC"
    )
    .all() as TodoRow[]
  return rows.map(toTodo)
}

// ── Links ─────────────────────────────────────────────────────────────────────

export function createLink(projectId: number, label: string, url: string): ProjectLink {
  const db = getDb()
  const { m } = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as m FROM project_links WHERE project_id = ?'
    )
    .get(projectId) as { m: number }
  const row = db
    .prepare(
      'INSERT INTO project_links (project_id, label, url, sort_order) VALUES (?, ?, ?, ?) RETURNING *'
    )
    .get(projectId, label, url, m + 1) as LinkRow
  return toLink(row)
}

export function updateLink(id: number, patch: ProjectLinkPatch): ProjectLink {
  const db = getDb()

  const current = db
    .prepare('SELECT * FROM project_links WHERE id = ?')
    .get(id) as LinkRow | undefined
  if (!current) throw new Error(`Link not found: ${id}`)

  const label = patch.label ?? current.label
  const url = patch.url ?? current.url
  const sortOrder = patch.sortOrder ?? current.sort_order

  const row = db
    .prepare(
      `UPDATE project_links SET label = ?, url = ?, sort_order = ? WHERE id = ? RETURNING *`
    )
    .get(label, url, sortOrder, id) as LinkRow
  return toLink(row)
}

export function deleteLink(id: number): void {
  getDb().prepare('DELETE FROM project_links WHERE id = ?').run(id)
}
