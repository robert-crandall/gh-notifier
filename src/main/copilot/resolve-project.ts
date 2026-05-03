/**
 * Utility for resolving a (repoOwner, repoName) pair to a project_id.
 * Checks in priority order:
 *   1. Simple repo rules (`repo_rules` table — exact match)
 *   2. Routing rules (`routing_rules` table — repo/org conditions only, first match wins)
 */

import { getDb } from '../db'

/** Returns the project_id mapped to the given repo, or null if no rule exists. */
export function resolveProjectId(repoOwner: string, repoName: string): number | null {
  const db = getDb()

  // 1. Simple repo rule (cheapest, exact match)
  const repoRule = db
    .prepare(`SELECT project_id FROM repo_rules WHERE repo_owner = ? AND repo_name = ?`)
    .get(repoOwner, repoName) as { project_id: number } | undefined
  if (repoRule) return repoRule.project_id

  // 2. Routing rules: only those with repo/org conditions and no type/reason conditions
  //    (we have no notification type/reason for copilot sessions, so we can only match
  //    rules that don't require them — otherwise we'd falsely match or falsely skip).
  const routingRule = db
    .prepare(`
      SELECT project_id FROM routing_rules
      WHERE action = 'route'
        AND project_id IS NOT NULL
        AND match_type IS NULL
        AND match_reason IS NULL
        AND (match_repo_owner IS NULL OR LOWER(match_repo_owner) = LOWER(?))
        AND (match_repo_name  IS NULL OR LOWER(match_repo_name)  = LOWER(?))
        AND (match_org IS NULL OR LOWER(?) LIKE '%' || LOWER(match_org) || '%')
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get(repoOwner, repoName, repoOwner) as { project_id: number } | undefined

  return routingRule?.project_id ?? null
}
