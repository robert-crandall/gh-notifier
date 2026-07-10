/**
 * Accessors for the dedicated `copilot_app_sessions` table.
 *
 * These rows are PRIVATE to the desktop-app delegate feature: no existing
 * github-session reader touches this table, so app sessions can't leak into the
 * project rail / digest / unassigned surfaces until those are intentionally made
 * source-aware (PR3 / #87). All operations are synchronous (better-sqlite3) and
 * run in the main process.
 */

import { getDb } from '../../db'
import type { CopilotAppSession, CopilotAppSessionStatus, CopilotAppSessionOrigin } from '../../../shared/ipc-channels'

interface AppSessionRow {
  id: string
  project_id: number | null
  cwd: string
  title: string
  status: CopilotAppSessionStatus
  repo_owner: string | null
  repo_name: string | null
  origin: CopilotAppSessionOrigin
  pinned_project_id: number | null
  created_at: string
  updated_at: string
}

function toSession(row: AppSessionRow): CopilotAppSession {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    title: row.title,
    status: row.status,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    origin: row.origin,
    pinnedProjectId: row.pinned_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface InsertAppSessionInput {
  id: string
  projectId: number | null
  cwd: string
  title: string
  repoOwner: string | null
  repoName: string | null
}

/**
 * Insert a just-delegated app session (status starts `in_progress`, origin
 * `launched`). Only pins a live project: if the originating project vanished
 * mid-delegate (or is soft-deleted), the session is tracked unassigned instead,
 * so a successful delegate is never lost to an FK failure.
 */
export function insertAppSession(input: InsertAppSessionInput): CopilotAppSession {
  const db = getDb()
  const projectIsLive =
    input.projectId !== null &&
    db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(input.projectId) != null
  const projectId = projectIsLive ? input.projectId : null

  db.prepare(`
    INSERT INTO copilot_app_sessions
      (id, project_id, cwd, title, status, repo_owner, repo_name, origin)
    VALUES
      (?, ?, ?, ?, 'in_progress', ?, ?, 'launched')
    ON CONFLICT(id) DO UPDATE SET
      cwd        = excluded.cwd,
      title      = excluded.title,
      repo_owner = excluded.repo_owner,
      repo_name  = excluded.repo_name,
      updated_at = datetime('now')
  `).run(input.id, projectId, input.cwd, input.title, input.repoOwner, input.repoName)

  const row = db.prepare('SELECT * FROM copilot_app_sessions WHERE id = ?').get(input.id) as AppSessionRow
  return toSession(row)
}

export interface UpsertObservedSessionInput {
  id: string
  /** Freshly auto-resolved project for the session's repo (may be null). */
  projectId: number | null
  cwd: string
  title: string
  repoOwner: string | null
  repoName: string | null
}

/**
 * Upsert a session observed directly in the desktop app (#119). New rows are
 * tagged origin `observed`; an EXISTING row is never downgraded from `launched`
 * to `observed` (so a session Projects created keeps its provenance even though
 * the reconciler also sees it on disk).
 *
 * Sticky assignment mirrors `copilot_sessions.upsertSessions`: while a row's
 * `pinned_project_id` points at a live project it wins over the freshly-resolved
 * `project_id` (a manual assignment doesn't drift on the next reconcile); a pin
 * whose project is gone is cleared. New rows keep `pinned_project_id` NULL.
 * Volatile fields (cwd/title/repo) always track the on-disk truth. Returns the row.
 */
export function upsertObservedSession(input: UpsertObservedSessionInput): CopilotAppSession {
  const db = getDb()
  db.prepare(`
    INSERT INTO copilot_app_sessions
      (id, project_id, cwd, title, status, repo_owner, repo_name, origin)
    VALUES
      (?, ?, ?, ?, 'unknown', ?, ?, 'observed')
    ON CONFLICT(id) DO UPDATE SET
      pinned_project_id = CASE
        WHEN copilot_app_sessions.pinned_project_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM projects p
           WHERE p.id = copilot_app_sessions.pinned_project_id AND p.deleted_at IS NULL
         )
        THEN copilot_app_sessions.pinned_project_id
        ELSE NULL
      END,
      project_id = CASE
        WHEN copilot_app_sessions.pinned_project_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM projects p
           WHERE p.id = copilot_app_sessions.pinned_project_id AND p.deleted_at IS NULL
         )
        THEN copilot_app_sessions.pinned_project_id
        ELSE excluded.project_id
      END,
      cwd        = excluded.cwd,
      title      = excluded.title,
      repo_owner = excluded.repo_owner,
      repo_name  = excluded.repo_name,
      updated_at = datetime('now')
  `).run(input.id, input.projectId, input.cwd, input.title, input.repoOwner, input.repoName)

  const row = db.prepare('SELECT * FROM copilot_app_sessions WHERE id = ?').get(input.id) as AppSessionRow
  return toSession(row)
}

/**
 * Pin an app session to a live project (sticky across reconciles), mirroring
 * `assignSession` for cloud tasks. Throws when the project is missing/soft-deleted
 * or the session doesn't exist. Used by the per-project assignment UI (#117/#118).
 */
export function assignAppSession(sessionId: string, projectId: number): void {
  const db = getDb()
  const project = db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId)
  if (project === undefined || project === null) throw new Error('PROJECT_NOT_FOUND')
  const result = db
    .prepare('UPDATE copilot_app_sessions SET project_id = ?, pinned_project_id = ? WHERE id = ?')
    .run(projectId, projectId, sessionId)
  if (result.changes === 0) throw new Error('SESSION_NOT_FOUND')
}

