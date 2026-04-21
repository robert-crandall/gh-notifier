import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initDb } from './db'
import { initAuth, getAuthStatus, savePat, logout } from './auth'

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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
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
