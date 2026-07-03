import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))
vi.mock('../../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db'
import { runMigrations } from '../../db/migrate'
import { mapRunningRows, refreshTodoAppSessionsForProject, type AppStatusRead } from './status'
import { insertAppSession, linkTodoSession, getAppSession } from './store'

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

function makeProject(name: string): number {
  return (db.prepare('INSERT INTO projects (name) VALUES (?) RETURNING id').get(name) as { id: number }).id
}
function makeTodo(projectId: number, text: string): number {
  return (
    db.prepare('INSERT INTO project_todos (project_id, text) VALUES (?, ?) RETURNING id').get(projectId, text) as {
      id: number
    }
  ).id
}

describe('mapRunningRows', () => {
  it('maps running/idle/absent correctly', () => {
    const m = mapRunningRows(['a', 'b', 'c'], [
      { id: 'a', is_running: 1 },
      { id: 'b', is_running: 0 },
    ])
    expect(m.get('a')).toBe('in_progress')
    expect(m.get('b')).toBe('waiting')
    expect(m.get('c')).toBe('unknown') // absent → unknown, NOT completed
  })
})

describe('refreshTodoAppSessionsForProject', () => {
  it('updates stored status from the reader and returns (todo, session) pairs', async () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 'do it', repoOwner: 'me', repoName: 'foo' })
    linkTodoSession(todoId, 'app-1')

    const reader = vi.fn(async (): Promise<AppStatusRead> => ({
      ok: true,
      statuses: new Map([['app-1', 'in_progress']]),
    }))
    const pairs = await refreshTodoAppSessionsForProject(pid, reader)

    expect(reader).toHaveBeenCalledWith(['app-1'])
    expect(pairs).toEqual([{ todoId, session: expect.objectContaining({ id: 'app-1', status: 'in_progress' }) }])
    expect(getAppSession('app-1')?.status).toBe('in_progress')
  })

  it('keeps the last-known status on a transient read failure', async () => {
    const pid = makeProject('P')
    const todoId = makeTodo(pid, 'do it')
    insertAppSession({ id: 'app-1', projectId: pid, cwd: '/x', title: 'do it', repoOwner: null, repoName: null })
    linkTodoSession(todoId, 'app-1') // stored status starts 'in_progress'

    const reader = vi.fn(async (): Promise<AppStatusRead> => ({ ok: false }))
    const pairs = await refreshTodoAppSessionsForProject(pid, reader)

    expect(pairs[0]?.session.status).toBe('in_progress') // unchanged
    expect(getAppSession('app-1')?.status).toBe('in_progress')
  })
})
