/**
 * Snooze watcher — background job that wakes date-based snoozed projects
 * when their snooze_until time has passed.
 *
 * Runs in the main process; piggybacks on the 'notifications:updated' event
 * to trigger a project list refresh in the renderer.
 */

import { BrowserWindow } from 'electron'
import { wakeExpiredSnoozes } from './db/projects'

const WAKE_CHECK_INTERVAL_MS = 60 * 1000 // 1 minute

let wakeTimer: NodeJS.Timeout | null = null

/** Starts the background snooze-wake checking loop. */
export function startSnoozeWatcher(): void {
  if (wakeTimer !== null) return
  scheduleNextCheck()
}

/** Stops the snooze-wake checking loop. */
export function stopSnoozeWatcher(): void {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
}

function scheduleNextCheck(): void {
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    checkAndWakeSnoozes()
    scheduleNextCheck()
  }, WAKE_CHECK_INTERVAL_MS)
}

function checkAndWakeSnoozes(): void {
  try {
    const wokenIds = wakeExpiredSnoozes()
    if (wokenIds.length > 0) {
      console.log(`[snooze] Woke ${wokenIds.length} project(s):`, wokenIds)
      // Piggyback on notifications:updated so the renderer refreshes its project list
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('notifications:updated')
      })
    }
  } catch (err) {
    console.error('[snooze] Failed to check/wake snoozes:', err)
  }
}
