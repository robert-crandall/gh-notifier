import type {
  Project,
  ProjectDetail,
  ProjectLink,
  ProjectLinkPatch,
  ProjectPatch,
  ProjectStatus,
  ProjectTodo,
  ProjectTodoPatch,
} from '../../shared/ipc-channels'
import { getDb } from './index'

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
}

interface TodoRow {
  id: number
  project_id: number
  text: string
  done: number
  sort_order: number
  created_at: string
}

interface LinkRow {
  id: number
  project_id: number
  label: string
  url: string
  sort_order: number
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

function toProject(row: ProjectRow): Project {
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
  }
}

function toTodo(row: TodoRow): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    text: row.text,
    done: row.done === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function toLink(row: LinkRow): ProjectLink {
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
  const rows = getDb()
    .prepare(`
      SELECT p.*,
             COALESCE(nc.cnt, 0) AS unread_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt
        FROM notification_threads
        WHERE unread = 1 AND project_id IS NOT NULL
        GROUP BY project_id
      ) nc ON nc.project_id = p.id
      ORDER BY p.sort_order ASC, p.id ASC
    `)
    .all() as (ProjectRow & { unread_count: number })[]
  return rows.map((r) => ({ ...toProject(r), unreadCount: r.unread_count }))
}

export function getProject(id: number): ProjectDetail {
  const db = getDb()

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
  if (!row) throw new Error(`Project not found: ${id}`)

  const todos = (
    db
      .prepare(
        'SELECT * FROM project_todos WHERE project_id = ? ORDER BY sort_order ASC, id ASC'
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

  return { ...toProject(row), todos, links }
}

export function createProject(name: string): Project {
  const db = getDb()
  const { m } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM projects')
    .get() as { m: number }
  const row = db
    .prepare(
      "INSERT INTO projects (name, sort_order) VALUES (?, ?) RETURNING *"
    )
    .get(name, m + 1) as ProjectRow
  return toProject(row)
}

export function updateProject(id: number, patch: ProjectPatch): Project {
  const db = getDb()

  const current = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as ProjectRow | undefined
  if (!current) throw new Error(`Project not found: ${id}`)

  const name = patch.name ?? current.name
  const notes = patch.notes ?? current.notes
  const nextAction = patch.nextAction ?? current.next_action
  const status = patch.status ?? current.status
  const sortOrder = patch.sortOrder ?? current.sort_order

  const row = db
    .prepare(
      `UPDATE projects
       SET name = ?, notes = ?, next_action = ?, status = ?, sort_order = ?,
           updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(name, notes, nextAction, status, sortOrder, id) as ProjectRow
  return toProject(row)
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// ── Todos ─────────────────────────────────────────────────────────────────────

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

export function deleteTodo(id: number): void {
  getDb().prepare('DELETE FROM project_todos WHERE id = ?').run(id)
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
