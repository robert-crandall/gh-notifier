/**
 * Copilot session DB accessors.
 *
 * All operations are synchronous (better-sqlite3) and run in the main process.
 */

import { getDb } from '../db'
import type { CopilotSession, CopilotSessionStatus, RepoRuleSuggestion } from '../../shared/ipc-channels'

interface CopilotSessionRow {
  id: string
  project_id: number | null
  source: string
  status: string
  title: string
  html_url: string | null
  started_at: string
  updated_at: string
  repo_owner: string | null
  repo_name: string | null
  branch: string | null
  linked_pr_url: string | null
  pinned_project_id: number | null
  synced_at: string
}

function toSession(row: CopilotSessionRow): CopilotSession {
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source as CopilotSession['source'],
    status: row.status as CopilotSessionStatus,
    title: row.title,
    htmlUrl: row.html_url,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    branch: row.branch,
    linkedPrUrl: row.linked_pr_url,
    pinnedProjectId: row.pinned_project_id,
  }
}

/**
 * Upserts a batch of sessions from a `gh agent-task list` sync.
 *
 * On conflict this preserves the sticky `pinned_project_id` (owned by launch /
 * manual assignment, never by the sync) while it points at a live project, and
 * prefers it over the freshly-resolved `project_id`. A pin whose project is gone
 * (soft-deleted) is cleared so a later restore can't make the session snap back.
 * All volatile fields are updated to GitHub truth. New rows keep
 * `pinned_project_id` NULL (its default).
 */
export function upsertSessions(sessions: CopilotSession[]): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO copilot_sessions
      (id, project_id, source, status, title, html_url, started_at, updated_at,
       repo_owner, repo_name, branch, linked_pr_url, synced_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      pinned_project_id = CASE
        WHEN copilot_sessions.pinned_project_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM projects p
           WHERE p.id = copilot_sessions.pinned_project_id AND p.deleted_at IS NULL
         )
        THEN copilot_sessions.pinned_project_id
        ELSE NULL
      END,
      project_id = CASE
        WHEN copilot_sessions.pinned_project_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM projects p
           WHERE p.id = copilot_sessions.pinned_project_id AND p.deleted_at IS NULL
         )
        THEN copilot_sessions.pinned_project_id
        ELSE excluded.project_id
      END,
      source        = excluded.source,
      status        = excluded.status,
      title         = excluded.title,
      html_url      = excluded.html_url,
      started_at    = excluded.started_at,
      updated_at    = excluded.updated_at,
      repo_owner    = excluded.repo_owner,
      repo_name     = excluded.repo_name,
      branch        = excluded.branch,
      linked_pr_url = excluded.linked_pr_url,
      synced_at     = datetime('now')
  `)
  const insertMany = db.transaction((rows: CopilotSession[]) => {
    for (const s of rows) {
      stmt.run(
        s.id,
        s.projectId,
        s.source,
        s.status,
        s.title,
        s.htmlUrl,
        s.startedAt,
        s.updatedAt,
        s.repoOwner,
        s.repoName,
        s.branch,
        s.linkedPrUrl,
      )
    }
  })
  insertMany(sessions)
}

export interface LaunchedSessionInput {
  id: string
  title: string
  repoOwner: string
  repoName: string
  htmlUrl: string | null
  linkedPrUrl: string | null
  /** Originating project to pin (null = launched against a repo with no project). */
  projectId: number | null
}

/**
 * Optimistically records a just-launched agent task so the rail/digest light up
 * before the next `gh agent-task list` sync. Status starts `in_progress`.
 *
 * Only a *live* project is pinned/pointed at: if the originating project vanished
 * mid-launch (or is soft-deleted), the task is tracked as unassigned instead —
 * so a successful remote launch is never lost to an FK failure or an invisible
 * row pointing at a dead project.
 *
 * This is an UPSERT: if a sync already created the row (race), we only set the
 * pin + effective project_id and do NOT clobber the already-synced
 * status/title/timestamps. Returns the resulting row.
 */
export function insertLaunchedSession(input: LaunchedSessionInput): CopilotSession {
  const db = getDb()
  const now = new Date().toISOString()
  const projectIsLive =
    input.projectId !== null &&
    db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(input.projectId) != null
  const pin = projectIsLive ? input.projectId : null
  db.prepare(`
    INSERT INTO copilot_sessions
      (id, project_id, source, status, title, html_url, started_at, updated_at,
       repo_owner, repo_name, branch, linked_pr_url, pinned_project_id, synced_at)
    VALUES
      (?, ?, 'github', 'in_progress', ?, ?, ?, ?, ?, ?, NULL, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      pinned_project_id = excluded.pinned_project_id,
      project_id = CASE
        WHEN excluded.pinned_project_id IS NOT NULL
        THEN excluded.pinned_project_id
        ELSE copilot_sessions.project_id
      END
  `).run(
    input.id,
    pin,
    input.title,
    input.htmlUrl,
    now,
    now,
    input.repoOwner,
    input.repoName,
    input.linkedPrUrl,
    pin,
  )

  const row = db.prepare('SELECT * FROM copilot_sessions WHERE id = ?').get(input.id) as CopilotSessionRow
  return toSession(row)
}

/** Returns all sessions linked to a project, ordered by updated_at desc. */
export function getSessionsForProject(projectId: number): CopilotSession[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM copilot_sessions
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `)
    .all(projectId) as CopilotSessionRow[]
  return rows.map(toSession)
}

