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
import type { CopilotAppSession, CopilotAppSessionStatus } from '../../../shared/ipc-channels'

interface AppSessionRow {
  id: string
  project_id: number | null
  cwd: string
  title: string
  status: string
  repo_owner: string | null
  repo_name: string | null
  created_at: string
  updated_at: string
}

function toSession(row: AppSessionRow): CopilotAppSession {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    title: row.title,
    status: row.status as CopilotAppSessionStatus,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
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
 * Insert a just-delegated app session (status starts `in_progress`). Only pins a
 * live project: if the originating project vanished mid-delegate (or is
 * soft-deleted), the session is tracked unassigned instead, so a successful
 * delegate is never lost to an FK failure.
 */
export function insertAppSession(input: InsertAppSessionInput): CopilotAppSession {
  const db = getDb()
  const projectIsLive =
    input.projectId !== null &&
    db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(input.projectId) != null
  const projectId = projectIsLive ? input.projectId : null

  db.prepare(`
    INSERT INTO copilot_app_sessions
      (id, project_id, cwd, title, status, repo_owner, repo_name)
    VALUES
      (?, ?, ?, ?, 'in_progress', ?, ?)
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

/** Returns a single app session by id, or null. */
export function getAppSession(id: string): CopilotAppSession | null {
  const row = getDb().prepare('SELECT * FROM copilot_app_sessions WHERE id = ?').get(id) as AppSessionRow | undefined
  return row === undefined ? null : toSession(row)
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
