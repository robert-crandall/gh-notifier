import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db'
import { runMigrations } from '../../db/migrate'
import { insertAppSession, getAppSession, getAppSessionsForProject, updateAppSessionStatus, linkTodoSession, getTodoAppSessionsForProject } from './store'
import {
  getSessionsForProject,
  getUnassignedSessions,
  getUnassignedActiveCount,
  getAllStatuses,
} from '../../copilot/db'
import { listProjects, getProject } from '../../db/projects'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function makeProject(name: string): number {
  const row = db.prepare('INSERT INTO projects (name) VALUES (?) RETURNING id').get(name) as { id: number }
  return row.id
}

function makeTodo(projectId: number, text: string): number {
  return (
    db.prepare('INSERT INTO project_todos (project_id, text) VALUES (?, ?) RETURNING id').get(projectId, text) as {
      id: number
    }
  ).id
}

describe('copilot_app_sessions store', () => {
  it('inserts + reads back an app session', () => {
    const pid = makeProject('P')
    const s = insertAppSession({
      id: 'app-1', projectId: pid, cwd: '/repos/foo', title: 'do it', repoOwner: 'me', repoName: 'foo',
    })
    expect(s.id).toBe('app-1')
    expect(s.status).toBe('in_progress')
    expect(getAppSession('app-1')).toEqual(s)
    expect(getAppSessionsForProject(pid).map((r) => r.id)).toEqual(['app-1'])
  })

  it('updates status', () => {
    const pid = makeProject('P')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    updateAppSessionStatus('app-1', 'completed')
    expect(getAppSession('app-1')?.status).toBe('completed')
  })

  it('tracks a session unassigned when the originating project is soft-deleted', () => {
    const pid = makeProject('P')
    db.prepare("UPDATE projects SET deleted_at = datetime('now') WHERE id = ?").run(pid)
    const s = insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    expect(s.projectId).toBeNull()
  })
})

describe('reader isolation — app sessions never leak into github-session surfaces', () => {
  it('is invisible to every existing copilot_sessions reader', () => {
    const pid = makeProject('P')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: 'me', repoName: 'foo' })

    // None of the github-session readers (which query copilot_sessions) see it.
    expect(getSessionsForProject(pid)).toEqual([])
    expect(getUnassignedSessions()).toEqual([])
    expect(getUnassignedActiveCount()).toBe(0)
    expect(getAllStatuses()).toEqual({})

    // Project status aggregates are unaffected too.
    const listed = listProjects().find((p) => p.id === pid)
    expect(listed?.copilotStatus ?? null).toBeNull()
    expect(getProject(pid)?.copilotStatus ?? null).toBeNull()
  })
})

describe('todo ↔ app-session links (#87)', () => {
  it('links a session to a todo and reads it back paired', () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 'do it', repoOwner: 'me', repoName: 'foo' })
    linkTodoSession(todoId, 'app-1')
    const pairs = getTodoAppSessionsForProject(pid)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.todoId).toBe(todoId)
    expect(pairs[0]?.session.id).toBe('app-1')
  })

  it('is idempotent per (todo, session) pair', () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    linkTodoSession(todoId, 'app-1')
    linkTodoSession(todoId, 'app-1')
    expect(getTodoAppSessionsForProject(pid)).toHaveLength(1)
  })

  it('lets a todo carry multiple sessions (re-delegation never hides a prior one)', () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    insertAppSession({ id: 'app-2', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    linkTodoSession(todoId, 'app-1')
    linkTodoSession(todoId, 'app-2')
    expect(getTodoAppSessionsForProject(pid).map((p) => p.session.id).sort()).toEqual(['app-1', 'app-2'])
  })

  it('rejects linking one session to two different todos (a session comes from one todo)', () => {
    const pid = makeProject('P')
    const todoA = makeTodo(pid, 'A')
    const todoB = makeTodo(pid, 'B')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    linkTodoSession(todoA, 'app-1')
    linkTodoSession(todoA, 'app-1') // same pair → idempotent, no throw
    expect(() => linkTodoSession(todoB, 'app-1')).toThrow('SESSION_ALREADY_LINKED')
    expect(getTodoAppSessionsForProject(pid)).toHaveLength(1)
  })

  it('rejects a missing todo / missing session / project mismatch', () => {
    const pid = makeProject('P')
    const other = makeProject('Other')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    insertAppSession({ id: 'app-other', projectId: other, cwd: '/x', title: 't', repoOwner: null, repoName: null })

    expect(() => linkTodoSession(9999, 'app-1')).toThrow('TODO_NOT_FOUND')
    expect(() => linkTodoSession(todoId, 'nope')).toThrow('SESSION_NOT_FOUND')
    expect(() => linkTodoSession(todoId, 'app-other')).toThrow('PROJECT_MISMATCH')
  })

  it('rejects linking a null-project (unassigned) session to a todo', () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    // Soft-delete the project so insertAppSession pins no project → project_id NULL.
    const gone = makeProject('Gone')
    db.prepare("UPDATE projects SET deleted_at = datetime('now') WHERE id = ?").run(gone)
    const s = insertAppSession({ id: 'app-null', projectId: gone, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    expect(s.projectId).toBeNull()
    expect(() => linkTodoSession(todoId, 'app-null')).toThrow('PROJECT_MISMATCH')
  })

  it('does not surface a link whose todo is soft-deleted', () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 't', repoOwner: null, repoName: null })
    linkTodoSession(todoId, 'app-1')
    db.prepare("UPDATE project_todos SET deleted_at = datetime('now') WHERE id = ?").run(todoId)
    expect(getTodoAppSessionsForProject(pid)).toEqual([])
  })
})
