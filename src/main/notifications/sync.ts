/**
 * Notification sync module.
 *
 * Polls the GitHub Notifications API on a configurable interval and stores
 * results in the local SQLite database. All work is done in the main process;
 * the renderer is never involved in network I/O.
 */

import { BrowserWindow } from 'electron'
import { getOctokit, isOctokitReady } from '../auth/octokit'
import { upsertThreads, getThreadsNeedingPrefetch, updateThreadContent, deleteThread } from '../db/notifications'
import { listFilters, shouldSuppress } from '../db/filters'
import { getDb } from '../db'
import type { NotificationType, SyncIntervalMinutes, MaxSyncDays } from '../../shared/ipc-channels'
import { DEFAULT_SYNC_INTERVAL_MINUTES, SYNC_INTERVAL_OPTIONS, DEFAULT_MAX_SYNC_DAYS, MAX_SYNC_DAYS_OPTIONS } from '../../shared/ipc-channels'

const SYNC_INTERVAL_KEY = 'sync_interval_minutes'
const MAX_SYNC_DAYS_KEY = 'max_sync_days'

/** Reads the configured sync interval from the DB, falling back to the default. */
export function getSyncIntervalMinutes(): SyncIntervalMinutes {
  const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get(SYNC_INTERVAL_KEY) as { value: string } | undefined
  const parsed = row ? parseInt(row.value, 10) : NaN
  return (SYNC_INTERVAL_OPTIONS.includes(parsed as SyncIntervalMinutes) ? parsed : DEFAULT_SYNC_INTERVAL_MINUTES) as SyncIntervalMinutes
}

/** Persists the sync interval to the DB. */
export function setSyncIntervalMinutes(minutes: SyncIntervalMinutes): void {
  getDb().prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run(SYNC_INTERVAL_KEY, String(minutes))
}

/** Reads the configured max sync look-back window from the DB, falling back to the default. */
export function getMaxSyncDays(): MaxSyncDays {
  const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get(MAX_SYNC_DAYS_KEY) as { value: string } | undefined
  const parsed = row ? parseInt(row.value, 10) : NaN
  return (MAX_SYNC_DAYS_OPTIONS.includes(parsed as MaxSyncDays) ? parsed : DEFAULT_MAX_SYNC_DAYS) as MaxSyncDays
}

/** Persists the max sync look-back window to the DB. */
export function setMaxSyncDays(days: MaxSyncDays): void {
  getDb().prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run(MAX_SYNC_DAYS_KEY, String(days))
}

let pollTimer: NodeJS.Timeout | null = null
let syncInProgress = false

/** Starts the background notification polling loop. */
export function startNotificationSync(): void {
  if (pollTimer !== null) return // already running
  
  // Run the first sync, then schedule subsequent syncs after completion
  void syncOnceSafe().then(scheduleNextSync)
}

/** Schedules the next sync after the current one completes. */
function scheduleNextSync(): void {
  if (pollTimer !== null) return // already scheduled
  const intervalMs = getSyncIntervalMinutes() * 60 * 1000
  pollTimer = setTimeout(() => {
    pollTimer = null
    void syncOnceSafe().then(scheduleNextSync)
  }, intervalMs)
}

/**
 * Clears any pending timer and reschedules using the current interval.
 * Call this after changing the interval so it takes effect without waiting
 * for the previous timeout to fire.
 */
export function rescheduleSync(): void {
  stopNotificationSync()
  scheduleNextSync()
}