/**
 * Returns unassigned sessions (project_id IS NULL) for the Agent Tasks surface.
 * Active sessions sort first (so a burst of completed ones can't push active
 * orphaned work out of the cap), then newest first. Includes recently-completed
 * sessions so a task that finishes before it's assigned doesn't vanish.
 */
export function getUnassignedSessions(limit = 50): CopilotSession[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM copilot_sessions
      WHERE project_id IS NULL
      ORDER BY (status = 'completed') ASC, julianday(updated_at) DESC
      LIMIT ?
    `)
    .all(limit) as CopilotSessionRow[]
  return rows.map(toSession)
}

/** Count of active (non-completed) unassigned sessions, for the rail badge. */
export function getUnassignedActiveCount(): number {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS cnt FROM copilot_sessions
      WHERE project_id IS NULL AND status != 'completed'
    `)
    .get() as { cnt: number }
  return row.cnt
}

/**
 * Pins an unassigned session to a live project (sticky across syncs).
 * Throws when the project is missing/soft-deleted or the session doesn't exist.
 */
export function assignSession(sessionId: string, projectId: number): void {
  const db = getDb()
  const project = db
    .prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId)
  if (project === undefined || project === null) throw new Error('PROJECT_NOT_FOUND')

  const result = db
    .prepare('UPDATE copilot_sessions SET project_id = ?, pinned_project_id = ? WHERE id = ?')
    .run(projectId, projectId, sessionId)
  if (result.changes === 0) throw new Error('SESSION_NOT_FOUND')
}

/**
 * After an unassigned session is assigned to a project, offer to remember the
 * repo → project mapping so future sessions in that repo auto-assign at sync time
 * (the "Assign to project + remember this repo" affordance). Mirrors the Inbox's
 * repo-rule suggestion: always an `opt-in` for cloud sessions (there is no
 * other-threads signal to compute opt-out from).
 *
 * Returns null when:
 *   - the session is missing or carries no repo (nothing to remember), or
 *   - a repo rule already exists whose project is LIVE. A rule pointing at a
 *     soft-deleted project is treated as no effective mapping (resolveProjectId
 *     skips dead-project rules, which is why the session was unassigned), so the
 *     suggestion still fires and `createRepoRule`'s UPSERT can repair the stale row.
 *
 * Uses exact-case repo matching, consistent with resolveProjectId step 2 and
 * createRepoRule.
 */
export function getRepoRuleSuggestionForSession(
  sessionId: string,
  projectId: number
): RepoRuleSuggestion | null {
  const db = getDb()

  const session = db
    .prepare('SELECT repo_owner, repo_name FROM copilot_sessions WHERE id = ?')
    .get(sessionId) as { repo_owner: string | null; repo_name: string | null } | undefined
  if (!session || !session.repo_owner || !session.repo_name) return null

  // A live repo rule already routes future sessions here — nothing to suggest.
  const liveRule = db
    .prepare(`
      SELECT 1 FROM repo_rules rr
      JOIN projects p ON p.id = rr.project_id
      WHERE rr.repo_owner = ? AND rr.repo_name = ? AND p.deleted_at IS NULL
      LIMIT 1
    `)
    .get(session.repo_owner, session.repo_name)
  if (liveRule) return null

  const project = db
    .prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { name: string } | undefined
  if (!project) return null

  return {
    type: 'opt-in',
    repoOwner: session.repo_owner,
    repoName: session.repo_name,
    projectId,
    projectName: project.name,
  }
}

/**
 * Returns the highest-priority Copilot session status per project.
 * Priority: in_progress > waiting > pr_ready > completed.
 * Only projects with at least one non-completed session are included.
 */
export function getAllStatuses(): Record<number, CopilotSessionStatus> {
  const rows = getDb()
    .prepare(`
      SELECT project_id,
             CASE MAX(CASE status
               WHEN 'in_progress' THEN 4
               WHEN 'waiting'     THEN 3
               WHEN 'pr_ready'    THEN 2
               WHEN 'completed'   THEN 1
               ELSE 0
             END)
               WHEN 4 THEN 'in_progress'
               WHEN 3 THEN 'waiting'
               WHEN 2 THEN 'pr_ready'
               ELSE NULL
             END AS top_status
      FROM copilot_sessions
      WHERE project_id IS NOT NULL
        AND status != 'completed'
      GROUP BY project_id
    `)
    .all() as { project_id: number; top_status: string | null }[]

  const result: Record<number, CopilotSessionStatus> = {}
  for (const row of rows) {
    if (row.top_status !== null) {
      result[row.project_id] = row.top_status as CopilotSessionStatus
    }
  }
  return result
}
