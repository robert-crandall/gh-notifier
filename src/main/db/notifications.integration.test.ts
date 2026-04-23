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
  upsertThreads,
  listThreadsByProject,
  listInboxThreads,
  getUnreadCounts,
  assignThread,
  markThreadRead,
  deleteThread,
  getThreadsNeedingPrefetch,
  updateThreadContent,
  invalidateOpenThreadPrefetch,
  type ThreadSyncData,
} from './notifications'
import { createProject, snoozeProject } from './projects'

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: BunDb

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeThread(overrides: Partial<ThreadSyncData> = {}): ThreadSyncData {
  return {
    id: 'thread-1',
    repoOwner: 'acme-corp',
    repoName: 'my-repo',
    title: 'Fix the bug',
    type: 'PullRequest',
    reason: 'mention',
    unread: true,
    updatedAt: '2024-01-01T00:00:00Z',
    lastReadAt: null,
    apiUrl: 'https://api.github.com/notifications/threads/1',
    subjectUrl: null,
    ...overrides,
  }
}

// ── upsertThreads ─────────────────────────────────────────────────────────────

describe('upsertThreads', () => {
  it('no-op on empty array', () => {
    expect(() => upsertThreads([])).not.toThrow()
    expect(listInboxThreads()).toHaveLength(0)
  })

  it('inserts new threads into the inbox when no repo rule exists', () => {
    upsertThreads([makeThread({ id: 't-1' }), makeThread({ id: 't-2' })])
    expect(listInboxThreads()).toHaveLength(2)
  })

  it('routes new threads to a project when a matching repo rule exists', () => {
    const p = createProject('Routed Project')
    db.prepare(
      `INSERT INTO repo_rules (repo_owner, repo_name, project_id) VALUES ('acme-corp', 'my-repo', ?)`
    ).run(p.id)

    upsertThreads([makeThread({ id: 't-1', repoOwner: 'acme-corp', repoName: 'my-repo' })])
    expect(listInboxThreads()).toHaveLength(0)
    expect(listThreadsByProject(p.id)).toHaveLength(1)
  })

  it('updates title, reason, unread, and updated_at on re-upsert', () => {
    upsertThreads([makeThread({ id: 't-1', unread: true, title: 'Original' })])
    upsertThreads([makeThread({ id: 't-1', unread: false, title: 'Updated', updatedAt: '2024-06-01T00:00:00Z' })])

    const threads = listInboxThreads()
    expect(threads).toHaveLength(1)
    expect(threads[0].title).toBe('Updated')
    expect(threads[0].unread).toBe(false)
    expect(threads[0].updatedAt).toBe('2024-06-01T00:00:00Z')
  })

  it('does not overwrite an existing project_id on re-upsert', () => {
    const p = createProject('Manual Project')
    upsertThreads([makeThread({ id: 't-1' })])
    // Manually assign to project
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-1'`).run(p.id)
    // Re-upsert — project_id must be preserved
    upsertThreads([makeThread({ id: 't-1', title: 'Changed' })])

    const threads = listThreadsByProject(p.id)
    expect(threads).toHaveLength(1)
    expect(listInboxThreads()).toHaveLength(0)
  })

  it('wakes a notification-triggered snoozed project when a new thread is routed to it', () => {
    const p = createProject('Waiting')
    snoozeProject(p.id, 'notification')

    db.prepare(
      `INSERT INTO repo_rules (repo_owner, repo_name, project_id) VALUES ('acme-corp', 'my-repo', ?)`
    ).run(p.id)

    upsertThreads([makeThread({ id: 't-new' })])

    const row = db.prepare('SELECT status FROM projects WHERE id = ?').get(p.id) as { status: string }
    expect(row.status).toBe('active')
  })
})

// ── listThreadsByProject ──────────────────────────────────────────────────────

describe('listThreadsByProject', () => {
  it('returns only threads assigned to that project', () => {
    const p1 = createProject('P1')
    const p2 = createProject('P2')
    upsertThreads([makeThread({ id: 't-1' }), makeThread({ id: 't-2' })])
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-1'`).run(p1.id)
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-2'`).run(p2.id)

    const p1Threads = listThreadsByProject(p1.id)
    expect(p1Threads).toHaveLength(1)
    expect(p1Threads[0].id).toBe('t-1')
  })

  it('excludes threads suppressed by a matching filter', () => {
    const p = createProject('P')
    upsertThreads([makeThread({ id: 't-1', type: 'PullRequest' })])
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-1'`).run(p.id)

    // Create a global filter that suppresses PullRequest threads
    db.prepare(
      `INSERT INTO filters (dimension, value, scope) VALUES ('type', 'PullRequest', 'global')`
    ).run()

    expect(listThreadsByProject(p.id)).toHaveLength(0)
  })
})

