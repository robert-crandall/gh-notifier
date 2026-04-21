// IPC channel definitions — shared between main process and renderer.
// All channels follow the naming pattern:  domain:action
//
// Each entry maps a channel name to its argument tuple and return type.
// Main registers handlers with ipcMain.handle(channel, ...).
// Renderer calls via window.electron.ipc.invoke(channel, ...args).

import type {
  Project,
  ProjectLink,
  ProjectTodo,
  ProjectUpdate,
  ProjectLinkUpdate,
  ProjectTodoUpdate
} from './types'

export type IpcChannels = {
  /** Health-check — returns 'pong'. Used in M1 to verify IPC is wired up. */
  'app:ping': {
    args: []
    result: string
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  'projects:list': {
    args: []
    result: Project[]
  }
  'projects:create': {
    args: [{ name: string }]
    result: Project
  }
  'projects:update': {
    args: [{ id: number; changes: Partial<ProjectUpdate> }]
    result: Project
  }
  'projects:delete': {
    args: [{ id: number }]
    result: void
  }

  // ── Todos ─────────────────────────────────────────────────────────────────
  'todos:list': {
    args: [{ projectId: number }]
    result: ProjectTodo[]
  }
  'todos:create': {
    args: [{ projectId: number; title: string }]
    result: ProjectTodo
  }
  'todos:update': {
    args: [{ id: number; changes: Partial<ProjectTodoUpdate> }]
    result: ProjectTodo
  }
  'todos:delete': {
    args: [{ id: number }]
    result: void
  }

  // ── Links ─────────────────────────────────────────────────────────────────
  'links:list': {
    args: [{ projectId: number }]
    result: ProjectLink[]
  }
  'links:create': {
    args: [{ projectId: number; label: string; url: string }]
    result: ProjectLink
  }
  'links:update': {
    args: [{ id: number; changes: Partial<ProjectLinkUpdate> }]
    result: ProjectLink
  }
  'links:delete': {
    args: [{ id: number }]
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
}

declare global {
  interface Window {
    electron: ElectronApi
  }
}
