/**
 * Per-project local-checkout override path — the "override" half of the owner's
 * "convention + override" cwd UX. Stored in `sync_metadata` keyed by project id
 * so no migration is needed. Unset for the common case (the repos-root
 * convention resolves `<repos-root>/<repo>`); set only when the convention
 * doesn't fit a given project's checkout.
 */

import { getDb } from '../../db'

function key(projectId: number): string {
  return `copilot_project_cwd_override:${projectId}`
}

/** The explicit override checkout path for a project, or null when unset. */
export function getProjectOverridePath(projectId: number): string | null {
  const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key(projectId)) as
    | { value: string }
    | undefined
  const value = row?.value.trim()
  return value !== undefined && value.length > 0 ? value : null
}

/** Set (or clear, with an empty string) a project's override checkout path. */
export function setProjectOverridePath(projectId: number, path: string | null): void {
  const db = getDb()
  const trimmed = path?.trim() ?? ''
  if (trimmed.length === 0) {
    db.prepare('DELETE FROM sync_metadata WHERE key = ?').run(key(projectId))
    return
  }
  db.prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run(key(projectId), trimmed)
}
