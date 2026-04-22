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
import type { NotificationType } from '../../shared/ipc-channels'

const POLL_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

let pollTimer: ReturnType<typeof setInterval> | null = null

/** Starts the background notification polling loop. */
export function startNotificationSync(): void {
  if (pollTimer !== null) return // already running
  pollTimer = setInterval(() => { void syncOnceSafe() }, POLL_INTERVAL_MS)
}

/** Stops the polling loop. */
export function stopNotificationSync(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
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

  const octokit = getOctokit()
  const { data } = await octokit.rest.activity.listNotificationsForAuthenticatedUser({
    all: false, // only unread
    per_page: 100,
  })

  const threads = data.map((n) => ({
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

  // Notify renderer that data has changed so it can re-fetch
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('notifications:updated')
  })
}

/** Fire-and-forget wrapper used by the background polling loop. */
async function syncOnceSafe(): Promise<void> {
  try {
    await syncOnce()
  } catch (err) {
    console.error('[notifications] Sync failed:', err)
  }
}
