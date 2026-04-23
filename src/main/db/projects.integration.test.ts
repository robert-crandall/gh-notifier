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
  updateProject,
  deleteProject,
  snoozeProject,
  wakeExpiredSnoozes,
  createTodo,
  createLink,
} from './projects'

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

// ── createProject ─────────────────────────────────────────────────────────────

describe('createProject', () => {
  it('returns a project with the given name', () => {
    const p = createProject('Alpha')
    expect(p.name).toBe('Alpha')
  })

  it('status defaults to "active"', () => {
    const p = createProject('Alpha')
    expect(p.status).toBe('active')
  })

  it('sort_order auto-increments across multiple projects', () => {
    const p1 = createProject('First')
    const p2 = createProject('Second')
    const p3 = createProject('Third')
    expect(p2.sortOrder).toBeGreaterThan(p1.sortOrder)
    expect(p3.sortOrder).toBeGreaterThan(p2.sortOrder)
  })
})

// ── listProjects ──────────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('returns projects ordered by sort_order', () => {
    createProject('First')
    createProject('Second')
    createProject('Third')
    const list = listProjects()
    const orders = list.map((p) => p.sortOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('includes unreadCount from joined threads', () => {
    const p = createProject('With threads')
    // Insert two unread threads directly
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url, synced_at)
       VALUES (?, ?, 'org', 'repo', 'Title', 'PullRequest', 'mention', 1, datetime('now'), 'https://api', datetime('now'))`
    ).run('t-1', p.id)
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url, synced_at)
       VALUES (?, ?, 'org', 'repo', 'Title', 'PullRequest', 'mention', 1, datetime('now'), 'https://api', datetime('now'))`
    ).run('t-2', p.id)

    const project = listProjects().find((x) => x.id === p.id)!
    expect(project.unreadCount).toBe(2)
  })

  it('returns 0 unreadCount for a project with no threads', () => {
    const p = createProject('Empty')
    const project = listProjects().find((x) => x.id === p.id)!
    expect(project.unreadCount).toBe(0)
  })
})

// ── getProject ────────────────────────────────────────────────────────────────

describe('getProject', () => {
  it('returns a ProjectDetail with todos and links arrays', () => {
    const p = createProject('Detail')
    createTodo(p.id, 'Do a thing')
    createLink(p.id, 'Docs', 'https://example.com')

    const detail = getProject(p.id)
    expect(detail.todos).toHaveLength(1)
    expect(detail.todos[0].text).toBe('Do a thing')
    expect(detail.links).toHaveLength(1)
    expect(detail.links[0].label).toBe('Docs')
  })

  it('throws when the project does not exist', () => {
    expect(() => getProject(999)).toThrow()
  })
})

// ── updateProject ─────────────────────────────────────────────────────────────

describe('updateProject', () => {
  it('updates the project name', () => {
    const p = createProject('Old Name')
    const updated = updateProject(p.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
  })

  it('changes updated_at', () => {
    const p = createProject('Timestamps')
    // Force original updated_at to something in the past
    db.prepare(`UPDATE projects SET updated_at = '2020-01-01T00:00:00' WHERE id = ?`).run(p.id)
    const updated = updateProject(p.id, { name: 'Renamed' })
    expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00')
  })

  it('clears snooze fields when status is patched to "active"', () => {
    const p = createProject('Will snooze')
    snoozeProject(p.id, 'manual')
    const woken = updateProject(p.id, { status: 'active' })
    expect(woken.status).toBe('active')
    expect(woken.snoozeMode).toBeNull()
    expect(woken.snoozeUntil).toBeNull()
  })
})

// ── deleteProject ─────────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('removes the project', () => {
    const p = createProject('Doomed')
    deleteProject(p.id)
    expect(() => getProject(p.id)).toThrow()
  })

  it('CASCADE deletes associated todos and links', () => {
    const p = createProject('Parent')
    createTodo(p.id, 'Task')
    createLink(p.id, 'Link', 'https://example.com')
    deleteProject(p.id)

    const todos = db
      .prepare('SELECT * FROM project_todos WHERE project_id = ?')
      .all(p.id)
    const links = db
      .prepare('SELECT * FROM project_links WHERE project_id = ?')
      .all(p.id)
    expect(todos).toHaveLength(0)
    expect(links).toHaveLength(0)
  })
})

// ── snoozeProject ─────────────────────────────────────────────────────────────

describe('snoozeProject', () => {
  it('manual mode: sets status=snoozed, snooze_mode=manual, snooze_until=null', () => {
    const p = createProject('Manual snooze')
    const snoozed = snoozeProject(p.id, 'manual')
    expect(snoozed.status).toBe('snoozed')
    expect(snoozed.snoozeMode).toBe('manual')
    expect(snoozed.snoozeUntil).toBeNull()
  })

  it('date mode: sets snooze_until to the provided ISO string', () => {
    const p = createProject('Date snooze')
    const until = '2099-12-31T00:00:00Z'
    const snoozed = snoozeProject(p.id, 'date', until)
    expect(snoozed.snoozeMode).toBe('date')
    expect(snoozed.snoozeUntil).toBe(until)
  })

  it('notification mode: sets snooze_mode=notification, snooze_until=null', () => {
    const p = createProject('Notif snooze')
    const snoozed = snoozeProject(p.id, 'notification')
    expect(snoozed.snoozeMode).toBe('notification')
    expect(snoozed.snoozeUntil).toBeNull()
  })

  it('throws when mode is "date" but until is omitted', () => {
    const p = createProject('Bad snooze')
    expect(() => snoozeProject(p.id, 'date')).toThrow()
  })
})

// ── wakeExpiredSnoozes ────────────────────────────────────────────────────────

describe('wakeExpiredSnoozes', () => {
  it('wakes a date-based project whose snooze_until is in the past', () => {
    const p = createProject('Expired')
    snoozeProject(p.id, 'date', '2020-01-01T00:00:00Z')
    const woken = wakeExpiredSnoozes()
    expect(woken).toContain(p.id)
    expect(getProject(p.id).status).toBe('active')
  })

  it('does not wake a date-based project whose snooze_until is in the future', () => {
    const p = createProject('Future')
    snoozeProject(p.id, 'date', '2099-01-01T00:00:00Z')
    const woken = wakeExpiredSnoozes()
    expect(woken).not.toContain(p.id)
    expect(getProject(p.id).status).toBe('snoozed')
  })

  it('does not wake manually-snoozed projects', () => {
    const p = createProject('Manual')
    snoozeProject(p.id, 'manual')
    wakeExpiredSnoozes()
    expect(getProject(p.id).status).toBe('snoozed')
  })

  it('does not wake notification-triggered snoozed projects', () => {
    const p = createProject('Notif')
    snoozeProject(p.id, 'notification')
    wakeExpiredSnoozes()
    expect(getProject(p.id).status).toBe('snoozed')
  })
})
