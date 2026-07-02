import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('./index', () => ({ getDb: vi.fn() }))

import { getDb } from './index'
import { runMigrations } from './migrate'
import {
  createProject,
  listProjects,
  getProject,
  deleteProject,
  restoreProject,
  createTodo,
  deleteTodo,
  restoreTodo,
} from './projects'
import { createRepoRule, upsertThreads, type ThreadSyncData } from './notifications'

let db: BunDb

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

function makeThread(overrides: Partial<ThreadSyncData> = {}): ThreadSyncData {
  return {
    id: 'thread-1',
    repoOwner: 'acme',
    repoName: 'repo',
    title: 'A PR',
    type: 'PullRequest',
    reason: 'mention',
    unread: true,
    updatedAt: isoDaysAgo(1),
    lastReadAt: null,
    apiUrl: 'https://api/threads/1',
    subjectUrl: null,
    ...overrides,
  }
}

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

describe('project soft-delete', () => {
  it('hides a deleted project from listProjects and getProject', () => {
    const project = createProject('P')
    deleteProject(project.id)

    expect(listProjects().find((p) => p.id === project.id)).toBeUndefined()
    expect(() => getProject(project.id)).toThrow()
  })

  it('returns the deleted project\u2019s unread notifications to the Inbox', () => {
    const project = createProject('P')
    createRepoRule('acme', 'repo', project.id)
    upsertThreads([makeThread()])
    // Sanity: routed to the project.
    expect(
      (db.prepare('SELECT project_id FROM notification_threads WHERE id = ?').get('thread-1') as { project_id: number | null })
        .project_id
    ).toBe(project.id)

    deleteProject(project.id)

    const row = db.prepare('SELECT project_id FROM notification_threads WHERE id = ?').get('thread-1') as {
      project_id: number | null
    }
    expect(row.project_id).toBeNull()
  })

  it('does not re-route threads to a soft-deleted project on the next sync', () => {
    const project = createProject('P')
    createRepoRule('acme', 'repo', project.id)
    deleteProject(project.id)

    upsertThreads([makeThread({ id: 'thread-2' })])

    const row = db.prepare('SELECT project_id FROM notification_threads WHERE id = ?').get('thread-2') as {
      project_id: number | null
    }
    expect(row.project_id).toBeNull()
  })

  it('restores a soft-deleted project', () => {
    const project = createProject('P')
    deleteProject(project.id)
    restoreProject(project.id)

    expect(listProjects().find((p) => p.id === project.id)).toBeDefined()
  })
})

describe('todo soft-delete', () => {
  it('hides a deleted todo but keeps it restorable', () => {
    const project = createProject('P')
    const todo = createTodo(project.id, 'Do the thing')

    deleteTodo(todo.id)
    expect(getProject(project.id).todos.find((t) => t.id === todo.id)).toBeUndefined()

    restoreTodo(todo.id)
    expect(getProject(project.id).todos.find((t) => t.id === todo.id)).toBeDefined()
  })
})

describe('drift classification via listProjects', () => {
  it('classifies projects as active, drifting, or parked', () => {
    const fresh = createProject('fresh') // last_focused_at = now
    const stale = createProject('stale')
    const parked = createProject('parked')

    db.prepare('UPDATE projects SET last_focused_at = ? WHERE id = ?').run(isoDaysAgo(10), stale.id)
    db.prepare("UPDATE projects SET status = 'snoozed', snooze_mode = 'manual' WHERE id = ?").run(parked.id)

    const byId = new Map(listProjects().map((p) => [p.id, p.driftState]))
    expect(byId.get(fresh.id)).toBe('active')
    expect(byId.get(stale.id)).toBe('drifting')
    expect(byId.get(parked.id)).toBe('parked')
  })

  it('does not drift a stale project while within its resurface cooldown', () => {
    const stale = createProject('stale')
    db.prepare('UPDATE projects SET last_focused_at = ?, drift_snoozed_until = ? WHERE id = ?').run(
      isoDaysAgo(10),
      isoDaysAgo(-2), // cooldown ends 2 days in the future
      stale.id
    )
    const project = listProjects().find((p) => p.id === stale.id)
    expect(project?.driftState).toBe('active')
  })
})
