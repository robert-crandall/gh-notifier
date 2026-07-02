/**
 * Utility for resolving a Copilot session to a project_id.
 *
 * Resolution order:
 *   1. The notification thread for the associated PR, if it's already routed to a project
 *   2. Simple repo rule (`repo_rules` table — exact match)
 *   3. Routing rules (`routing_rules` table — repo/org conditions only, first match wins)
 */

import { getDb } from '../db'

/**
 * Returns the project_id for a Copilot session, or null if none can be determined.
 *
 * @param repoOwner   GitHub org/user that owns the repo
 * @param repoName    Repository name
 * @param prNumber    Pull request number from the agent task, if any
 */
export function resolveProjectId(
  repoOwner: string,
  repoName: string,
  prNumber: number | null = null
): number | null {
  const db = getDb()

  // A chosen project only counts if it's live (not soft-deleted), so a deleted
  // project can't keep absorbing Copilot sessions on the next sync.
  const isLive = (projectId: number): boolean =>
    db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId) !== undefined

  // 1. Follow the notification thread — wherever the PR notification is routed, the
  //    Copilot session goes too. This keeps Copilot sessions co-located with their work
  //    without requiring any separate configuration.
  if (prNumber !== null) {
    const threadRow = db
      .prepare(
        `SELECT project_id FROM notification_threads
         WHERE repo_owner = ? AND repo_name = ?
           AND subject_url LIKE ?
           AND project_id IS NOT NULL
         LIMIT 1`
      )
      .get(repoOwner, repoName, `%/pulls/${prNumber}`) as { project_id: number } | undefined
    if (threadRow && isLive(threadRow.project_id)) return threadRow.project_id
  }

  // 2. Simple repo rule (exact match)
  const repoRule = db
    .prepare(`SELECT project_id FROM repo_rules WHERE repo_owner = ? AND repo_name = ?`)
    .get(repoOwner, repoName) as { project_id: number } | undefined
  if (repoRule && isLive(repoRule.project_id)) return repoRule.project_id

  // 3. Routing rules without type/reason conditions (copilot sessions have neither)
  const routingRule = db
    .prepare(`
      SELECT rr.project_id FROM routing_rules rr
      JOIN projects p ON p.id = rr.project_id
      WHERE rr.action = 'route'
        AND rr.project_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND rr.match_type IS NULL
        AND rr.match_reason IS NULL
        AND (rr.match_repo_owner IS NULL OR LOWER(rr.match_repo_owner) = LOWER(?))
        AND (rr.match_repo_name  IS NULL OR LOWER(rr.match_repo_name)  = LOWER(?))
        AND (rr.match_org IS NULL OR LOWER(?) LIKE '%' || LOWER(rr.match_org) || '%')
      ORDER BY rr.created_at ASC
      LIMIT 1
    `)
    .get(repoOwner, repoName, repoOwner) as { project_id: number } | undefined

  return routingRule?.project_id ?? null
}
