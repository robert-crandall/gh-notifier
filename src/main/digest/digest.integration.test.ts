import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Database as BunDb } from 'bun:sqlite'
import type BetterSQLite3 from 'better-sqlite3'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

vi.mock('../db', () => ({ getDb: vi.fn() }))

import { getDb } from '../db'
import { runMigrations } from '../db/migrate'
import { getDigest, markDigestSeen } from './index'

let db: BunDb

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

beforeEach(() => {
  db = new BunDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const betterDb = db as unknown as BetterSQLite3.Database
  runMigrations(betterDb)
  vi.mocked(getDb).mockReturnValue(betterDb)

  db.prepare("INSERT INTO projects (id, name, created_at, last_focused_at) VALUES (1, 'p', ?, ?)").run(
    isoDaysAgo(60),
    isoDaysAgo(5)
  )
})

describe('getDigest', () => {
  it('returns no items when nothing has changed', () => {
    const digest = getDigest(1)
    expect(digest.projectId).toBe(1)
    expect(digest.items).toEqual([])
    expect(typeof digest.asOf).toBe('string')
  })

  it('surfaces recent Copilot activity and notifications since the watermark', () => {
    db.prepare(
      `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at, linked_pr_url)
       VALUES ('s1', 1, 'github', 'pr_ready', 'backoff', ?, ?, 'https://x/pull/9')`
    ).run(isoDaysAgo(2), isoDaysAgo(1))
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url, html_url)
       VALUES ('n1', 1, 'o', 'r', 'Add jitter', 'PullRequest', 'review_requested', 1, ?, 'a', 'https://x/pull/1')`
    ).run(isoDaysAgo(1))
    db.prepare(
      `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url)
       VALUES ('n2', 1, 'o', 'r', 'CI failed', 'CheckSuite', 'ci_activity', 1, ?, 'b')`
    ).run(isoDaysAgo(1))

    const items = getDigest(1).items
    expect(items[0].kind).toBe('agent-pr-ready')
    expect(items.some((i) => i.kind === 'notification-review')).toBe(true)
    expect(items.some((i) => i.kind === 'notifications-grouped' && i.count === 1)).toBe(true)
  })

  it('excludes activity older than the recency floor', () => {
    db.prepare(
      `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at)
       VALUES ('old', 1, 'github', 'completed', 'ancient', ?, ?)`
    ).run(isoDaysAgo(40), isoDaysAgo(40))
    expect(getDigest(1).items).toEqual([])
  })

  it('excludes a soft-deleted project', () => {
    db.prepare('UPDATE projects SET deleted_at = ? WHERE id = 1').run(isoDaysAgo(0))
    expect(getDigest(1).items).toEqual([])
  })
})

describe('markDigestSeen', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at)
       VALUES ('s1', 1, 'github', 'completed', 'backoff', ?, ?)`
    ).run(isoDaysAgo(2), isoDaysAgo(1))
  })

  it('advances the watermark to asOf so the digest empties on the next read', () => {
    const before = getDigest(1)
    expect(before.items.length).toBeGreaterThan(0)

    markDigestSeen(1, before.asOf)

    expect(getDigest(1).items).toEqual([])
  })

  it('does not move the watermark backwards (older asOf is ignored)', () => {
    markDigestSeen(1, isoDaysAgo(30))
    // A 30-day-old asOf is before the 1-day-old activity, so the digest still shows it.
    expect(getDigest(1).items.length).toBeGreaterThan(0)
    const stored = db.prepare('SELECT digest_seen_at FROM projects WHERE id = 1').get() as {
      digest_seen_at: string | null
    }
    expect(stored.digest_seen_at).toBeNull()
  })
})