// ── listInboxThreads ──────────────────────────────────────────────────────────

describe('listInboxThreads', () => {
  it('returns only threads with project_id IS NULL', () => {
    const p = createProject('P')
    upsertThreads([makeThread({ id: 't-inbox' }), makeThread({ id: 't-project' })])
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-project'`).run(p.id)

    const inbox = listInboxThreads()
    expect(inbox).toHaveLength(1)
    expect(inbox[0].id).toBe('t-inbox')
  })

  it('excludes suppressed threads', () => {
    upsertThreads([makeThread({ id: 't-1', type: 'Issue' })])
    db.prepare(`INSERT INTO filters (dimension, value, scope) VALUES ('type', 'Issue', 'global')`).run()
    expect(listInboxThreads()).toHaveLength(0)
  })
})

// ── getUnreadCounts ───────────────────────────────────────────────────────────

describe('getUnreadCounts', () => {
  it('returns the correct unread count per project', () => {
    const p = createProject('Counted')
    upsertThreads([
      makeThread({ id: 't-1', unread: true }),
      makeThread({ id: 't-2', unread: true }),
      makeThread({ id: 't-3', unread: false }),
    ])
    db.prepare(`UPDATE notification_threads SET project_id = ?`).run(p.id)

    const counts = getUnreadCounts()
    const entry = counts.find((c) => c.projectId === p.id)!
    expect(entry.count).toBe(2)
  })

  it('does not include projects with no unread threads', () => {
    const p = createProject('No unread')
    upsertThreads([makeThread({ id: 't-read', unread: false })])
    db.prepare(`UPDATE notification_threads SET project_id = ?`).run(p.id)

    const counts = getUnreadCounts()
    expect(counts.find((c) => c.projectId === p.id)).toBeUndefined()
  })
})

// ── assignThread ──────────────────────────────────────────────────────────────

