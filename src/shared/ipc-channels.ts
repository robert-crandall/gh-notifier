// IPC channel definitions — shared between main process and renderer.
// All channels follow the naming pattern:  domain:action
//
// Each entry maps a channel name to its argument tuple and return type.
// Main registers handlers with ipcMain.handle(channel, ...).
// Renderer calls via window.electron.ipc.invoke(channel, ...args).

// ── Domain types ─────────────────────────────────────────────────────────────

export type AuthStatus =
  | { authenticated: false }
  | { authenticated: true; login: string; avatarUrl: string }

// ── Request-response channels ─────────────────────────────────────────────────

export type IpcChannels = {
  /** Health-check — returns 'pong'. Used in M1 to verify IPC is wired up. */
  'app:ping': {
    args: []
    result: string
  }

  /** Returns the current authentication status. */
  'auth:status': {
    args: []
    result: AuthStatus
  }

  /**
   * Validates a PAT, stores it via safeStorage, and returns the resulting
   * auth status. Throws if the token is invalid.
   */
  'auth:save-token': {
    args: [token: string]
    result: AuthStatus
  }

  /** Clears the stored token and resets auth state. */
  'auth:logout': {
    args: []
    result: void
  }

  /** Opens a URL in the user's default browser via shell.openExternal. */
  'app:open-external': {
    args: [url: string]
    result: void
  }
}

export type IpcChannelName = keyof IpcChannels

// ── Window augmentation ──────────────────────────────────────────────────────
// The preload script exposes this API on window.electron via contextBridge.

export interface ElectronApi {
  ipc: {
    invoke<C extends IpcChannelName>(
      channel: C,
      ...args: IpcChannels[C]['args']
    ): Promise<IpcChannels[C]['result']>
  }
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronApi
  }
}
