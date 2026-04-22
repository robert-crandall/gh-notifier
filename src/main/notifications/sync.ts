/**
 * Notification sync module.
 *
 * Polls the GitHub Notifications API on a configurable interval and stores
 * results in the local SQLite database. All work is done in the main process;
 * the renderer is never involved in network I/O.
 */

import { BrowserWindow } from 'electron'
import { getOctokit, isOctokitReady } from '../auth/octokit'
import { upsertThreads } from '../db/notifications'
import { getDb } from '../db'
import type { NotificationType } from '../../shared/ipc-channels'

const POLL_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

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
  pollTimer = setTimeout(() => {
    pollTimer = null
    void syncOnceSafe().then(scheduleNextSync)
  }, POLL_INTERVAL_MS)
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
    const since = lastSyncRow?.value
    
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
    }))

    upsertThreads(threads)
    
    // Update last sync timestamp
    const now = new Date().toISOString()
    db.prepare('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)').run('last_notification_sync', now)

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
}
