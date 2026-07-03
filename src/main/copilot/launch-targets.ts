/**
 * Resolve the candidate repos an agent task can target for a given project.
 *
 * Projects don't own a repo column. A project relates to repos only through its
 * repo rules and its routed notification threads, so we union those two sources
 * (distinct). Repo-rule repos come first (an explicit user mapping), then
 * thread repos by recency, so the launch composer preselects the most relevant
 * one when there's exactly one — and offers a sensible order when there are many.
 */

import { getDb } from '../db'
import type { LaunchTarget } from '../../shared/ipc-channels'

interface RepoRow {
  repo_owner: string
  repo_name: string
}

export function getLaunchTargets(projectId: number): LaunchTarget[] {
  const rows = getDb()
    .prepare(`
      SELECT MIN(repo_owner) AS repo_owner, MIN(repo_name) AS repo_name,
             MIN(rank) AS rank, MAX(recency) AS recency
      FROM (
        SELECT repo_owner, repo_name, 0 AS rank, '' AS recency
        FROM repo_rules
        WHERE project_id = ?
        UNION ALL
        SELECT repo_owner, repo_name, 1 AS rank, MAX(updated_at) AS recency
        FROM notification_threads
        WHERE project_id = ?
        GROUP BY repo_owner, repo_name
      )
      GROUP BY LOWER(repo_owner), LOWER(repo_name)
      ORDER BY rank ASC, recency DESC, repo_owner ASC, repo_name ASC
    `)
    .all(projectId, projectId) as RepoRow[]

  return rows.map((r) => ({ repoOwner: r.repo_owner, repoName: r.repo_name }))
}
