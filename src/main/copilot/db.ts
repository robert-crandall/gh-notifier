/**
 * Copilot session DB accessors.
 *
 * All operations are synchronous (better-sqlite3) and run in the main process.
 */

import { getDb } from '../db'
import type { CopilotSession, CopilotSessionStatus } from '../../shared/ipc-channels'

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
  }
}

/** Upserts a batch of sessions. Existing rows are fully replaced. */
export function upsertSessions(sessions: CopilotSession[]): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO copilot_sessions
      (id, project_id, source, status, title, html_url, started_at, updated_at,
       repo_owner, repo_name, branch, linked_pr_url)
    VALUES
      (@id, @project_id, @source, @status, @title, @html_url, @started_at, @updated_at,
       @repo_owner, @repo_name, @branch, @linked_pr_url)
  `)
  const insertMany = db.transaction((rows: CopilotSession[]) => {
    for (const s of rows) {
      stmt.run({
        id: s.id,
        project_id: s.projectId,
        source: s.source,
        status: s.status,
        title: s.title,
        html_url: s.htmlUrl,
        started_at: s.startedAt,
        updated_at: s.updatedAt,
        repo_owner: s.repoOwner,
        repo_name: s.repoName,
        branch: s.branch,
        linked_pr_url: s.linkedPrUrl,
      })
    }
  })
  insertMany(sessions)
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