/** Returns a single app session by id, or null. */
export function getAppSession(id: string): CopilotAppSession | null {
  // better-sqlite3 returns `undefined` for no row; bun:sqlite (tests) returns
  // `null`. Guard against both so a lookup for an as-yet-unseen id can't crash.
  const row = getDb().prepare('SELECT * FROM copilot_app_sessions WHERE id = ?').get(id) as AppSessionRow | undefined | null
  return row === undefined || row === null ? null : toSession(row)
}

/** Updates the status of an app session (used by the status reader in PR3). */
export function updateAppSessionStatus(id: string, status: CopilotAppSessionStatus): void {
  getDb()
    .prepare("UPDATE copilot_app_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id)
}

/** All app sessions for a project, newest first. */
export function getAppSessionsForProject(projectId: number): CopilotAppSession[] {
  const rows = getDb()
    .prepare('SELECT * FROM copilot_app_sessions WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as AppSessionRow[]
  return rows.map(toSession)
}

/**
 * Link a delegated app session to the todo it came from (#87). Transactional +
 * validated: the todo must exist (not soft-deleted), the session must exist,
 * their projects must match EXACTLY (a null-project session can't attach), and
 * the session must not already belong to a different todo (a session comes from
 * exactly one todo). Never trusts the renderer. Idempotent per pair.
 */
export function linkTodoSession(todoId: number, sessionId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const todo = db
      .prepare('SELECT project_id FROM project_todos WHERE id = ? AND deleted_at IS NULL')
      .get(todoId) as { project_id: number } | undefined | null
    if (todo === undefined || todo === null) throw new Error('TODO_NOT_FOUND')
    const session = db
      .prepare('SELECT project_id FROM copilot_app_sessions WHERE id = ?')
      .get(sessionId) as { project_id: number | null } | undefined | null
    if (session === undefined || session === null) throw new Error('SESSION_NOT_FOUND')
    if (session.project_id !== todo.project_id) {
      throw new Error('PROJECT_MISMATCH')
    }
    // A session belongs to exactly one todo — fail fast if it's already elsewhere.
    const existing = db
      .prepare('SELECT todo_id FROM todo_copilot_app_sessions WHERE session_id = ?')
      .get(sessionId) as { todo_id: number } | undefined | null
    if (existing !== undefined && existing !== null && existing.todo_id !== todoId) {
      throw new Error('SESSION_ALREADY_LINKED')
    }
    db.prepare(
      'INSERT OR IGNORE INTO todo_copilot_app_sessions (todo_id, session_id) VALUES (?, ?)'
    ).run(todoId, sessionId)
  })
  tx()
}

/**
 * Returns each app session linked to a todo in the given project, paired with
 * its todo id. Joins through the project's (non-deleted) todos, so a session
 * only surfaces where its todo is visible. The `s.project_id = t.project_id`
 * guard is defense-in-depth against a stale/mismatched link.
 */
export function getTodoAppSessionsForProject(projectId: number): { todoId: number; session: CopilotAppSession }[] {
  const rows = getDb()
    .prepare(`
      SELECT l.todo_id AS todo_id, s.*
      FROM todo_copilot_app_sessions l
      JOIN project_todos t ON t.id = l.todo_id
      JOIN copilot_app_sessions s ON s.id = l.session_id
      WHERE t.project_id = ? AND t.deleted_at IS NULL AND s.project_id = t.project_id
      ORDER BY l.created_at DESC
    `)
    .all(projectId) as (AppSessionRow & { todo_id: number })[]
  return rows.map((r) => ({ todoId: r.todo_id, session: toSession(r) }))
}
