/**
 * In-sandbox verification for the Focus MVP-A DB logic. Run with:  bun run scripts/verify-focus.ts
 *
 * Vitest can't run the bun:sqlite integration tests in this environment (it runs
 * under Node), so this bun script exercises the real migration SQL, the digest
 * query SQL, and the soft-delete/routing SQL against an in-memory DB, wired to
 * the real pure functions (computeDigestItems, classifyDrift). Not committed as
 * a test; a developer aid / evidence.
 */
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { computeDigestItems, type DigestNotificationRow, type DigestSessionRow } from '../src/main/digest/compute'
import { classifyDrift } from '../src/main/digest/classify'

let failures = 0
function check(name: string, cond: boolean): void {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}`)
  if (!cond) failures++
}

const db = new Database(':memory:')
db.exec('PRAGMA foreign_keys = ON')

// Apply migrations from disk (bypasses the electron-dependent runMigrations).
const migrationsDir = join(import.meta.dir, '..', 'db', 'migrations')
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  const stripped = sql.replace(/--[^\n]*/g, '').trim()
  if (stripped) db.exec(sql)
}

// ── Migration 013 columns exist ───────────────────────────────────────────────
const projectCols = (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name)
check('projects has last_focused_at', projectCols.includes('last_focused_at'))
check('projects has digest_seen_at', projectCols.includes('digest_seen_at'))
check('projects has drift_snoozed_until', projectCols.includes('drift_snoozed_until'))
check('projects has deleted_at', projectCols.includes('deleted_at'))
const todoCols = (db.prepare('PRAGMA table_info(project_todos)').all() as { name: string }[]).map((c) => c.name)
check('project_todos has deleted_at', todoCols.includes('deleted_at'))

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString()

// Seed a project. Backfill set last_focused_at; override for our scenarios.
db.prepare("INSERT INTO projects (id, name, created_at, last_focused_at) VALUES (1, 'sync-engine', ?, ?)").run(
  iso(60),
  iso(5) // last focused 5 days ago → should be drifting
)

// Copilot sessions: one recent (in window), one old (outside recency floor).
db.prepare(
  `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at, linked_pr_url)
   VALUES ('sess-new', 1, 'github', 'pr_ready', 'retry backoff', ?, ?, 'https://x/pull/9')`
).run(iso(2), iso(1))
db.prepare(
  `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at)
   VALUES ('sess-old', 1, 'github', 'completed', 'ancient task', ?, ?)`
).run(iso(40), iso(40))

// Notifications: two recent unread (one review-requested), one old.
db.prepare(
  `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url, html_url)
   VALUES ('nt-1', 1, 'o', 'r', 'Add jitter', 'PullRequest', 'review_requested', 1, ?, 'a', 'https://x/pull/1')`
).run(iso(1))
db.prepare(
  `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url)
   VALUES ('nt-2', 1, 'o', 'r', 'CI failed', 'CheckSuite', 'ci_activity', 1, ?, 'b')`
).run(iso(1))
db.prepare(
  `INSERT INTO notification_threads (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, api_url)
   VALUES ('nt-old', 1, 'o', 'r', 'stale', 'Issue', 'subscribed', 1, ?, 'c')`
).run(iso(40))

// ── Digest query SQL (mirrors queries.ts) ─────────────────────────────────────
const now = new Date()
const asOf = now.toISOString()
const recencyFloor = iso(14)
const proj = db.prepare('SELECT created_at, digest_seen_at FROM projects WHERE id = 1').get() as {
  created_at: string
  digest_seen_at: string | null
}
const watermark = proj.digest_seen_at ?? proj.created_at

const sessionRows = db
  .prepare(
    `SELECT id, status, title, html_url AS htmlUrl, linked_pr_url AS linkedPrUrl
     FROM copilot_sessions
     WHERE project_id = 1 AND julianday(updated_at) > julianday(?) AND julianday(updated_at) > julianday(?) AND julianday(updated_at) <= julianday(?)
     ORDER BY julianday(updated_at) DESC`
  )
  .all(watermark, recencyFloor, asOf) as DigestSessionRow[]
const notifRows = db
  .prepare(
    `SELECT id, type, reason, title, html_url AS htmlUrl
     FROM notification_threads
     WHERE project_id = 1 AND unread = 1 AND julianday(updated_at) > julianday(?) AND julianday(updated_at) > julianday(?) AND julianday(updated_at) <= julianday(?)
     ORDER BY julianday(updated_at) DESC`
  )
  .all(watermark, recencyFloor, asOf) as DigestNotificationRow[]

check('recency floor excludes the 40-day-old session', sessionRows.length === 1 && sessionRows[0].id === 'sess-new')
check('recency floor excludes the 40-day-old notification', notifRows.every((n) => n.id !== 'nt-old'))

const items = computeDigestItems({ sessions: sessionRows, notifications: notifRows })
check('digest surfaces the pr_ready session first', items[0]?.kind === 'agent-pr-ready')
check('digest surfaces the review-requested notification', items.some((i) => i.kind === 'notification-review'))
check('digest groups the remaining notification', items.some((i) => i.kind === 'notifications-grouped' && i.count === 1))

// Watermark bound: setting digest_seen_at to 12h ago hides the 1-day-old rows.
db.prepare('UPDATE projects SET digest_seen_at = ? WHERE id = 1').run(iso(0.5))
const proj2 = db.prepare('SELECT created_at, digest_seen_at FROM projects WHERE id = 1').get() as { created_at: string; digest_seen_at: string | null }
const watermark2 = proj2.digest_seen_at ?? proj2.created_at
const afterDismiss = db
  .prepare(
    `SELECT id FROM copilot_sessions WHERE project_id = 1 AND julianday(updated_at) > julianday(?) AND julianday(updated_at) > julianday(?) AND julianday(updated_at) <= julianday(?)`
  )
  .all(watermark2, recencyFloor, asOf) as { id: string }[]
check('advancing digest_seen_at empties the digest', afterDismiss.length === 0)

// Sub-second precision: activity 500ms after the watermark must still surface
// (regression guard for datetime() truncation).
const wm = new Date(Date.now() - 3600_000).toISOString()
db.prepare('UPDATE projects SET digest_seen_at = ? WHERE id = 1').run(wm)
db.prepare(
  `INSERT INTO copilot_sessions (id, project_id, source, status, title, started_at, updated_at)
   VALUES ('subsec', 1, 'github', 'completed', 'ms test', ?, ?)`
).run(wm, new Date(Date.parse(wm) + 500).toISOString())
const subsec = db
  .prepare(
    `SELECT id FROM copilot_sessions WHERE id = 'subsec' AND julianday(updated_at) > julianday(?)`
  )
  .all(wm) as { id: string }[]
check('sub-second activity after the watermark is not truncated away', subsec.length === 1)

// ── Drift classification (real pure fn) ───────────────────────────────────────
check(
  'a project focused 5 days ago is drifting',
  classifyDrift({ status: 'active', lastFocusedAt: iso(5), driftSnoozedUntil: null, createdAt: iso(60), now }) === 'drifting'
)

// ── Soft-delete semantics (mirrors deleteProject) ─────────────────────────────
const del = db.transaction(() => {
  db.prepare("UPDATE projects SET deleted_at = ? WHERE id = 1").run(asOf)
  db.prepare('UPDATE notification_threads SET project_id = NULL WHERE project_id = 1').run()
  db.prepare('UPDATE copilot_sessions SET project_id = NULL WHERE project_id = 1').run()
})
del()
const orphanNotifs = db.prepare('SELECT COUNT(*) AS c FROM notification_threads WHERE project_id = 1').get() as { c: number }
const inboxNotifs = db.prepare('SELECT COUNT(*) AS c FROM notification_threads WHERE project_id IS NULL').get() as { c: number }
check('deleting a project moves its notifications to the inbox', orphanNotifs.c === 0 && inboxNotifs.c === 3)
const liveProjects = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL').get() as { c: number }
check('soft-deleted project is excluded from live list', liveProjects.c === 0)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
