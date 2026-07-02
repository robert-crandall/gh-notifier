import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { initAuth, getAuthStatus, savePat, logout, getOctokit } from './auth'
import {
  listProjects, getProject, createProject, updateProject, deleteProject, restoreProject,
  createTodo, updateTodo, deleteTodo, restoreTodo,
  createLink, updateLink, deleteLink,
  snoozeProject,
} from './db/projects'
import {
  listThreadsByProject,
  listInboxThreads,
  getUnreadCounts,
  assignThread,
  markThreadRead,
  markThreadsReadMany,
  deleteThread,
  listRepoRules,
  createRepoRule,
  deleteRepoRule,
} from './db/notifications'
import { listRoutingRules, createRoutingRule, deleteRoutingRule, applyRoutingRulesToInbox } from './db/routing-rules'
import { startNotificationSync, syncOnce, prefetchThreadContent, getSyncIntervalMinutes, setSyncIntervalMinutes, rescheduleSync, getMaxSyncDays, setMaxSyncDays } from './notifications/sync'
import { startSnoozeWatcher } from './snooze'
import { syncCopilotSessions } from './copilot/sync'
import { getSessionsForProject, getAllStatuses } from './copilot/db'
import { getDigest, markProjectFocused, markDigestSeen, dismissResurface } from './digest'
import { getDb } from './db'
import type { ProjectPatch, ProjectTodoPatch, ProjectLinkPatch, SnoozeMode, SyncIntervalMinutes, MaxSyncDays, CreateRoutingRulePayload } from '../shared/ipc-channels'
import { SYNC_INTERVAL_OPTIONS, MAX_SYNC_DAYS_OPTIONS } from '../shared/ipc-channels'

/** Broadcasts a push event to all renderer windows. */
function broadcast(channel: 'notifications:updated' | 'copilot:updated' | 'projects:updated'): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel)
  })
}

/** Emits projects:updated on a low-frequency tick so drift/cooldown transitions
 * surface without the user taking an action (e.g. the app sat open overnight). */
