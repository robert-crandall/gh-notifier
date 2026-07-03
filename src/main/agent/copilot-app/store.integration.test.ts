import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db'
import { runMigrations } from '../../db/migrate'
import { insertAppSession, getAppSession, getAppSessionsForProject, updateAppSessionStatus } from './store'
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