/** Stops the polling loop. */
export function stopNotificationSync(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/**
 * Performs a single sync cycle.
 * Throws if not authenticated or if the GitHub API call fails.
 * Callers that want fire-and-forget behavior should use syncOnceSafe() instead.
 */
export async function syncOnce(): Promise<void> {
  if (!isOctokitReady()) {
    throw new Error('NOT_AUTHENTICATED')
  }

  // Prevent overlapping syncs
  if (syncInProgress) {
    console.log('[notifications] Sync already in progress, skipping')
    return
  }

  syncInProgress = true
  try {
    const octokit = getOctokit()
    
    // Get last sync timestamp to fetch notifications since then
    const db = getDb()
    const lastSyncRow = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_notification_sync') as { value: string } | undefined

    // Floor the look-back window to maxSyncDays so we never fetch arbitrarily
    // far into the past (e.g., on first run or after a DB reset).
    const maxDaysAgo = new Date(Date.now() - getMaxSyncDays() * 24 * 60 * 60 * 1000).toISOString()
    const since = lastSyncRow?.value && lastSyncRow.value > maxDaysAgo ? lastSyncRow.value : maxDaysAgo

    // Capture the fetch start time BEFORE the API call so that any
    // notifications arriving during pagination are not missed. Using the
    // end-of-sync time as `since` would create a race window where a
    // notification updated during pagination could never be retrieved.
    const fetchStartedAt = new Date().toISOString()
    
    // Fetch all notifications with pagination
    const notifications = await octokit.paginate(
      octokit.rest.activity.listNotificationsForAuthenticatedUser,
      {
        all: false, // only unread
        per_page: 100,
        ...(since ? { since } : {}),
      }
    )

    const threads = notifications.map((n) => ({
      id: String(n.id),
      repoOwner: n.repository.owner.login,
      repoName: n.repository.name,
      title: n.subject.title,
      type: n.subject.type as NotificationType,
      reason: n.reason,
      unread: n.unread,
      updatedAt: n.updated_at,
      lastReadAt: n.last_read_at ?? null,
      apiUrl: n.url,
      subjectUrl: n.subject.url ?? null,
    }))

    // M7: Apply notification filters before storing on a best-effort basis.
    // At this stage we only have fields from the notifications list response,
    // so filters that depend on prefetched subject details (for example
    // subject state or true author) cannot be evaluated yet and may still be
    // applied later when richer thread data is available.
    const activeFilters = listFilters()
    const filteredThreads =
      activeFilters.length === 0
        ? threads
        : threads.filter((t) => {
            // shouldSuppress needs a NotificationThread shape; subjectState and
            // author-derived fields are unavailable before prefetch, so this is
            // only an early suppression pass for the dimensions we can evaluate.
            return !shouldSuppress(
              { ...t, projectId: null, subjectState: null, htmlUrl: null, lastReadAt: t.lastReadAt },
              activeFilters,
            )
          })

    upsertThreads(filteredThreads)
    
    // Persist the fetch start time (not end time) so that notifications
    // arriving during pagination are caught on the next sync cycle.
    db.prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run('last_notification_sync', fetchStartedAt)

    // Notify renderer that data has changed so it can re-fetch
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
  } finally {
    syncInProgress = false
  }
}

/** Fire-and-forget wrapper used by the background polling loop. */
async function syncOnceSafe(): Promise<void> {
  // Skip sync if not authenticated (e.g., first launch before login)
  if (!isOctokitReady()) {
    return // No error logging for expected unauthenticated state
  }
  
  try {
    await syncOnce()
  } catch (err) {
    console.error('[notifications] Sync failed:', err)
  }

  // Run content prefetch after every sync cycle, regardless of whether the
  // main sync succeeded. Threads from previous syncs may still need prefetching.
  try {
    await prefetchThreadContent()
  } catch (err) {
    console.error('[notifications] Content prefetch failed:', err)
  }
}

// ── Content prefetch (M5) ─────────────────────────────────────────────────────

const PREFETCH_BATCH_SIZE = 5

/**
 * Fetches subject content (PR/issue state and html_url) for threads that
 * haven't been fetched yet, or that received a new notification since the
 * last fetch.
 *
 * Auto-removes threads whose PR has been merged or issue has been closed.
 * Emits notifications:updated if any threads were removed.
 */
export async function prefetchThreadContent(): Promise<void> {
  if (!isOctokitReady()) return

  const candidates = getThreadsNeedingPrefetch()
  if (candidates.length === 0) return

  const total = candidates.length
  console.log(`[notifications] Prefetching content for ${total} thread(s)`)

  const emitProgress = (completed: number) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('prefetch:progress', { completed, total })
    })
  }

  emitProgress(0)

  const octokit = getOctokit()
  let anyChanged = false
  let completed = 0

  // Process in small batches to avoid hammering the API
  let rateLimited = false

  for (let i = 0; i < candidates.length; i += PREFETCH_BATCH_SIZE) {
    if (rateLimited) break

    const batch = candidates.slice(i, i + PREFETCH_BATCH_SIZE)

    await Promise.all(
      batch.map(async (candidate) => {
        if (rateLimited) return
        try {
          const response = await octokit.request(`GET ${candidate.subjectUrl}`)
          const data = response.data as {
            state: string
            html_url: string
            merged?: boolean
            merged_at?: string | null
          }

          const isMerged =
            candidate.type === 'PullRequest' &&
            (data.merged_at != null || data.merged === true)
          const subjectState = isMerged ? 'merged' : (data.state ?? 'open')
          const htmlUrl: string = data.html_url

          // Auto-remove resolved threads per PRD M5 spec:
          // merged PRs, closed PRs (rejected/abandoned), and closed issues
          const shouldRemove =
            (candidate.type === 'Issue' && subjectState === 'closed') ||
            (candidate.type === 'PullRequest' && (subjectState === 'merged' || subjectState === 'closed'))

          if (shouldRemove) {
            console.log(`[notifications] Auto-removing ${candidate.type} thread ${candidate.id} (state: ${subjectState})`)
            deleteThread(candidate.id)
          } else {
            updateThreadContent(candidate.id, subjectState, htmlUrl)
          }
          anyChanged = true
        } catch (err) {
          const status = (err as { status?: number }).status

          if (status === 429) {
            // Rate-limited — stop all prefetching until the next sync cycle
            console.warn(`[notifications] Rate limited during prefetch, aborting batch`)
            rateLimited = true
            return
          }

          if (status === 404 || status === 410 || status === 451) {
            // Deleted, gone, or legally unavailable; the thread will never be fetchable
            console.log(`[notifications] Removing thread ${candidate.id} (HTTP ${status} on subject URL)`)
            deleteThread(candidate.id)
            anyChanged = true
            return
          }

          // Transient or ambiguous error (including 403) — leave content_fetched_at unset
          // so it retries next sync rather than deleting on a potentially temporary failure.
          console.error(`[notifications] Failed to prefetch thread ${candidate.id} (HTTP ${status ?? 'unknown'}):`, err)
        } finally {
          completed++
          emitProgress(completed)
        }
      })
    )
  }

  // Emit final "done" progress even if we aborted early due to rate limiting
  // so the UI can clear the progress indicator
  if (completed < total) {
    emitProgress(total)
  }

  if (anyChanged) {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
  }
}