const DRIFT_TICK_MS = 60 * 1000
let driftTimer: NodeJS.Timeout | null = null
function startDriftWatcher(): void {
  if (driftTimer !== null) return
  driftTimer = setInterval(() => broadcast('projects:updated'), DRIFT_TICK_MS)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    show: false
  })

  // Security: deny all renderer-initiated window.open attempts
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    // Trigger first sync after the window is visible so the event reaches the renderer.
    // syncOnceSafe() (called by startNotificationSync's polling loop) already piggybacks
    // a copilot sync, so we only need to trigger the notification sync here. No separate
    // copilot sync fallback is needed — startNotificationSync handles it regardless of auth.
    void syncOnce().catch((error: unknown) => {
      console.error('[main] Initial notification sync failed:', error)
    })
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  initDb()
  await initAuth()

  // M1 health-check handler
  ipcMain.handle('app:ping', () => 'pong')

  // Auth handlers
  ipcMain.handle('auth:status', () => getAuthStatus())
  ipcMain.handle('auth:save-token', async (_event, token: string) => {
    const result = await savePat(token)
    // Fire a sync now that we have credentials; fire-and-forget
    void syncOnce().catch((err: unknown) => {
      console.error('[auth] Post-auth sync failed:', err)
    })
    void syncCopilotSessions().catch((err: unknown) => {
      console.error('[auth] Post-auth copilot sync failed:', err)
    })
    return result
  })
  ipcMain.handle('auth:logout', () => { logout() })

  // External URL handler (security: controlled via main process)
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  // Project handlers
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:get', (_event, id: number) => getProject(id))
  ipcMain.handle('projects:create', (_event, name: string) => createProject(name))
  ipcMain.handle('projects:update', (_event, id: number, patch: ProjectPatch) => updateProject(id, patch))
  ipcMain.handle('projects:delete', (_event, id: number) => {
    deleteProject(id)
    // Deleting a project returns its notifications to the Inbox and changes the
    // rail, so refresh both surfaces.
    broadcast('projects:updated')
    broadcast('notifications:updated')
  })
  ipcMain.handle('projects:snooze', (_event, id: number, mode: SnoozeMode, until?: string) =>
    snoozeProject(id, mode, until)
  )

  // Todo handlers
  ipcMain.handle('todos:create', (_event, projectId: number, text: string) => createTodo(projectId, text))
  ipcMain.handle('todos:update', (_event, id: number, patch: ProjectTodoPatch) => updateTodo(id, patch))
  ipcMain.handle('todos:delete', (_event, id: number) => deleteTodo(id))

  // Link handlers
  ipcMain.handle('links:create', (_event, projectId: number, label: string, url: string) => createLink(projectId, label, url))
  ipcMain.handle('links:update', (_event, id: number, patch: ProjectLinkPatch) => updateLink(id, patch))
  ipcMain.handle('links:delete', (_event, id: number) => deleteLink(id))

  // Notification handlers
  ipcMain.handle('notifications:list', (_event, projectId: number) => listThreadsByProject(projectId))
  ipcMain.handle('notifications:inbox', () => listInboxThreads())
  ipcMain.handle('notifications:unread-counts', () => getUnreadCounts())
  ipcMain.handle('notifications:assign', (_event, threadId: string, projectId: number | null) => {
    assignThread(threadId, projectId)
    // Emit update event so UI refreshes immediately
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
    // Re-resolve copilot sessions so any session linked to this thread's PR
    // follows the new project assignment.
    void syncCopilotSessions()
  })
  ipcMain.handle('notifications:mark-read', async (_event, threadId: string) => {
    markThreadRead(threadId)
    // Emit update event so unread badges refresh immediately
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
    // Best-effort: mark read on GitHub so the next sync doesn't re-surface it
    try {
      const octokit = getOctokit()
      await octokit.rest.activity.markThreadAsRead({ thread_id: parseInt(threadId, 10) })
    } catch (err) {
      console.error('[notifications] Failed to mark thread read on GitHub:', err)
    }
  })
  ipcMain.handle('notifications:mark-read-many', async (_event, threadIds: string[]) => {
    markThreadsReadMany(threadIds)
    // Emit a single update event after bulk operation
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
    // Best-effort: mark each thread read on GitHub in parallel
    try {
      const octokit = getOctokit()
      await Promise.allSettled(
        threadIds.map((id) => octokit.rest.activity.markThreadAsRead({ thread_id: parseInt(id, 10) }))
      )
    } catch (err) {
      console.error('[notifications] Failed to mark threads read on GitHub:', err)
    }
  })
  ipcMain.handle('notifications:unsubscribe', async (_event, threadId: string) => {
    const octokit = getOctokit()
    await octokit.rest.activity.deleteThreadSubscription({ thread_id: parseInt(threadId, 10) })
    deleteThread(threadId)
    // Emit update event so UI refreshes immediately
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
    // Re-resolve copilot sessions — the deleted thread may have changed resolveProjectId() results
    void syncCopilotSessions()
  })
  ipcMain.handle('notifications:sync', async () => {
    await syncOnce()
    try { await prefetchThreadContent() } catch (err) { console.error('[notifications] Prefetch after manual sync failed:', err) }
    // Keep Copilot sessions in sync with notifications so sidebar dots stay current
    await syncCopilotSessions()
  })
  ipcMain.handle('notifications:last-sync-time', () => {
    const row = getDb().prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_notification_sync') as { value: string } | undefined
    return row?.value ?? null
  })

  // Settings handlers
  ipcMain.handle('settings:get-sync-interval', () => getSyncIntervalMinutes())
  ipcMain.handle('settings:set-sync-interval', (_event, minutes) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes <= 0) {
      return
    }
    if (!SYNC_INTERVAL_OPTIONS.includes(minutes as SyncIntervalMinutes)) {
      return
    }
    setSyncIntervalMinutes(minutes as SyncIntervalMinutes)
    rescheduleSync()
  })

  ipcMain.handle('settings:get-max-sync-days', () => getMaxSyncDays())
  ipcMain.handle('settings:set-max-sync-days', (_event, days) => {
    if (typeof days !== 'number' || !Number.isFinite(days) || !Number.isInteger(days) || days <= 0) {
      return
    }
    if (!MAX_SYNC_DAYS_OPTIONS.includes(days as MaxSyncDays)) {
      return
    }
    setMaxSyncDays(days as MaxSyncDays)
  })

  // Repo rule handlers
  ipcMain.handle('repo-rules:list', () => listRepoRules())
  ipcMain.handle('repo-rules:create', (_event, repoOwner: string, repoName: string, projectId: number) =>
    createRepoRule(repoOwner, repoName, projectId)
  )
  ipcMain.handle('repo-rules:delete', (_event, id: number) => deleteRepoRule(id))

  // Routing rule handlers
  ipcMain.handle('routing-rules:list', () => listRoutingRules())
  ipcMain.handle('routing-rules:create', (_event, payload: CreateRoutingRulePayload) =>
    createRoutingRule(payload)
  )
  ipcMain.handle('routing-rules:delete', (_event, id: number) => deleteRoutingRule(id))
  ipcMain.handle('routing-rules:apply-to-inbox', () => {
    const result = applyRoutingRulesToInbox()
    // Emit update event so inbox and project views refresh
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
    // Re-resolve copilot sessions against the newly routed threads
    void syncCopilotSessions()
    return result
  })

  // Copilot session handlers
  ipcMain.handle('copilot:sessions-for-project', (_event, projectId: number) =>
    getSessionsForProject(projectId)
  )
  ipcMain.handle('copilot:all-statuses', () => getAllStatuses())
  ipcMain.handle('copilot:sync', async () => {
    await syncCopilotSessions()
  })

  // Focus: re-entry digest + drift handlers
  ipcMain.handle('digest:get', (_event, projectId: number) => getDigest(projectId))
  ipcMain.handle('projects:mark-focused', (_event, projectId: number) => {
    markProjectFocused(projectId)
    // The focused project stops drifting; refresh the rail + resurfacing.
    broadcast('projects:updated')
  })
  ipcMain.handle('digest:dismiss', (_event, projectId: number, asOf: string) => {
    markDigestSeen(projectId, asOf)
  })
  ipcMain.handle('projects:resurface-dismiss', (_event, projectId: number) => {
    dismissResurface(projectId)
    broadcast('projects:updated')
  })
  ipcMain.handle('projects:restore', (_event, projectId: number) => {
    restoreProject(projectId)
    broadcast('projects:updated')
  })
  ipcMain.handle('todos:restore', (_event, id: number) => restoreTodo(id))

  startNotificationSync()
  startSnoozeWatcher()
  startDriftWatcher()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
