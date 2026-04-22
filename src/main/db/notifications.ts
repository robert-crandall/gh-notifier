import type {
  NotificationThread,
  NotificationType,
  RepoRule,
  RepoRuleSuggestion,
  UnreadCount,
} from '../../shared/ipc-channels'
import { getDb } from './index'

// ── Row types (SQLite returns snake_case column names) ────────────────────────

interface ThreadRow {
  id: string
  project_id: number | null
  repo_owner: string
  repo_name: string
  title: string
  type: string
  reason: string
  unread: number
  updated_at: string
  last_read_at: string | null
  api_url: string
  synced_at: string
  subject_url: string | null
  subject_state: string | null
  html_url: string | null
  content_fetched_at: string | null
}

interface RepoRuleRow {
  id: number
  repo_owner: string
  repo_name: string
  project_id: number
  created_at: string
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

function toThread(row: ThreadRow): NotificationThread {
  return {
    id: row.id,
    projectId: row.project_id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    title: row.title,
    type: row.type as NotificationType,
    reason: row.reason,
    unread: row.unread === 1,
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at,
    apiUrl: row.api_url,
    subjectUrl: row.subject_url,
    subjectState: row.subject_state,
    htmlUrl: row.html_url,
  }
}

function toRepoRule(row: RepoRuleRow): RepoRule {
  return {
    id: row.id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    projectId: row.project_id,
    createdAt: row.created_at,
  }
}

// ── Notification threads ──────────────────────────────────────────────────────

export function listThreadsByProject(projectId: number): NotificationThread[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notification_threads
       WHERE project_id = ?
       ORDER BY updated_at DESC`
    )
    .all(projectId) as ThreadRow[]
  return rows.map(toThread)
}

export function listInboxThreads(): NotificationThread[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notification_threads
       WHERE project_id IS NULL
       ORDER BY updated_at DESC`
    )
    .all() as ThreadRow[]
  return rows.map(toThread)
}

export function getUnreadCounts(): UnreadCount[] {
  const rows = getDb()
    .prepare(
      `SELECT project_id AS projectId, COUNT(*) AS count
       FROM notification_threads
       WHERE unread = 1 AND project_id IS NOT NULL
       GROUP BY project_id`
    )
    .all() as { projectId: number; count: number }[]
  return rows
}

/** Shape of sync data passed in from the GitHub Notifications API response. */
export interface ThreadSyncData {
  id: string
  repoOwner: string
  repoName: string
  title: string
  type: NotificationType
  reason: string
  unread: boolean
  updatedAt: string
  lastReadAt: string | null
  apiUrl: string
  /** GitHub API URL for the PR/Issue subject (n.subject.url). */
  subjectUrl: string | null
}

/**
 * Upserts a batch of notification threads from GitHub sync.
 * Applies repo-level routing rules if no project is explicitly assigned.
 */
export function upsertThreads(threads: ThreadSyncData[]): void {
  const db = getDb()

  const upsert = db.prepare(`
    INSERT INTO notification_threads
      (id, project_id, repo_owner, repo_name, title, type, reason, unread, updated_at, last_read_at, api_url, subject_url, synced_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title        = excluded.title,
      reason       = excluded.reason,
      unread       = excluded.unread,
      updated_at   = excluded.updated_at,
      last_read_at = excluded.last_read_at,
      subject_url  = COALESCE(notification_threads.subject_url, excluded.subject_url),
      synced_at    = datetime('now')
    -- subject_state/html_url/content_fetched_at are managed by prefetchThreadContent only.
  `)

  const getRule = db.prepare(
    `SELECT project_id FROM repo_rules WHERE repo_owner = ? AND repo_name = ?`
  ) as { get: (owner: string, name: string) => { project_id: number } | undefined }

  const getExisting = db.prepare(
    `SELECT project_id FROM notification_threads WHERE id = ?`
  ) as { get: (id: string) => { project_id: number | null } | undefined }

  const runAll = db.transaction(() => {
    for (const t of threads) {
      // Preserve existing project assignment if already set; otherwise apply repo rule
      const existing = getExisting.get(t.id)
      let projectId: number | null = existing?.project_id ?? null
      if (projectId === null) {
        const rule = getRule.get(t.repoOwner, t.repoName)
        projectId = rule?.project_id ?? null
      }

      upsert.run(
        t.id,
        projectId,
        t.repoOwner,
        t.repoName,
        t.title,
        t.type,
        t.reason,
        t.unread ? 1 : 0,
        t.updatedAt,
        t.lastReadAt,
        t.apiUrl,
        t.subjectUrl
      )
    }
  })

  runAll()
}

