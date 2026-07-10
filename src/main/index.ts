import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { parseSafeExternalUrl } from '../shared/safe-url'
import { initDb } from './db'
import { initAuth, getAuthStatus, savePat, logout, getOctokit } from './auth'
import {
  listProjects, getProject, createProject, updateProject, deleteProject, restoreProject,
  createTodo, updateTodo, deleteTodo, restoreTodo, listInboxTodos,
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
import { getSessionsForProject, getAllStatuses, insertLaunchedSession, getUnassignedSessions, getUnassignedActiveCount, assignSession } from './copilot/db'
import { launchAgentTask } from './copilot/launch'
import { getLaunchTargets } from './copilot/launch-targets'
import { getDigest, markProjectFocused, markDigestSeen, dismissResurface } from './digest'
import { getDb } from './db'
import {
  listResources, createResource, updateResource, deleteResource, restoreResource,
  getProjectCard, upsertProjectCard,
} from './context/registry'
import { groupResources } from './context/group'
import { proposeFromUrl } from './context/capture'
import { recommendResources } from './context/recommend'
import { createResolveDeps } from './context/resolve-deps'
import { resolveModelProvisioning } from './context/model-path'
import { runEmbeddingSmoke, EMBEDDING_SMOKE_FLAG } from './context/embedding-smoke'
import { delegateTask, appDelegateAvailability, buildAppSessionDeepLink, createDefaultDelegateDeps } from './agent/copilot-app/delegate'
import { linkTodoSession } from './agent/copilot-app/store'
import { refreshTodoAppSessionsForProject } from './agent/copilot-app/status'
import { getAppDelegateEnabled, setAppDelegateEnabled, getReposRoot, setReposRoot } from './agent/copilot-app/settings'
import { enableMcpServer, disableMcpServer, shutdownMcpServer } from './mcp-server/lifecycle'
import { getMcpServerEnabled, setMcpServerEnabled } from './mcp-server/settings'
import { listRunbooksForProject } from './knowledge/project-runbooks'
import { revealablePathForService } from './knowledge/store'
import type { ProjectPatch, ProjectTodoPatch, ProjectLinkPatch, SnoozeMode, SyncIntervalMinutes, MaxSyncDays, CreateRoutingRulePayload, LaunchAgentTaskPayload, ResourceInput, ResourcePatch, ProjectCardPatch, DelegatePayload } from '../shared/ipc-channels'
import { SYNC_INTERVAL_OPTIONS, MAX_SYNC_DAYS_OPTIONS } from '../shared/ipc-channels'

/** Broadcasts a push event to all renderer windows. */
function broadcast(channel: 'notifications:updated' | 'copilot:updated' | 'projects:updated' | 'resources:updated'): void {
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
  driftTimer = setInterval(() => {
    // Skip when no windows exist (macOS keeps the app alive after the last
    // window closes) so the tick doesn't wake the app up for nothing.
    if (BrowserWindow.getAllWindows().length > 0) broadcast('projects:updated')
  }, DRIFT_TICK_MS)
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
  // Headless verifier: `--embedding-smoke` loads the model exactly as production
  // would and exits, without creating a window or touching the DB. Runs first so
  // it exercises the packaged runtime cleanly and never starts the real app.
  if (process.argv.includes(EMBEDDING_SMOKE_FLAG)) {
    const code = await runEmbeddingSmoke(app)
    app.exit(code)
    return
  }

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

  // External URL handler (security: controlled via main process). Only open
  // absolute http/https URLs, and open the parser-normalized href rather than
  // the raw renderer string. Renderer calls are fire-and-forget, so an unsafe
  // input is dropped with a warning rather than thrown back.
  ipcMain.handle('app:open-external', async (_event, url: unknown) => {
    const safe = parseSafeExternalUrl(url)
    if (safe === null) {
      // Avoid logging the full value — it may carry tokens or query secrets.
      console.warn('[app:open-external] Refused to open non-http(s) or invalid URL')
      return
    }
    try {
      await shell.openExternal(safe)
    } catch (err) {
      console.error('[app:open-external] openExternal failed:', err)
    }
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
  ipcMain.handle('projects:snooze', (_event, id: number, mode: SnoozeMode, until?: string) => {
    const project = snoozeProject(id, mode, until)
    // Snoozing moves the project into the Parked rail section; refresh subscribers.
    broadcast('projects:updated')
    return project
  })

  // Todo handlers
  ipcMain.handle('todos:create', (_event, projectId: number, text: string) => createTodo(projectId, text))
  ipcMain.handle('todos:update', (_event, id: number, patch: ProjectTodoPatch) => updateTodo(id, patch))
  ipcMain.handle('todos:delete', (_event, id: number) => deleteTodo(id))
  ipcMain.handle('todos:inbox', () => listInboxTodos())

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
  const delegateDeps = createDefaultDelegateDeps()
  ipcMain.handle('copilot:sessions-for-project', (_event, projectId: number) =>
    getSessionsForProject(projectId)
  )
  ipcMain.handle('copilot:all-statuses', () => getAllStatuses())
  ipcMain.handle('copilot:sync', async () => {
    await syncCopilotSessions()
  })

  // Launch a cloud agent task off the render thread, optimistically track it,
  // then reconcile the real title/status from GitHub in the background.
  ipcMain.handle('copilot:launch', async (_event, payload: LaunchAgentTaskPayload) => {
    const parsed = await launchAgentTask(payload)
    const session = insertLaunchedSession({
      id: parsed.sessionId,
      title: payload.prompt.trim(),
      repoOwner: payload.repoOwner.trim(),
      repoName: payload.repoName.trim(),
      htmlUrl: parsed.prUrl ?? parsed.sessionUrl,
      linkedPrUrl: parsed.prUrl,
      projectId: payload.projectId,
    })
    broadcast('copilot:updated')
    void syncCopilotSessions().catch((err: unknown) => {
      console.error('[copilot] Post-launch reconcile sync failed:', err)
    })
    return session
  })

  ipcMain.handle('copilot:unassigned', () => getUnassignedSessions())
  ipcMain.handle('copilot:unassigned-count', () => getUnassignedActiveCount())
  ipcMain.handle('copilot:assign', (_event, sessionId: string, projectId: number) => {
    assignSession(sessionId, projectId)
    broadcast('copilot:updated')
    broadcast('projects:updated')
  })
  ipcMain.handle('copilot:launch-targets', (_event, projectId: number) => getLaunchTargets(projectId))

  // Delegate: try the installed Copilot desktop app (flag on + running + local
  // checkout), else fall back to a cloud gh agent-task. One adapter contains the
  // app's unofficial WS; the cloud path stays the resilient fallback.
  ipcMain.handle('copilot:delegate', async (_event, payload: DelegatePayload) => {
    const result = await delegateTask(payload, delegateDeps)
    broadcast('copilot:updated')
    if (result.kind === 'cloud') {
      // Match the cloud-launch reconcile: pull real title/status in the background.
      void syncCopilotSessions().catch((err: unknown) => {
        console.error('[copilot] Post-delegate reconcile sync failed:', err)
      })
    }
    return result
  })
  ipcMain.handle('copilot:delegate-availability', (_event, repoOwner: string, repoName: string) =>
    // Availability is repo-scoped; a project override is only consulted on the
    // actual delegate call, so pass null here.
    appDelegateAvailability(repoOwner, repoName, null, delegateDeps)
  )
  ipcMain.handle('copilot:open-app-session', async (_event, sessionId: string) => {
    const deepLink = buildAppSessionDeepLink(sessionId)
    if (deepLink === null) throw new Error('Invalid session id')
    await shell.openExternal(deepLink)
  })
  ipcMain.handle('todos:link-session', (_event, todoId: number, sessionId: string) => {
    linkTodoSession(todoId, sessionId)
    broadcast('projects:updated')
  })
  ipcMain.handle('copilot:app-sessions-for-project', (_event, projectId: number) =>
    refreshTodoAppSessionsForProject(projectId)
  )

  // Desktop-app delegate settings.
  ipcMain.handle('settings:get-app-delegate-enabled', () => getAppDelegateEnabled())
  ipcMain.handle('settings:set-app-delegate-enabled', (_event, enabled: boolean) => {
    setAppDelegateEnabled(enabled)
  })
  ipcMain.handle('settings:get-repos-root', () => getReposRoot())
  ipcMain.handle('settings:set-repos-root', (_event, root: string) => {
    setReposRoot(root)
  })

  // Inbound MCP server (loopback + stdio shim). Enabled by default.
  ipcMain.handle('settings:get-mcp-server-enabled', () => getMcpServerEnabled())
  ipcMain.handle('settings:set-mcp-server-enabled', async (_event, enabled: boolean) => {
    setMcpServerEnabled(enabled)
    if (enabled) {
      await enableMcpServer()
    } else {
      await disableMcpServer()
    }
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

  // ── Resources / project brain (MVP C) ────────────────────────────────────────

  // Recommendation deps: an isolated Copilot home (no user MCP servers, no tools
  // for the ranking call) + the hybrid embedding retriever.
  const resolveDeps = createResolveDeps({
    stateDir: app.getPath('userData'),
    embedderOptions: resolveModelProvisioning(app),
  })

  ipcMain.handle('resources:list', (_event, projectId: number) => listResources(projectId))
  ipcMain.handle('resources:groups', (_event, projectId: number) => groupResources(listResources(projectId)))
  ipcMain.handle('resources:capture-proposal', (_event, url: string) => proposeFromUrl(url))
  ipcMain.handle('resources:create', (_event, projectId: number, input: ResourceInput) => {
    const resource = createResource(projectId, input)
    broadcast('resources:updated')
    return resource
  })
  ipcMain.handle('resources:update', (_event, id: number, patch: ResourcePatch) => {
    const resource = updateResource(id, patch)
    broadcast('resources:updated')
    return resource
  })
  ipcMain.handle('resources:delete', (_event, id: number) => {
    deleteResource(id)
    broadcast('resources:updated')
  })
  ipcMain.handle('resources:restore', (_event, id: number) => {
    restoreResource(id)
    broadcast('resources:updated')
  })
  ipcMain.handle('resources:recommend', (_event, projectId: number, question: string) =>
    // Read-only: retrieve + rank saved metadata only. Nothing is written, so no broadcast.
    recommendResources(projectId, question, resolveDeps)
  )
  ipcMain.handle('resources:card-get', (_event, projectId: number) => getProjectCard(projectId))
  ipcMain.handle('resources:card-upsert', (_event, projectId: number, patch: ProjectCardPatch) =>
    upsertProjectCard(projectId, patch)
  )

  // Service knowledge / runbooks (#100). Reads only; the loopback MCP server owns writes.
  ipcMain.handle('knowledge:list-for-project', (_event, projectId: number) =>
    listRunbooksForProject(projectId)
  )
  ipcMain.handle('knowledge:reveal', (_event, service: string) => {
    const path = revealablePathForService(service)
    if (path !== null) shell.showItemInFolder(path)
  })

  startNotificationSync()
  startSnoozeWatcher()
  startDriftWatcher()

  // Inbound MCP server: expose the app as an MCP server the Copilot app can call.
  // Off the render thread; failures here must not block the window coming up.
  if (getMcpServerEnabled()) {
    void enableMcpServer().catch((err: unknown) => {
      console.error('[mcp] Failed to start inbound MCP server:', err instanceof Error ? err.message : 'error')
    })
  }

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

// Stop the loopback server and remove its run files on quit. We leave the
// ~/.mcp.json entry in place (quit != disable); the shim degrades gracefully to
// "app not running" when the run files are gone.
app.on('will-quit', () => {
  void shutdownMcpServer().catch((err: unknown) => {
    console.error('[mcp] Shutdown failed:', err instanceof Error ? err.message : 'error')
  })
})
