import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronApi, IpcChannelName, IpcChannels, PrefetchProgress } from '../shared/ipc-channels'

const api: ElectronApi = {
  ipc: {
    invoke<C extends IpcChannelName>(
      channel: C,
      ...args: IpcChannels[C]['args']
    ): Promise<IpcChannels[C]['result']> {
      return ipcRenderer.invoke(channel, ...args) as Promise<IpcChannels[C]['result']>
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  onNotificationsUpdated: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('notifications:updated', handler)
    return () => { ipcRenderer.removeListener('notifications:updated', handler) }
  },
  onPrefetchProgress: (callback: (progress: PrefetchProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: PrefetchProgress) => callback(progress)
    ipcRenderer.on('prefetch:progress', handler)
    return () => { ipcRenderer.removeListener('prefetch:progress', handler) }
  }
}

contextBridge.exposeInMainWorld('electron', api)