/** Assigns a thread to a project (or null for inbox). Returns a repo rule suggestion if applicable. */
export function assignThread(
  threadId: string,
  projectId: number | null
): RepoRuleSuggestion | null {
  const db = getDb()

  const thread = db
    .prepare(`SELECT * FROM notification_threads WHERE id = ?`)
    .get(threadId) as ThreadRow | undefined
  if (!thread) return null

  db.prepare(`UPDATE notification_threads SET project_id = ? WHERE id = ?`).run(
    projectId,
    threadId
  )

  // Only suggest a repo rule when assigning to a project (not moving to inbox)
  if (projectId === null) return null

  // Check if a rule already exists for this repo
  const existingRule = db
    .prepare(`SELECT * FROM repo_rules WHERE repo_owner = ? AND repo_name = ?`)
    .get(thread.repo_owner, thread.repo_name) as RepoRuleRow | undefined
  if (existingRule) return null

  // Count all threads from this repo and how they're distributed
  const allThreads = db
    .prepare(
      `SELECT project_id FROM notification_threads WHERE repo_owner = ? AND repo_name = ?`
    )
    .all(thread.repo_owner, thread.repo_name) as { project_id: number | null }[]

  const mapped = allThreads.filter((t) => t.project_id !== null)
  const uniqueProjects = new Set(mapped.map((t) => t.project_id))

  const project = db
    .prepare(`SELECT name FROM projects WHERE id = ?`)
    .get(projectId) as { name: string } | undefined

  const projectName = project?.name ?? ''

  if (mapped.length === 0) {
    // No other mapped threads from this repo → opt-in suggestion
    return {
      type: 'opt-in',
      repoOwner: thread.repo_owner,
      repoName: thread.repo_name,
      projectId,
      projectName,
    }
  }

  if (uniqueProjects.size === 1 && uniqueProjects.has(projectId)) {
    // All other threads already go to the same project → opt-out (pre-checked)
    return {
      type: 'opt-out',
      repoOwner: thread.repo_owner,
      repoName: thread.repo_name,
      projectId,
      projectName,
    }
  }

  // Threads split across multiple projects → no suggestion
  return null
}

/** Marks a thread as read locally. */
export function markThreadRead(threadId: string): void {
  getDb()
    .prepare(
      `UPDATE notification_threads SET unread = 0, last_read_at = datetime('now') WHERE id = ?`
    )
    .run(threadId)
}

/** Removes a thread from local storage (called after unsubscribe). */
export function deleteThread(threadId: string): void {
  getDb()
    .prepare(`DELETE FROM notification_threads WHERE id = ?`)
    .run(threadId)
}

/**
 * Removes all locally-read threads. Called after each sync: if GitHub had new
 * activity on a thread, the upsert would have flipped it back to unread=1
 * before this runs, so it's safe to discard anything still read.
 */
export function deleteReadThreads(): void {
  getDb()
    .prepare(`DELETE FROM notification_threads WHERE unread = 0`)
    .run()
}

// ── Repo rules ────────────────────────────────────────────────────────────────

export function listRepoRules(): RepoRule[] {
  const rows = getDb()
    .prepare(`SELECT * FROM repo_rules ORDER BY repo_owner ASC, repo_name ASC`)
    .all() as RepoRuleRow[]
  return rows.map(toRepoRule)
}

export function createRepoRule(
  repoOwner: string,
  repoName: string,
  projectId: number
): RepoRule {
  const row = getDb()
    .prepare(
      `INSERT INTO repo_rules (repo_owner, repo_name, project_id)
       VALUES (?, ?, ?)
       ON CONFLICT(repo_owner, repo_name) DO UPDATE SET project_id = excluded.project_id
       RETURNING *`
    )
    .get(repoOwner, repoName, projectId) as RepoRuleRow
  return toRepoRule(row)
}

export function deleteRepoRule(id: number): void {
  getDb().prepare(`DELETE FROM repo_rules WHERE id = ?`).run(id)
}

// ── Content prefetch helpers (M5) ─────────────────────────────────────────────

/** Minimal shape returned by getThreadsNeedingPrefetch. */
export interface PrefetchCandidate {
  id: string
  subjectUrl: string
  type: NotificationType
}

/**
 * Clears content_fetched_at for all threads whose subject_state is 'open' or
 * not yet determined (NULL). Called before a manual sync so that prefetch
 * re-verifies the current state of every open thread rather than assuming
 * the cached state is still current.
 */
export function invalidateOpenThreadPrefetch(): void {
  getDb()
    .prepare(
      `UPDATE notification_threads
       SET content_fetched_at = NULL
       WHERE subject_state IS NULL OR subject_state = 'open'`
    )
    .run()
}

/**
 * Returns threads whose content has never been fetched, or whose updated_at
 * is newer than the last fetch (meaning a new notification arrived on the thread).
 * Only returns threads that have a subject_url to fetch from.
 */
export function getThreadsNeedingPrefetch(): PrefetchCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT id, subject_url AS subjectUrl, type
       FROM notification_threads
       WHERE subject_url IS NOT NULL
         AND (content_fetched_at IS NULL OR updated_at > content_fetched_at)`
    )
    .all() as PrefetchCandidate[]
  return rows
}

/**
 * Records the result of a successful content prefetch for a thread.
 * Sets subject_state, html_url, and content_fetched_at.
 */
export function updateThreadContent(
  threadId: string,
  subjectState: string,
  htmlUrl: string
): void {
  getDb()
    .prepare(
      `UPDATE notification_threads
       SET subject_state = ?, html_url = ?, content_fetched_at = datetime('now')
       WHERE id = ?`
    )
    .run(subjectState, htmlUrl, threadId)
}
