/**
 * Utility for resolving a (repoOwner, repoName) pair to a project_id
 * using the existing repo_rules table.
 */

import { getDb } from '../db'

/** Returns the project_id mapped to the given repo, or null if no rule exists. */
export function resolveProjectId(repoOwner: string, repoName: string): number | null {
  const row = getDb()
    .prepare(`SELECT project_id FROM repo_rules WHERE repo_owner = ? AND repo_name = ?`)
    .get(repoOwner, repoName) as { project_id: number } | undefined
  return row?.project_id ?? null
}
