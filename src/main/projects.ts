import { ipcMain } from 'electron'
import { getDb } from './db'
import type { Project, ProjectLink, ProjectTodo } from '../shared/types'

// ── Row mappers ───────────────────────────────────────────────────────────────

interface ProjectRow {
  id: number
  name: string
  notes: string
  next_action: string
  status: string
  position: number
  created_at: string
  updated_at: string
}

interface LinkRow {
  id: number
  project_id: number
  label: string
  url: string
  position: number
}

interface TodoRow {
  id: number
  project_id: number
  title: string
  done: number
  position: number
  created_at: string
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    nextAction: row.next_action,
    status: row.status as Project['status'],
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapLink(row: LinkRow): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    url: row.url,
    position: row.position
  }
}

function mapTodo(row: TodoRow): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    done: row.done === 1,
    position: row.position,
    createdAt: row.created_at
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerProjectHandlers(): void {
  const db = getDb()

  // ── Projects ────────────────────────────────────────────────────────────────

  ipcMain.handle('projects:list', (): Project[] => {
    const rows = db
      .prepare('SELECT * FROM projects ORDER BY position ASC, created_at ASC')
      .all() as ProjectRow[]
    return rows.map(mapProject)
  })

  ipcMain.handle('projects:create', (_event, { name }: { name: string }): Project => {
    const maxPos = (
      db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM projects').get() as { m: number }
    ).m
    const result = db
      .prepare(
        `INSERT INTO projects (name, position) VALUES (?, ?)
         RETURNING *`
      )
      .get(name, maxPos + 1) as ProjectRow
    return mapProject(result)
  })

  ipcMain.handle(
    'projects:update',
    (
      _event,
      {
        id,
        changes
      }: {
        id: number
        changes: Partial<{
          name: string
          notes: string
          nextAction: string
          status: string
          position: number
        }>
      }
    ): Project => {
      const colMap: Record<string, string> = {
        name: 'name',
        notes: 'notes',
        nextAction: 'next_action',
        status: 'status',
        position: 'position'
      }
      const setClauses: string[] = []
      const values: unknown[] = []
      for (const [key, value] of Object.entries(changes)) {
        const col = colMap[key]
        if (col) {
          setClauses.push(`${col} = ?`)
          values.push(value)
        }
      }
      if (setClauses.length === 0) {
        const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
        return mapProject(row)
      }
      setClauses.push(`updated_at = datetime('now')`)
      values.push(id)
      const row = db
        .prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`)
        .get(...(values as Parameters<typeof db.prepare>)) as ProjectRow
      return mapProject(row)
    }
  )

  ipcMain.handle('projects:delete', (_event, { id }: { id: number }): void => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  })

  // ── Todos ───────────────────────────────────────────────────────────────────

  ipcMain.handle('todos:list', (_event, { projectId }: { projectId: number }): ProjectTodo[] => {
    const rows = db
      .prepare('SELECT * FROM project_todos WHERE project_id = ? ORDER BY position ASC, id ASC')
      .all(projectId) as TodoRow[]
    return rows.map(mapTodo)
  })

  ipcMain.handle(
    'todos:create',
    (_event, { projectId, title }: { projectId: number; title: string }): ProjectTodo => {
      const maxPos = (
        db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) AS m FROM project_todos WHERE project_id = ?'
          )
          .get(projectId) as { m: number }
      ).m
      const result = db
        .prepare(
          `INSERT INTO project_todos (project_id, title, position) VALUES (?, ?, ?)
           RETURNING *`
        )
        .get(projectId, title, maxPos + 1) as TodoRow
      return mapTodo(result)
    }
  )

  ipcMain.handle(
    'todos:update',
    (
      _event,
      {
        id,
        changes
      }: { id: number; changes: Partial<{ title: string; done: boolean; position: number }> }
    ): ProjectTodo => {
      const setClauses: string[] = []
      const values: unknown[] = []
      if (changes.title !== undefined) {
        setClauses.push('title = ?')
        values.push(changes.title)
      }
      if (changes.done !== undefined) {
        setClauses.push('done = ?')
        values.push(changes.done ? 1 : 0)
      }
      if (changes.position !== undefined) {
        setClauses.push('position = ?')
        values.push(changes.position)
      }
      if (setClauses.length === 0) {
        const row = db.prepare('SELECT * FROM project_todos WHERE id = ?').get(id) as TodoRow
        return mapTodo(row)
      }
      values.push(id)
      const row = db
        .prepare(`UPDATE project_todos SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`)
        .get(...(values as Parameters<typeof db.prepare>)) as TodoRow
      return mapTodo(row)
    }
  )

  ipcMain.handle('todos:delete', (_event, { id }: { id: number }): void => {
    db.prepare('DELETE FROM project_todos WHERE id = ?').run(id)
  })

  // ── Links ───────────────────────────────────────────────────────────────────

  ipcMain.handle('links:list', (_event, { projectId }: { projectId: number }): ProjectLink[] => {
    const rows = db
      .prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY position ASC, id ASC')
      .all(projectId) as LinkRow[]
    return rows.map(mapLink)
  })

  ipcMain.handle(
    'links:create',
    (
      _event,
      { projectId, label, url }: { projectId: number; label: string; url: string }
    ): ProjectLink => {
      const maxPos = (
        db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) AS m FROM project_links WHERE project_id = ?'
          )
          .get(projectId) as { m: number }
      ).m
      const result = db
        .prepare(
          `INSERT INTO project_links (project_id, label, url, position) VALUES (?, ?, ?, ?)
           RETURNING *`
        )
        .get(projectId, label, url, maxPos + 1) as LinkRow
      return mapLink(result)
    }
  )

  ipcMain.handle(
    'links:update',
    (
      _event,
      {
        id,
        changes
      }: { id: number; changes: Partial<{ label: string; url: string; position: number }> }
    ): ProjectLink => {
      const setClauses: string[] = []
      const values: unknown[] = []
      if (changes.label !== undefined) {
        setClauses.push('label = ?')
        values.push(changes.label)
      }
      if (changes.url !== undefined) {
        setClauses.push('url = ?')
        values.push(changes.url)
      }
      if (changes.position !== undefined) {
        setClauses.push('position = ?')
        values.push(changes.position)
      }
      if (setClauses.length === 0) {
        const row = db.prepare('SELECT * FROM project_links WHERE id = ?').get(id) as LinkRow
        return mapLink(row)
      }
      values.push(id)
      const row = db
        .prepare(`UPDATE project_links SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`)
        .get(...(values as Parameters<typeof db.prepare>)) as LinkRow
      return mapLink(row)
    }
  )

  ipcMain.handle('links:delete', (_event, { id }: { id: number }): void => {
    db.prepare('DELETE FROM project_links WHERE id = ?').run(id)
  })
}
