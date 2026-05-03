/**
 * Copilot session sync orchestrator.
 *
 * Fetches remote sessions from `gh agent-task list`, upserts them into
 * the local DB, and broadcasts a push event to the renderer.
 *
 * Piggybacked onto the existing notification sync — no separate timer.
 */

import { BrowserWindow } from 'electron'
import { fetchGithubSessions } from './github-source'
import { upsertSessions } from './db'

function broadcastCopilotUpdated(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('copilot:updated')
  })
}

let syncing = false
let resyncRequested = false

/** Syncs remote Copilot sessions from GitHub and persists to DB. */
export async function syncCopilotSessions(): Promise<void> {
  if (syncing) {
    resyncRequested = true
    return
  }
  syncing = true
  try {
    do {
      resyncRequested = false
      const sessions = await fetchGithubSessions()
      if (sessions.length > 0) {
        upsertSessions(sessions)
      }
      broadcastCopilotUpdated()
    } while (resyncRequested)
  } catch (err) {
    console.error('[copilot/sync] Sync failed:', err)
  } finally {
    syncing = false
    resyncRequested = false
  }
}
