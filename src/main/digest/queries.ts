import { getDb } from '../db'
import type { CopilotSessionStatus, NotificationType } from '../../shared/ipc-channels'
import { DIGEST_RECENCY_DAYS } from './constants'
import { daysAgoIso } from './time'
import type { DigestNotificationRow, DigestSessionRow } from './compute'

export interface DigestData {
  /** ISO 8601 upper bound the digest was computed against (query time). */
  asOf: string
  sessions: DigestSessionRow[]
  notifications: DigestNotificationRow[]
}

interface SessionQueryRow {
  id: string
  status: string
  title: string
  htmlUrl: string | null
  linkedPrUrl: string | null
}

interface NotificationQueryRow {
  id: string
  type: string
  reason: string
  title: string
  htmlUrl: string | null
}

/**
 * Read the Copilot sessions and unread notifications for a project that have
 * activity since the effective watermark. The effective watermark is the later
 * of the project's digest watermark and the recency floor — expressed as two
 * `datetime()`-normalized bounds so ISO and SQLite-format timestamps compare
 * correctly, and an upper bound (`asOf`) so a later dismiss can't skip work.
 */
export function getDigestData(projectId: number): DigestData {
  const db = getDb()
  const now = new Date()
  const asOf = now.toISOString()
  const recencyFloor = daysAgoIso(now, DIGEST_RECENCY_DAYS)

  const project = db
    .prepare('SELECT created_at, digest_seen_at FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(projectId) as { created_at: string; digest_seen_at: string | null } | undefined

  if (!project) return { asOf, sessions: [], notifications: [] }

  const watermark = project.digest_seen_at ?? project.created_at

  const sessionRows = db
    .prepare(
      `SELECT id, status, title, html_url AS htmlUrl, linked_pr_url AS linkedPrUrl
       FROM copilot_sessions
       WHERE project_id = ?
         AND datetime(updated_at) > datetime(?)
         AND datetime(updated_at) > datetime(?)
         AND datetime(updated_at) <= datetime(?)
       ORDER BY datetime(updated_at) DESC`
    )
    .all(projectId, watermark, recencyFloor, asOf) as SessionQueryRow[]

  const notificationRows = db
    .prepare(
      `SELECT id, type, reason, title, html_url AS htmlUrl
       FROM notification_threads
       WHERE project_id = ?
         AND unread = 1
         AND datetime(updated_at) > datetime(?)
         AND datetime(updated_at) > datetime(?)
         AND datetime(updated_at) <= datetime(?)
       ORDER BY datetime(updated_at) DESC`
    )
    .all(projectId, watermark, recencyFloor, asOf) as NotificationQueryRow[]

  const sessions: DigestSessionRow[] = sessionRows.map((r) => ({
    id: r.id,
    status: r.status as CopilotSessionStatus,
    title: r.title,
    htmlUrl: r.htmlUrl,
    linkedPrUrl: r.linkedPrUrl,
  }))

  const notifications: DigestNotificationRow[] = notificationRows.map((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    reason: r.reason,
    title: r.title,
    htmlUrl: r.htmlUrl,
  }))

  return { asOf, sessions, notifications }
}
