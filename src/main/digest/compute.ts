import type {
  CopilotSessionStatus,
  DigestItem,
  NotificationType,
} from '../../shared/ipc-channels'

/** Copilot session row the digest cares about (already filtered by watermark + project). */
export interface DigestSessionRow {
  id: string
  status: CopilotSessionStatus
  title: string
  htmlUrl: string | null
  linkedPrUrl: string | null
}

/** Notification row the digest cares about (unread, filtered by watermark + project). */
export interface DigestNotificationRow {
  id: string
  type: NotificationType
  reason: string
  title: string
  htmlUrl: string | null
}

export interface ComputeDigestInput {
  sessions: DigestSessionRow[]
  notifications: DigestNotificationRow[]
}

/** How many individual "review requested" bullets to show before folding into the group. */
const MAX_INDIVIDUAL_REVIEWS = 3

function truncate(text: string, max = 64): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function sessionLabel(title: string): string {
  const t = truncate(title)
  return t.length > 0 ? `“${t}”` : 'a task'
}

function sessionItem(row: DigestSessionRow): DigestItem | null {
  const label = sessionLabel(row.title)
  switch (row.status) {
    case 'pr_ready':
      return {
        id: `session-${row.id}`,
        kind: 'agent-pr-ready',
        tone: 'success',
        text: `Copilot opened a PR for ${label} — ready to review.`,
        href: row.linkedPrUrl ?? row.htmlUrl,
        count: null,
      }
    case 'waiting':
      return {
        id: `session-${row.id}`,
        kind: 'agent-waiting',
        tone: 'attention',
        text: `Copilot paused on ${label} — it needs your input.`,
        href: row.htmlUrl,
        count: null,
      }
    case 'completed':
      return {
        id: `session-${row.id}`,
        kind: 'agent-completed',
        tone: 'info',
        text: `Copilot finished ${label}.`,
        href: row.htmlUrl,
        count: null,
      }
    case 'in_progress':
      return {
        id: `session-${row.id}`,
        kind: 'agent-in-progress',
        tone: 'info',
        text: `Copilot is working on ${label}.`,
        href: row.htmlUrl,
        count: null,
      }
    default:
      return null
  }
}

/**
 * Build the blame-free "since you were here" digest items. Pure.
 *
 * Copilot sessions are the reliable delta (rows persist across status changes).
 * Notifications reflect current unread activity since the watermark; we surface
 * "review requested" ones individually and group the rest with a plain count.
 * We never fabricate merged/closed state (those rows are gone) — completion
 * signal comes only from Copilot sessions.
 */
export function computeDigestItems(input: ComputeDigestInput): DigestItem[] {
  const items: DigestItem[] = []

  for (const session of input.sessions) {
    const item = sessionItem(session)
    if (item !== null) items.push(item)
  }

  const reviews = input.notifications.filter((n) => n.reason.toLowerCase() === 'review_requested')
  const individualReviews = reviews.slice(0, MAX_INDIVIDUAL_REVIEWS)

  for (const review of individualReviews) {
    items.push({
      id: `notif-${review.id}`,
      kind: 'notification-review',
      tone: 'info',
      text: `Review requested: ${sessionLabel(review.title)}.`,
      href: review.htmlUrl,
      count: null,
    })
  }

  const groupedCount = input.notifications.length - individualReviews.length
  if (groupedCount > 0) {
    items.push({
      id: 'notif-group',
      kind: 'notifications-grouped',
      tone: 'neutral',
      text:
        groupedCount === 1
          ? '1 notification routed here.'
          : `${groupedCount} notifications routed here.`,
      href: null,
      count: groupedCount,
    })
  }

  return items
}
