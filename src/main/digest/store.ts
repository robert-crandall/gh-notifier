import { getDb } from '../db'
import { RESURFACE_COOLDOWN_DAYS, MS_PER_DAY } from './constants'
import { clampDigestWatermark } from './watermark'

/** Advance the drift anchor to now. Call when a project becomes focused. */
export function markProjectFocused(projectId: number): void {
  getDb()
    .prepare('UPDATE projects SET last_focused_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), projectId)
}

/**
 * Advance the digest watermark to `asOf` (from the ReentryDigest), clamped so it
 * only moves forward and never past now. No-op if the value wouldn't advance.
 */
export function markDigestSeen(projectId: number, asOf: string): void {
  const db = getDb()
  const row = db
    .prepare('SELECT digest_seen_at FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { digest_seen_at: string | null } | undefined
  if (!row) return

  const next = clampDigestWatermark(asOf, row.digest_seen_at, new Date())
  if (next === null) return

  db.prepare('UPDATE projects SET digest_seen_at = ? WHERE id = ?').run(next, projectId)
}

/** Suppress a drifting project from resurfacing for the cooldown window ("not now"). */
export function dismissResurface(projectId: number): void {
  const until = new Date(Date.now() + RESURFACE_COOLDOWN_DAYS * MS_PER_DAY).toISOString()
  getDb()
    .prepare('UPDATE projects SET drift_snoozed_until = ? WHERE id = ? AND deleted_at IS NULL')
    .run(until, projectId)
}
