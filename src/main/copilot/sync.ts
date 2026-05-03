/**
 * Copilot session sync orchestrator.
 *
 * Merges sessions from all three sources (github, cli, vscode-chat),
 * upserts them into the local DB, and broadcasts a push event to the renderer.
 *
 * Piggybacked onto the existing notification sync — no separate timer.
 */

import { BrowserWindow } from 'electron'
import { fetchGithubSessions } from './github-source'
import { fetchCliSessions, watchCliSessions } from './cli-source'
import { fetchVscodeSessions, watchVscodeSessions } from './vscode-source'
import { upsertSessions } from './db'

function broadcastCopilotUpdated(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('copilot:updated')
  })
}

/** Syncs all Copilot session sources and persists to DB. */
export async function syncCopilotSessions(): Promise<void> {
  try {
    const [githubSessions, cliSessions, vscodeSessions] = await Promise.all([
      fetchGithubSessions(),
      Promise.resolve(fetchCliSessions()),
      Promise.resolve(fetchVscodeSessions()),
    ])

    const all = [...githubSessions, ...cliSessions, ...vscodeSessions]
    if (all.length > 0) {
      upsertSessions(all)
    }

    broadcastCopilotUpdated()
  } catch (err) {
    console.error('[copilot/sync] Sync failed:', err)
  }
}

let cleanupWatchers: (() => void) | null = null

/**
 * Starts file-system watchers for local session sources (cli + vscode-chat).
 * Re-syncs on any change (debounced inside each watcher).
 * Call once at app startup.
 */
export function startCopilotWatchers(): void {
  if (cleanupWatchers !== null) return // already running

  const stopCli = watchCliSessions(() => {
    void syncCopilotSessions().catch((err: unknown) => {
      console.error('[copilot/sync] Watcher-triggered sync failed:', err)
    })
  })

  const stopVscode = watchVscodeSessions(() => {
    void syncCopilotSessions().catch((err: unknown) => {
      console.error('[copilot/sync] Watcher-triggered sync failed:', err)
    })
  })

  cleanupWatchers = () => {
    stopCli()
    stopVscode()
  }
}
