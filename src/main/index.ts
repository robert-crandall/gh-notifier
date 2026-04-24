import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { initAuth, getAuthStatus, savePat, logout, getOctokit } from './auth'
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  createTodo, updateTodo, deleteTodo,
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
  invalidateOpenThreadPrefetch,
} from './db/notifications'
import { listFilters, createFilter, deleteFilter } from './db/filters'
import { listRoutingRules, createRoutingRule, deleteRoutingRule, applyRoutingRulesToInbox } from './db/routing-rules'
import { startNotificationSync, syncOnce, prefetchThreadContent, getSyncIntervalMinutes, setSyncIntervalMinutes, rescheduleSync, getMaxSyncDays, setMaxSyncDays } from './notifications/sync'
import { startSnoozeWatcher } from './snooze'
import { getDb } from './db'
import type { ProjectPatch, ProjectTodoPatch, ProjectLinkPatch, SnoozeMode, FilterDimension, FilterScope, SyncIntervalMinutes, MaxSyncDays, CreateRoutingRulePayload } from '../shared/ipc-channels'
import { SYNC_INTERVAL_OPTIONS, MAX_SYNC_DAYS_OPTIONS } from '../shared/ipc-channels'

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
    // Trigger first sync after the window is visible so the event reaches the renderer
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
  ipcMain.handle('projects:delete', (_event, id: number) => deleteProject(id))
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
  })
  ipcMain.handle('notifications:mark-read', (_event, threadId: string) => {
    markThreadRead(threadId)
    // Emit update event so unread badges refresh immediately
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
  })
  ipcMain.handle('notifications:mark-read-many', (_event, threadIds: string[]) => {
    markThreadsReadMany(threadIds)
    // Emit a single update event after bulk operation
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
  })
  ipcMain.handle('notifications:unsubscribe', async (_event, threadId: string) => {
    const octokit = getOctokit()
    await octokit.rest.activity.deleteThreadSubscription({ thread_id: parseInt(threadId, 10) })
    deleteThread(threadId)
    // Emit update event so UI refreshes immediately
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('notifications:updated')
    })
  })
  ipcMain.handle('notifications:sync', async () => {
    // Reset content_fetched_at for open/unfetched threads so prefetch re-verifies
    // their current state. This handles threads that were already closed/merged
    // before they appeared in an incremental sync window.
    invalidateOpenThreadPrefetch()
    await syncOnce()
    try { await prefetchThreadContent() } catch (err) { console.error('[notifications] Prefetch after manual sync failed:', err) }
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

  // Filter handlers (M7)
  ipcMain.handle('filters:list', () => listFilters())
  ipcMain.handle(
    'filters:create',
    (
      _event,
      dimension: FilterDimension,
      value: string,
      scope: FilterScope = 'global',
      scopeOwner?: string,
      scopeRepo?: string,
    ) => createFilter(dimension, value, scope, scopeOwner, scopeRepo)
  )
  ipcMain.handle('filters:delete', (_event, id: number) => deleteFilter(id))

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
    return result
  })

  startNotificationSync()
  startSnoozeWatcher()

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