describe('assignThread', () => {
  it('assigns a thread to a project', () => {
    const p = createProject('Target')
    upsertThreads([makeThread({ id: 't-1' })])
    assignThread('t-1', p.id)
    expect(listThreadsByProject(p.id)).toHaveLength(1)
    expect(listInboxThreads()).toHaveLength(0)
  })

  it('moves a thread back to inbox when projectId is null', () => {
    const p = createProject('Target')
    upsertThreads([makeThread({ id: 't-1' })])
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-1'`).run(p.id)

    assignThread('t-1', null)
    expect(listInboxThreads()).toHaveLength(1)
    expect(listThreadsByProject(p.id)).toHaveLength(0)
  })

  it('returns a RepoRuleSuggestion (opt-in) when no other threads from the repo are mapped', () => {
    const p = createProject('P')
    upsertThreads([makeThread({ id: 't-1' })])
    const suggestion = assignThread('t-1', p.id)
    expect(suggestion).not.toBeNull()
    expect(suggestion?.type).toBe('opt-in')
    expect(suggestion?.repoOwner).toBe('acme-corp')
    expect(suggestion?.repoName).toBe('my-repo')
  })

  it('returns a RepoRuleSuggestion (opt-out) when all other threads from the repo go to the same project', () => {
    const p = createProject('P')
    upsertThreads([makeThread({ id: 't-1' }), makeThread({ id: 't-2' })])
    // Assign first thread to establish the pattern
    db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = 't-1'`).run(p.id)
    // Assign second thread via assignThread
    const suggestion = assignThread('t-2', p.id)
    expect(suggestion?.type).toBe('opt-out')
  })

  it('returns null when no matching thread exists', () => {
    expect(assignThread('nonexistent', 1)).toBeNull()
  })
})

// ── markThreadRead ────────────────────────────────────────────────────────────

describe('markThreadRead', () => {
  it('sets unread = false locally', () => {
    upsertThreads([makeThread({ id: 't-1', unread: true })])
    markThreadRead('t-1')
    const thread = listInboxThreads().find((t) => t.id === 't-1')
    // listInboxThreads filters by project_id IS NULL but also the thread should still be there
    const row = db
      .prepare('SELECT unread FROM notification_threads WHERE id = ?')
      .get('t-1') as { unread: number }
    expect(row.unread).toBe(0)
  })
})

// ── deleteThread ──────────────────────────────────────────────────────────────

describe('deleteThread', () => {
  it('removes the thread from the database', () => {
    upsertThreads([makeThread({ id: 't-1' })])
    deleteThread('t-1')
    const row = db
      .prepare('SELECT id FROM notification_threads WHERE id = ?')
      .get('t-1')
    expect(row).toBeFalsy()
  })
})

// ── getThreadsNeedingPrefetch ─────────────────────────────────────────────────

describe('getThreadsNeedingPrefetch', () => {
  it('returns threads where content_fetched_at is null and subject_url is set', () => {
    upsertThreads([makeThread({ id: 't-1', subjectUrl: 'https://api.github.com/repos/a/b/pulls/1' })])
    const candidates = getThreadsNeedingPrefetch()
    expect(candidates.map((c) => c.id)).toContain('t-1')
  })

  it('excludes threads with no subject_url', () => {
    upsertThreads([makeThread({ id: 't-no-url', subjectUrl: null })])
    const candidates = getThreadsNeedingPrefetch()
    expect(candidates.find((c) => c.id === 't-no-url')).toBeUndefined()
  })

  it('returns a thread when updated_at is newer than content_fetched_at', () => {
    upsertThreads([makeThread({ id: 't-1', subjectUrl: 'https://api.github.com/repos/a/b/pulls/1', updatedAt: '2024-01-01T00:00:00Z' })])
    // Simulate a completed prefetch with an older timestamp
    db.prepare(
      `UPDATE notification_threads SET content_fetched_at = '2023-01-01T00:00:00Z' WHERE id = 't-1'`
    ).run()
    const candidates = getThreadsNeedingPrefetch()
    expect(candidates.find((c) => c.id === 't-1')).toBeDefined()
  })

  it('excludes threads where content_fetched_at is current', () => {
    upsertThreads([makeThread({ id: 't-1', subjectUrl: 'https://api.github.com/repos/a/b/pulls/1', updatedAt: '2024-01-01T00:00:00Z' })])
    db.prepare(
      `UPDATE notification_threads SET content_fetched_at = '2025-01-01T00:00:00Z' WHERE id = 't-1'`
    ).run()
    const candidates = getThreadsNeedingPrefetch()
    expect(candidates.find((c) => c.id === 't-1')).toBeUndefined()
  })
})

// ── updateThreadContent ───────────────────────────────────────────────────────

describe('updateThreadContent', () => {
  it('sets subject_state, html_url, and content_fetched_at', () => {
    upsertThreads([makeThread({ id: 't-1' })])
    updateThreadContent('t-1', 'open', 'https://github.com/acme/repo/pull/1')

    const row = db
      .prepare('SELECT subject_state, html_url, content_fetched_at FROM notification_threads WHERE id = ?')
      .get('t-1') as { subject_state: string; html_url: string; content_fetched_at: string }

    expect(row.subject_state).toBe('open')
    expect(row.html_url).toBe('https://github.com/acme/repo/pull/1')
    expect(row.content_fetched_at).not.toBeNull()
  })
})

// ── invalidateOpenThreadPrefetch ──────────────────────────────────────────────

describe('invalidateOpenThreadPrefetch', () => {
  it('resets content_fetched_at for threads with subject_state = "open"', () => {
    upsertThreads([makeThread({ id: 't-open' })])
    db.prepare(
      `UPDATE notification_threads SET subject_state = 'open', content_fetched_at = datetime('now') WHERE id = 't-open'`
    ).run()

    invalidateOpenThreadPrefetch()

    const row = db
      .prepare('SELECT content_fetched_at FROM notification_threads WHERE id = ?')
      .get('t-open') as { content_fetched_at: string | null }
    expect(row.content_fetched_at).toBeNull()
  })

  it('resets content_fetched_at for threads with subject_state IS NULL', () => {
    upsertThreads([makeThread({ id: 't-null-state' })])
    db.prepare(
      `UPDATE notification_threads SET subject_state = NULL, content_fetched_at = datetime('now') WHERE id = 't-null-state'`
    ).run()

    invalidateOpenThreadPrefetch()

    const row = db
      .prepare('SELECT content_fetched_at FROM notification_threads WHERE id = ?')
      .get('t-null-state') as { content_fetched_at: string | null }
    expect(row.content_fetched_at).toBeNull()
  })

  it('does not reset content_fetched_at for closed or merged threads', () => {
    upsertThreads([makeThread({ id: 't-closed' })])
    const ts = '2024-06-01T00:00:00Z'
    db.prepare(
      `UPDATE notification_threads SET subject_state = 'closed', content_fetched_at = ? WHERE id = 't-closed'`
    ).run(ts)

    invalidateOpenThreadPrefetch()

    const row = db
      .prepare('SELECT content_fetched_at FROM notification_threads WHERE id = ?')
      .get('t-closed') as { content_fetched_at: string | null }
    expect(row.content_fetched_at).toBe(ts)
  })
})
