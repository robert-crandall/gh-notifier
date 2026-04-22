import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { initAuth, getAuthStatus, savePat, logout, getOctokit } from './auth'
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  createTodo, updateTodo, deleteTodo,
  createLink, updateLink, deleteLink,
} from './db/projects'
import {
  listThreadsByProject,
  listInboxThreads,
  getUnreadCounts,
  assignThread,
  markThreadRead,
  deleteThread,
  listRepoRules,
  createRepoRule,
  deleteRepoRule,
} from './db/notifications'
import { startNotificationSync, syncOnce } from './notifications/sync'
import type { ProjectPatch, ProjectTodoPatch, ProjectLinkPatch } from '../shared/ipc-channels'

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
    void syncOnce()
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
  ipcMain.handle('auth:save-token', (_event, token: string) => savePat(token))
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
  ipcMain.handle('notifications:assign', (_event, threadId: string, projectId: number | null) =>
    assignThread(threadId, projectId)
  )
  ipcMain.handle('notifications:mark-read', (_event, threadId: string) => markThreadRead(threadId))
  ipcMain.handle('notifications:unsubscribe', async (_event, threadId: string) => {
    const octokit = getOctokit()
    await octokit.rest.activity.deleteThreadSubscription({ thread_id: parseInt(threadId, 10) })
    deleteThread(threadId)
  })
  ipcMain.handle('notifications:sync', async () => { await syncOnce() })

  // Repo rule handlers
  ipcMain.handle('repo-rules:list', () => listRepoRules())
  ipcMain.handle('repo-rules:create', (_event, repoOwner: string, repoName: string, projectId: number) =>
    createRepoRule(repoOwner, repoName, projectId)
  )
  ipcMain.handle('repo-rules:delete', (_event, id: number) => deleteRepoRule(id))

  startNotificationSync()

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
