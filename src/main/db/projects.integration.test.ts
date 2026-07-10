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
  addAgentTodo,
  listInboxTodos,
  getProjectNameById,
  deleteTodo,
  restoreTodo,
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

  it('soft-deletes but keeps todos and links attached for restore', () => {
    const p = createProject('Parent')
    createTodo(p.id, 'Task')
    createLink(p.id, 'Link', 'https://example.com')
    deleteProject(p.id)

    // deleteProject is a soft delete: the project is tombstoned but its todos and
    // links stay attached so they come back if the project is restored.
    const todos = db
      .prepare('SELECT * FROM project_todos WHERE project_id = ?')
      .all(p.id)
    const links = db
      .prepare('SELECT * FROM project_links WHERE project_id = ?')
      .all(p.id)
    expect(todos).toHaveLength(1)
    expect(links).toHaveLength(1)
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

// ── addAgentTodo / listInboxTodos (#102) ──────────────────────────────────────

function base(overrides: Partial<Parameters<typeof addAgentTodo>[0]> = {}): Parameters<typeof addAgentTodo>[0] {
  return {
    resolvedProjectId: null,
    explicitPlacement: false,
    title: 'Approve PR',
    body: null,
    sourceUrl: null,
    suggestedAction: null,
    idempotencyKey: null,
    ...overrides,
  }
}

describe('addAgentTodo', () => {
  it('creates a copilot-origin todo on the resolved project', () => {
    const p = createProject('Alpha')
    const { todo, status } = addAgentTodo(base({ resolvedProjectId: p.id, title: 'Do it', body: 'details' }))
    expect(status).toBe('created')
    expect(todo.origin).toBe('copilot')
    expect(todo.projectId).toBe(p.id)
    expect(todo.text).toBe('Do it') // text mirrors the title for back-compat renderers
    expect(todo.title).toBe('Do it')
    expect(todo.body).toBe('details')
    expect(getProject(p.id).todos).toHaveLength(1)
  })

  it('lands in the Inbox (null project) when resolvedProjectId is null', () => {
    const { todo } = addAgentTodo(base({ title: 'Unrouted' }))
    expect(todo.projectId).toBeNull()
    expect(listInboxTodos().map((t) => t.id)).toContain(todo.id)
  })

  it('is idempotent on the key — a repeat updates instead of duplicating', () => {
    const p = createProject('Beta')
    const first = addAgentTodo(base({ resolvedProjectId: p.id, title: 'v1', idempotencyKey: 'k1' }))
    expect(first.status).toBe('created')
    const second = addAgentTodo(base({ resolvedProjectId: p.id, title: 'v2 refined', idempotencyKey: 'k1' }))
    expect(second.status).toBe('updated')
    expect(second.todo.id).toBe(first.todo.id)
    expect(second.todo.title).toBe('v2 refined')
    expect(getProject(p.id).todos).toHaveLength(1)
  })

  it('a null idempotency key always inserts (no dedup)', () => {
    const p = createProject('Gamma')
    addAgentTodo(base({ resolvedProjectId: p.id, title: 'a' }))
    addAgentTodo(base({ resolvedProjectId: p.id, title: 'b' }))
    expect(getProject(p.id).todos).toHaveLength(2)
  })

  it('stores and round-trips the suggested action', () => {
    const p = createProject('Delta')
    const action = { kind: 'pr_comment' as const, url: 'https://example.com/pr/1', comment: 'nice' }
    const { todo } = addAgentTodo(base({ resolvedProjectId: p.id, suggestedAction: action, sourceUrl: 'https://example.com/pr/1', idempotencyKey: 'k' }))
    expect(getProject(p.id).todos[0].suggestedAction).toEqual(action)
    expect(todo.sourceUrl).toBe('https://example.com/pr/1')
  })

  it('explicit placement MOVES an existing todo on the conflict', () => {
    const a = createProject('Home')
    const b = createProject('Elsewhere')
    const first = addAgentTodo(base({ resolvedProjectId: a.id, idempotencyKey: 'k1' }))
    const second = addAgentTodo(base({ resolvedProjectId: b.id, explicitPlacement: true, idempotencyKey: 'k1' }))
    expect(second.todo.id).toBe(first.todo.id)
    expect(second.todo.projectId).toBe(b.id)
  })

  it('non-explicit re-resolution leaves placement STICKY', () => {
    const a = createProject('Sticky')
    const b = createProject('Other')
    const first = addAgentTodo(base({ resolvedProjectId: a.id, idempotencyKey: 'k1' }))
    const second = addAgentTodo(base({ resolvedProjectId: b.id, explicitPlacement: false, idempotencyKey: 'k1' }))
    expect(second.todo.id).toBe(first.todo.id)
    expect(second.todo.projectId).toBe(a.id) // did not move
  })

  it('appends (recomputes sort_order) when a todo moves buckets', () => {
    const a = createProject('From')
    const b = createProject('To')
    // Fill B with two todos so its max sort_order is 1.
    createTodo(b.id, 'b0')
    createTodo(b.id, 'b1')
    const moved = addAgentTodo(base({ resolvedProjectId: a.id, idempotencyKey: 'k1' }))
    expect(moved.todo.sortOrder).toBe(0) // first in A
    const after = addAgentTodo(base({ resolvedProjectId: b.id, explicitPlacement: true, idempotencyKey: 'k1' }))
    expect(after.todo.projectId).toBe(b.id)
    expect(after.todo.sortOrder).toBe(2) // appended after B's 0 and 1, not left at 0
  })

  it('moves a todo off a now-soft-deleted project on a non-explicit update', () => {
    const dead = createProject('Dead')
    const first = addAgentTodo(base({ resolvedProjectId: dead.id, idempotencyKey: 'k1' }))
    deleteProject(dead.id) // soft-delete
    const second = addAgentTodo(base({ resolvedProjectId: null, explicitPlacement: false, idempotencyKey: 'k1' }))
    expect(second.todo.id).toBe(first.todo.id)
    expect(second.todo.projectId).toBeNull() // rehomed to the Inbox
  })

  it('preserves done + reports updated_completed on a re-propose', () => {
    const p = createProject('Complete')
    const created = addAgentTodo(base({ resolvedProjectId: p.id, idempotencyKey: 'c1' }))
    // Mark it done at the DB level via the same table the app uses.
    getDb().prepare('UPDATE project_todos SET done = 1 WHERE id = ?').run(created.todo.id)
    const again = addAgentTodo(base({ resolvedProjectId: p.id, title: 'still relevant', idempotencyKey: 'c1' }))
    expect(again.status).toBe('updated_completed')
    expect(again.todo.done).toBe(true) // stayed done
    expect(again.todo.title).toBe('still relevant') // content still refreshed
  })

  it('preserves deleted_at + reports updated_dismissed on a re-propose', () => {
    const p = createProject('Dismissed')
    const created = addAgentTodo(base({ resolvedProjectId: p.id, idempotencyKey: 'd1' }))
    deleteTodo(created.todo.id) // soft-delete = dismiss
    const again = addAgentTodo(base({ resolvedProjectId: p.id, idempotencyKey: 'd1' }))
    expect(again.status).toBe('updated_dismissed')
    // A restore brings the refreshed todo back.
    restoreTodo(created.todo.id)
    expect(getProject(p.id).todos.map((t) => t.id)).toContain(created.todo.id)
  })

  it('never touches a non-copilot todo that carries a stray idempotency_key', () => {
    const a = createProject('Guarded')
    getDb()
      .prepare("INSERT INTO project_todos (project_id, text, origin, idempotency_key) VALUES (?, 'user note', 'user', 'shared')")
      .run(a.id)
    // The lookup is origin-scoped, so this falls through to INSERT and the unique index rejects it.
    expect(() => addAgentTodo(base({ resolvedProjectId: a.id, idempotencyKey: 'shared', title: 'hijack' }))).toThrow()
    const row = getDb().prepare("SELECT text, origin FROM project_todos WHERE idempotency_key = 'shared'").get() as { text: string; origin: string }
    expect(row.text).toBe('user note') // untouched
    expect(row.origin).toBe('user')
  })
})

describe('listInboxTodos', () => {
  it('returns only project-less, non-deleted todos', () => {
    const p = createProject('WithTodos')
    createTodo(p.id, 'project todo')
    const inbox = addAgentTodo(base({ title: 'inbox todo' }))
    const dismissed = addAgentTodo(base({ title: 'dismissed', idempotencyKey: 'x' }))
    deleteTodo(dismissed.todo.id)
    const ids = listInboxTodos().map((t) => t.id)
    expect(ids).toContain(inbox.todo.id)
    expect(ids).not.toContain(dismissed.todo.id)
  })

  it('excludes non-copilot project-less todos (agent-todo surface only)', () => {
    getDb().prepare("INSERT INTO project_todos (project_id, text, origin) VALUES (NULL, 'stray user', 'user')").run()
    const agent = addAgentTodo(base({ title: 'agent inbox' }))
    expect(listInboxTodos().map((t) => t.id)).toContain(agent.todo.id)
    expect(listInboxTodos().every((t) => t.origin === 'copilot')).toBe(true)
  })
})

describe('getProjectNameById', () => {
  it('returns the name for a live project and null when missing', () => {
    const p = createProject('Named')
    expect(getProjectNameById(p.id)).toBe('Named')
    expect(getProjectNameById(999999)).toBeNull()
  })
})
